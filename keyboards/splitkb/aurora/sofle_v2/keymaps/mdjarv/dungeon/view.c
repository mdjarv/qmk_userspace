// The left screen: a raycast view of the dungeon in line art (brick joints and
// edges in white, fading with the torchlight), the hero's hands below it, and
// health, depth and potions along the bottom.
//
// All maths is 16.16 fixed point: the RP2040 has no FPU. The 3D view is drawn
// into a cache when the game changes and four times a second (the torch
// flickers); every frame copies it and draws what moves on top.
#include "dungeon_internal.h"
#include "draw.h"
#include <string.h>

typedef int32_t fx; // 16.16
#define ONE 65536
#define Q(x) ((fx)((x) * 65536.0))
static inline fx mulq(fx a, fx b) { return (fx)(((int64_t)a * b) >> 16); }
static inline fx divq(fx a, fx b) { return (fx)(((int64_t)a << 16) / b); }

#define VIEW_H 117           // rows of the view; the bars are below
#define HORIZON 44           // the eye's row: the corridor sits in the top half
#define FOCAL Q(16.0 / 0.66) // px per unit at distance 1: a 67 degree view
#define PLANE Q(0.66)
#define BACK Q(0.3)   // the eye stands this far behind the middle of its cell
#define WALL_H Q(2.0) // walls are twice as tall as a cell is wide
#define EYE Q(0.9)
#define DETAIL Q(4.0) // brick joints fade out past this distance (lit faces)
#define DETAIL_DIM Q(3.6) // ...and past this on the faces turned away
#define BEAMS_TO Q(5.0)
#define FAR Q(12.0)
#define CELLS (MAP * MAP)

// ------------------------------------------------------------------ art

SPR(SKELETON_ART,
    ".....######.....", "....########....", "...##########...", "...##..##..##...", "...##..##..##...",
    "...####..####...", "....##.##.##....", ".....#.##.#.....", "......####......", "..###########...",
    ".#..#######..#..", ".#...#.#.#...#..", "#....#####....#.", "#....#.#.#....#.", "##...#####...##.",
    "......###.......", ".....#####......", ".....#...#......", "....##...##.....", "....#.....#.....",
    "....#.....#.....", "....#.....#.....", "...##.....##....", "..###.....###...");
SPR(RAT_ART, "##......##", "###....###", ".########.", ".#..##..#.", ".########.", "..##..##..", "...####...", "..#.##.#..");
SPR(BAT_ART, "#..........#", "##..#..#..##", "###.####.###", "############", ".##.#..#.##.", "....####....", ".....##.....");
SPR(SLIME_ART, "....####....", "..########..", ".##########.", ".#..####..#.", ".##########.", "############", "############", ".##########.");
static const struct {
    const char *const *rows;
    uint8_t            h;
    fx                 height, lift; // in cell units
} LOOK[KINDS] = {
    [RAT]      = {RAT_ART, LEN(RAT_ART), Q(0.5), 0},
    [BAT]      = {BAT_ART, LEN(BAT_ART), Q(0.45), Q(0.75)},
    [SKELETON] = {SKELETON_ART, LEN(SKELETON_ART), Q(1.5), 0},
    [SLIME]    = {SLIME_ART, LEN(SLIME_ART), Q(0.6), 0},
};
static const struct {
    const char *const *rows;
    fx                 height;
} ITEM_LOOK[] = {
    [POTION] = {DG_POTION, Q(0.3)},
    [SWORD]  = {DG_SWORD, Q(0.3)},
    [HEART]  = {DG_HEART, Q(0.3)},
};

// The hands, drawn in tools/dungeon's prototype and kept here as pixels.
SPR(TORCH_HAND,
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    ".....##...###...",
    ".....###.###....",
    ".....#######....",
    "......#####.....",
    ".....#######....",
    ".....##.#.##....",
    "......####......",
    ".......###......",
    ".......###......",
    ".......###......",
    ".......###......",
    ".......###......",
    ".......###......",
    ".......###......",
    ".......###......",
    ".......###......",
    ".......###......",
    "......#####.....",
    ".....######.##..",
    ".......####.##..",
    "....######.###..",
    ".......###.###..",
    "....######.##...",
    "....#####.###...",
    ".......######...",
    "....########....",
    "...#########....",
    "...#########....",
    "..##########....",
    "..#########.....",
    ".##########.....",
    ".########.......",
    "######...#......",
    "##.....###......");
SPR(FLAME0,
    "......##........",
    "......##........",
    ".......#........",
    ".......##.......",
    "......###.......",
    "......###.......",
    "......####......",
    "......####......",
    "......#..##.....",
    ".....##..##.....",
    ".....##..##.....",
    ".....##...##....",
    ".....##...##....");
SPR(FLAME1,
    ".........#......",
    "........##......",
    "........##......",
    "........##......",
    "........##......",
    ".......####.....",
    ".......####.....",
    "......##.##.....",
    "......##.##.....",
    "......##.##.....",
    ".....###..##....",
    ".....##...##....",
    ".....##...##....");
SPR(FLAME2,
    ".........##.....",
    ".........##.....",
    ".........#......",
    "........##......",
    "........###.....",
    "........###.....",
    ".......####.....",
    ".......####.....",
    "......##..#.....",
    "......##..##....",
    "......##..##....",
    ".....##...##....",
    ".....##...##....");
SPR(FLAME3,
    ".......#........",
    ".......##.......",
    ".......##.......",
    ".......##.......",
    ".......##.......",
    "......####......",
    "......####......",
    "......##.##.....",
    "......##.##.....",
    "......##.##.....",
    ".....##..###....",
    ".....##...##....",
    ".....##...##....");
static const char *const *const FLAME[4] = {FLAME0, FLAME1, FLAME2, FLAME3};
SPR(SWORD_HAND,
    "..................",
    ".##...............",
    ".##...............",
    "..#...............",
    "..##..............",
    "..##..............",
    "..##..............",
    "..###.............",
    "...##.............",
    "...##.............",
    "...#..............",
    "...#.#............",
    "...#.#............",
    "...#.#............",
    ".....##...........",
    "....#.#...........",
    "....#.#...........",
    "....#.##..........",
    "....#..#..........",
    ".....#.#..........",
    ".....#.##.........",
    ".....#.##.........",
    ".....#.##.........",
    ".....##.#.........",
    ".....##.##........",
    "......#.##........",
    "......#.##........",
    "......#####.......",
    "......#####...##..",
    "......##########..",
    ".....###########..",
    "...#########......",
    "...########.......",
    ".......######.....",
    "......###.####....",
    "......###.###.....",
    "......##..#####...",
    ".....###.#######..",
    ".....###.###......",
    ".....###.######...",
    ".....########.....",
    "......##########..",
    ".......#########..",
    ".......##########.",
    ".......##########.",
    ".......###########",
    ".......###########",
    "........##########",
    "........##########",
    ".........#########",
    "...........#######");
SPR(SKULL, "..######..", ".########.", "##..##..##", "##..##..##", "##########", "....##....", ".########.", "..#.##.#..");
SPR(CROWN, "#.#.#", "#####", "#####");
SPR(STAR, "#...#", ".#.#.", "..#..", ".#.#.", "#...#");
SPR(CHEVRON_L, "...#", "..##", ".###", "####", ".###", "..##", "...#");
SPR(CHEVRON_R, "#...", "##..", "###.", "####", "###.", "##..", "#...");
SPR(CHEVRON_D, "#######", ".#####.", "..###..", "...#...");

// ------------------------------------------------------------------ the view

static uint16_t surf[VIEW_H][DUNGEON_W]; // what each pixel shows, for the edges
static fx       zbuf[DUNGEON_W];         // distance to the wall in each column
static uint32_t mask[VIEW_H];            // a sprite's pixels, one bit per column
enum { SURF_CEILING, SURF_FLOOR, SURF_STAIRS, SURF_WALL };

static fx camx, camy;          // the eye
static int8_t dirx, diry, rgtx, rgty;

// Where the front monster was drawn, for the hit effects.
static int16_t front_x = -1, front_y;

static bool torch_on(int8_t mx, int8_t my) { return dg_at(mx, my) == WALL && (mx * 7 + my * 3) % 5 == 0; }

// What a wall shows at u across its face and v up it: 1 a lit line, 0 dark,
// -1 a brick joint (lit only near enough to see).
static int8_t wall_texel(uint8_t t, int8_t mx, int8_t my, fx u, fx v) {
    if (t == DOOR && u > Q(0.12) && u < Q(0.88) && v < Q(1.6)) {
        if (u < Q(0.14) || u > Q(0.86) || v > Q(1.58)) return 1;        // the opening's edge
        if (((u * 5) & 0xFFFF) < Q(0.12)) return 1;                     // gaps between planks
        if ((v > Q(0.35) && v < Q(0.45)) || (v > Q(1.1) && v < Q(1.2))) return 1; // iron bands
        return 0;
    }
    if (torch_on(mx, my) && u > Q(0.38) && u < Q(0.62) && v > Q(0.85) && v < Q(1.5)) {
        if (v > Q(1.22)) return (u > Q(0.42) && u < Q(0.58)) ? 1 : 0; // the flame
        if (u > Q(0.47) && u < Q(0.53)) return 1;                       // the bracket
        return 0;
    }
    fx v2 = v * 2, row = v2 >> 16;
    fx bu = u * 2 + ((row & 1) ? ONE / 2 : 0);
    return ((bu & 0xFFFF) < Q(0.16) || (v2 & 0xFFFF) < Q(0.16)) ? -1 : 0;
}

static void cast(fx detail_shift) {
    // ceiling beams: a line where the ceiling's distance crosses into the next cell
    static bool beam[HORIZON];
    int32_t     last = -1;
    for (int16_t y = 0; y < HORIZON && y < VIEW_H; y++) {
        fx      above = HORIZON * ONE - (y * ONE + ONE / 2);
        fx      dc    = divq(mulq(WALL_H - EYE, FOCAL), above);
        int32_t cell  = (dc - BACK - ONE / 2) >> 16;
        beam[y]       = last >= 0 && cell != last && dc < BEAMS_TO;
        last          = cell;
    }
    // the floor's distance in each row below the horizon
    static fx floor_d[VIEW_H];
    for (int16_t y = HORIZON; y < VIEW_H; y++) floor_d[y] = divq(mulq(EYE, FOCAL), y * ONE + ONE / 2 - HORIZON * ONE);
    for (int16_t i = 0; i < DUNGEON_W; i++) {
        fx p  = mulq(PLANE, ((2 * i + 1) * ONE) / DUNGEON_W - ONE);
        fx rx = dirx * ONE + rgtx * p, ry = diry * ONE + rgty * p;
        // walk the grid (DDA) to the first wall or door
        int8_t mx = camx >> 16, my = camy >> 16, sx, sy, side = 0;
        fx     ddx = rx ? divq(ONE, rx < 0 ? -rx : rx) : (1 << 30);
        fx     ddy = ry ? divq(ONE, ry < 0 ? -ry : ry) : (1 << 30);
        fx     sdx, sdy;
        if (rx < 0) sx = -1, sdx = mulq(camx - mx * ONE, ddx);
        else sx = 1, sdx = mulq((mx + 1) * ONE - camx, ddx);
        if (ry < 0) sy = -1, sdy = mulq(camy - my * ONE, ddy);
        else sy = 1, sdy = mulq((my + 1) * ONE - camy, ddy);
        uint8_t t = WALL;
        for (uint8_t n = 0; n < 32; n++) {
            if (sdx < sdy) sdx += ddx, mx += sx, side = 0;
            else sdy += ddy, my += sy, side = 1;
            t = dg_at(mx, my);
            if (t == WALL || t == DOOR) break;
        }
        fx d = side == 0 ? sdx - ddx : sdy - ddy;
        if (d < Q(0.05)) d = Q(0.05);
        zbuf[i] = d;
        fx u    = side == 0 ? (camy + mulq(d, ry)) & 0xFFFF : (camx + mulq(d, rx)) & 0xFFFF;
        if ((side == 0 && rx > 0) || (side == 1 && ry < 0)) u = ONE - 1 - u;
        fx       top = HORIZON * ONE - divq(mulq(WALL_H - EYE, FOCAL), d);
        fx       bot = HORIZON * ONE + divq(mulq(EYE, FOCAL), d);
        fx       dv  = divq(d, FOCAL);
        bool     near = d < (side ? DETAIL_DIM : DETAIL) + detail_shift;
        uint16_t wall = SURF_WALL + ((my * MAP + mx) << 1 | side);
        int32_t  last_step = -1;
        for (int16_t y = 0; y < VIEW_H; y++) {
            fx   yc  = y * ONE + ONE / 2;
            bool lit = false;
            if (yc < top) {
                surf[y][i] = SURF_CEILING;
                lit        = y < HORIZON && beam[y];
            } else if (yc > bot) {
                // the floor is dark; the stairs down show their steps
                fx df      = floor_d[y];
                fx wx      = camx + mulq(df, rx), wy = camy + mulq(df, ry);
                surf[y][i] = SURF_FLOOR;
                if (dg_at(wx >> 16, wy >> 16) == STAIRS) {
                    surf[y][i]   = SURF_STAIRS;
                    int32_t step = (df * 4) >> 16;
                    lit          = last_step >= 0 && step != last_step;
                    last_step    = step;
                }
            } else {
                surf[y][i] = wall;
                int8_t tx  = wall_texel(t, mx, my, u, mulq(bot - yc, dv));
                lit        = tx > 0 || (tx < 0 && near);
            }
            dg_px(i, y, lit);
        }
    }
    // edges: where a wall (or the stairs) meets anything else
    for (int16_t y = 0; y < VIEW_H; y++)
        for (int16_t x = 0; x < DUNGEON_W; x++) {
            uint16_t s = surf[y][x];
            uint16_t r = x + 1 < DUNGEON_W ? surf[y][x + 1] : s, b = y + 1 < VIEW_H ? surf[y + 1][x] : s;
            if ((r != s && (r >= SURF_STAIRS || s >= SURF_STAIRS)) || (b != s && (b >= SURF_STAIRS || s >= SURF_STAIRS))) dg_px(x, y, true);
        }
}

// A billboard at cell (cx, cy): rows scaled to height (cell units), standing
// lift above the floor. Hidden behind walls nearer than it. Returns false when
// it is out of sight.
static bool billboard(const char *const *rows, uint8_t h, uint8_t cx, uint8_t cy, fx height, fx lift, int16_t *sx_out, int16_t *top_out) {
    fx dx = cx * ONE + ONE / 2 - camx, dy = cy * ONE + ONE / 2 - camy;
    fx ty = dirx * dx + diry * dy, tx = rgtx * dx + rgty * dy;
    if (ty < Q(0.35) || ty > FAR) return false;
    fx      sx = 16 * ONE + divq(mulq(tx, FOCAL), ty);
    fx      hp = divq(mulq(height, FOCAL), ty);
    fx      foot = HORIZON * ONE + divq(mulq(EYE - lift, FOCAL), ty);
    uint8_t sw   = strlen(rows[0]);
    fx      wp   = hp * sw / h;
    fx      x0 = sx - wp / 2, y0 = foot - hp;
    memset(mask, 0, sizeof(mask));
    bool any = false;
    for (int16_t j = y0 >> 16; j <= foot >> 16; j++) {
        if (j < 0 || j >= VIEW_H) continue;
        int32_t sv = (int32_t)(((int64_t)(j * ONE + ONE / 2 - y0) * h) / hp);
        if (sv < 0 || sv >= h) continue;
        for (int16_t i = x0 >> 16; i <= (x0 + wp) >> 16; i++) {
            if (i < 0 || i >= DUNGEON_W || ty >= zbuf[i]) continue;
            int32_t su = (int32_t)(((int64_t)(i * ONE + ONE / 2 - x0) * sw) / wp);
            if (su < 0 || su >= sw || rows[sv][su] != '#') continue;
            mask[j] |= 1u << i;
            any = true;
        }
    }
    if (!any) return false;
    for (int16_t j = 0; j < VIEW_H; j++)
        for (int16_t i = 0; i < DUNGEON_W; i++)
            if (mask[j] >> i & 1)
                for (int8_t a = -1; a <= 1; a++)
                    for (int8_t b = -1; b <= 1; b++)
                        if (j + b >= 0 && j + b < VIEW_H) dg_px(i + a, j + b, false);
    for (int16_t j = 0; j < VIEW_H; j++)
        for (int16_t i = 0; i < DUNGEON_W; i++)
            if (mask[j] >> i & 1) dg_px(i, j, true);
    if (sx_out) *sx_out = sx >> 16;
    if (top_out) *top_out = y0 >> 16;
    return true;
}

static void things(uint32_t now) {
    // far to near, so nearer things cover farther ones
    struct drawable {
        fx     ty;
        int8_t mon, item;
    } order[MAX_MONSTERS + MAX_ITEMS];
    uint8_t n = 0;
    for (uint8_t k = 0; k < dg.nmon; k++) {
        fx dx = dg.mon[k].x * ONE - (camx - ONE / 2), dy = dg.mon[k].y * ONE - (camy - ONE / 2);
        order[n++] = (struct drawable){dirx * dx + diry * dy, (int8_t)k, -1};
    }
    for (uint8_t k = 0; k < dg.nitem; k++) {
        fx dx = dg.item[k].x * ONE - (camx - ONE / 2), dy = dg.item[k].y * ONE - (camy - ONE / 2);
        order[n++] = (struct drawable){dirx * dx + diry * dy + 1, -1, (int8_t)k}; // behind a monster on the same cell
    }
    for (uint8_t a = 1; a < n; a++)
        for (uint8_t b = a; b > 0 && order[b].ty > order[b - 1].ty; b--) {
            struct drawable t = order[b];
            order[b]           = order[b - 1];
            order[b - 1]       = t;
        }
    front_x = -1;
    for (uint8_t k = 0; k < n; k++) {
        if (order[k].mon >= 0) {
            monster_t *m    = &dg.mon[order[k].mon];
            fx         bob  = m->kind == BAT && (now / 250 + m->x) % 2 ? Q(0.06) : 0;
            int16_t    sx, top;
            if (billboard(LOOK[m->kind].rows, LOOK[m->kind].h, m->x, m->y, LOOK[m->kind].height, LOOK[m->kind].lift + bob, &sx, &top) &&
                m->x == dg.x + dirx && m->y == dg.y + diry) {
                front_x = sx;
                front_y = top;
            }
        } else {
            item_t *it = &dg.item[order[k].item];
            billboard(ITEM_LOOK[it->kind].rows, 5, it->x, it->y, ITEM_LOOK[it->kind].height, 0, NULL, NULL);
        }
    }
}

// ------------------------------------------------------------------ on top

static void hands(uint32_t now) {
    const char *const *flame = FLAME[now / 150 % 4];
    // the sword hand jabs up and in for a moment when it strikes
    bool    swing = dg.swung && now - dg.swing_at < 180;
    int16_t sx = 32 - 18 - (swing ? 4 : 0), sy = VIEW_H - 51 - (swing ? 7 : 0);
    int16_t ty = VIEW_H - 47;
    dg_sprite_ring(TORCH_HAND, LEN(TORCH_HAND), 0, ty);
    dg_sprite_ring(flame, 13, 0, ty);
    dg_sprite_ring(SWORD_HAND, LEN(SWORD_HAND), sx, sy);
    dg_sprite(TORCH_HAND, LEN(TORCH_HAND), 0, ty);
    dg_sprite(flame, 13, 0, ty);
    dg_sprite(SWORD_HAND, LEN(SWORD_HAND), sx, sy);
}

// A chevron at the edge of the view for a monster beside or behind you.
static void threats(void) {
    for (uint8_t k = 0; k < dg.nmon; k++) {
        monster_t *m = &dg.mon[k];
        if (dg_dist(m->x, m->y, dg.x, dg.y) != 1) continue;
        int8_t side = m->x == dg.x + rgtx && m->y == dg.y + rgty ? 1 : m->x == dg.x - rgtx && m->y == dg.y - rgty ? -1 : m->x == dg.x - dirx && m->y == dg.y - diry ? 2 : 0;
        if (side == -1) {
            dg_sprite_ring(CHEVRON_L, 7, 0, 30);
            dg_sprite(CHEVRON_L, 7, 0, 30);
        } else if (side == 1) {
            dg_sprite_ring(CHEVRON_R, 7, 28, 30);
            dg_sprite(CHEVRON_R, 7, 28, 30);
        } else if (side == 2) {
            dg_sprite_ring(CHEVRON_D, 4, 13, VIEW_H - 6);
            dg_sprite(CHEVRON_D, 4, 13, VIEW_H - 6);
        }
    }
}

static void bars(void) {
    dg_fill(0, VIEW_H, DUNGEON_W - 1, DUNGEON_H - 1, false);
    // health: a heart and a solid tank
    dg_sprite(DG_HEART, 5, 0, VIEW_H + 1);
    dg_rect(7, VIEW_H + 1, 31, VIEW_H + 5);
    int16_t w = 23 * dg.hp / MAX_HP;
    if (w) dg_fill(8, VIEW_H + 2, 7 + w, VIEW_H + 4, true);
    // depth and potions
    dg_sprite(DG_STAIRS, 5, 0, DUNGEON_H - 5);
    dg_number(dg.depth, 8, DUNGEON_H - 5);
    if (dg.potions) {
        dg_sprite(DG_POTION, 5, 22, DUNGEON_H - 5);
        dg_number(dg.potions, 27, DUNGEON_H - 5);
    }
}

static void dead(void) {
    dg_sprite(SKULL, LEN(SKULL), 11, 26);
    dg_sprite(DG_STAIRS, 5, 6, 42);
    dg_number(dg.depth, 14, 42);
    if (dg.best > 1) {
        dg_sprite(CROWN, 3, 7, 51);
        dg_number(dg.best, 14, 50);
    }
}

// Moves the view one pixel sideways (a blow taken).
static void shake(int8_t by) {
    for (uint8_t page = 0; page < (VIEW_H + 7) / 8; page++) {
        uint8_t *row = &dg_fb[page * DUNGEON_W];
        if (by > 0) memmove(row + 1, row, DUNGEON_W - 1), row[0] = 0;
        else memmove(row, row + 1, DUNGEON_W - 1), row[DUNGEON_W - 1] = 0;
    }
}

void dungeon_render(uint8_t frame[DUNGEON_FRAME_SIZE], uint32_t now_ms) {
    static uint8_t  view[DUNGEON_FRAME_SIZE];
    static uint32_t cached_version = UINT32_MAX, cached_tick = UINT32_MAX;
    uint32_t        tick = now_ms / 250;
    if (dg.dead) {
        dg_fb = frame;
        memset(frame, 0, DUNGEON_FRAME_SIZE);
        dead();
        bars();
        return;
    }
    if (dg.version != cached_version || tick != cached_tick) {
        cached_version = dg.version;
        cached_tick    = tick;
        dg_fb          = view;
        memset(view, 0, sizeof(view));
        dirx = DX[dg.dir], diry = DY[dg.dir];
        rgtx = DX[(dg.dir + 1) % 4], rgty = DY[(dg.dir + 1) % 4];
        camx = dg.x * ONE + ONE / 2 - dirx * BACK;
        camy = dg.y * ONE + ONE / 2 - diry * BACK;
        // the torchlight breathes: how far the joints show moves a little
        fx flicker = (fx)((tick * 2654435761u) >> 30) * Q(0.12);
        cast(flicker);
        things(now_ms);
    }
    memcpy(frame, view, DUNGEON_FRAME_SIZE);
    dg_fb = frame;
    if (dg.hurt && now_ms - dg.hurt_at < 240) shake((now_ms - dg.hurt_at) / 60 % 2 ? 1 : -1);
    if (dg.hit && now_ms - dg.hit_at < 200 && front_x >= 0) {
        dg_sprite_ring(STAR, 5, front_x + 2, front_y);
        dg_sprite(STAR, 5, front_x + 2, front_y);
    }
    threats();
    hands(now_ms);
    bars();
}
