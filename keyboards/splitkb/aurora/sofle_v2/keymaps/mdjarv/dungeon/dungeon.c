// A first-person grid crawler. Each floor is a 16x16 maze with a few rooms,
// loops and doors; find the stairs and go down. Turn-based: turning is free,
// every other action gives the monsters a turn.
//
// Screen, top to bottom: the view (0-43), the automap (47-102), hearts
// (109-113), depth and potions (119-123).
#include "dungeon.h"
#include <string.h>

// ------------------------------------------------------------------ the map

#define MAP 16
enum { FLOOR, WALL, DOOR, STAIRS };
enum { N, E, S, W };
static const int8_t DX[4] = {0, 1, 0, -1}, DY[4] = {-1, 0, 1, 0};

#define MAX_HP 5
#define MAX_MONSTERS 12
#define MAX_ITEMS 6

enum { RAT, BAT, SKELETON, SLIME, KINDS };
static const struct {
    uint8_t hp, dmg, hit; // hit: chance in percent
    uint8_t slow;         // moves only every other turn
    uint8_t first;        // the first depth it shows up on
} KIND[KINDS] = {
    [RAT]      = {1, 1, 50, 0, 1},
    [BAT]      = {1, 1, 40, 0, 2},
    [SKELETON] = {2, 1, 60, 0, 3},
    [SLIME]    = {4, 2, 50, 1, 4},
};

enum { POTION, SWORD, HEART };

typedef struct {
    uint8_t x, y, kind, hp;
    bool    awake;
} monster_t;

typedef struct {
    uint8_t x, y, kind;
} item_t;

static struct {
    uint32_t  rng;
    uint8_t   map[MAP][MAP];
    uint16_t  seen[MAP]; // bit x of row y: shown on the automap
    uint8_t   x, y, dir;
    uint8_t   hp, attack, potions, depth, best;
    bool      dead;
    uint32_t  turn;
    monster_t mon[MAX_MONSTERS];
    uint8_t   nmon;
    item_t    item[MAX_ITEMS];
    uint8_t   nitem;
    // what just happened, for the view to show for a moment
    uint32_t hurt_at, hit_at, floor_at;
    uint8_t  hurt_from; // direction of the last blow taken, absolute
    bool     hurt_recent, hit_recent;
} g;

static uint32_t rnd(void) { // xorshift32; never 0
    g.rng ^= g.rng << 13;
    g.rng ^= g.rng >> 17;
    g.rng ^= g.rng << 5;
    return g.rng;
}
static uint8_t roll(uint8_t n) { return rnd() % n; }

static uint8_t at(int8_t x, int8_t y) { return x < 0 || y < 0 || x >= MAP || y >= MAP ? WALL : g.map[y][x]; }
static bool    open_cell(int8_t x, int8_t y) { return at(x, y) == FLOOR || at(x, y) == STAIRS; }

static monster_t *monster_at(int8_t x, int8_t y) {
    for (uint8_t i = 0; i < g.nmon; i++)
        if (g.mon[i].x == x && g.mon[i].y == y) return &g.mon[i];
    return NULL;
}

static item_t *item_at(int8_t x, int8_t y) {
    for (uint8_t i = 0; i < g.nitem; i++)
        if (g.item[i].x == x && g.item[i].y == y) return &g.item[i];
    return NULL;
}

static void see(int8_t x, int8_t y) {
    if (x >= 0 && y >= 0 && x < MAP && y < MAP) g.seen[y] |= 1u << x;
}
static bool seen(int8_t x, int8_t y) { return x >= 0 && y >= 0 && x < MAP && y < MAP && (g.seen[y] >> x & 1); }

// Breadth-first distances from (x, y) through anything but walls; 255 = unreachable.
static void distances(uint8_t x, uint8_t y, uint8_t d[MAP][MAP]) {
    static uint8_t q[MAP * MAP];
    memset(d, 255, MAP * MAP);
    uint16_t head = 0, tail = 0;
    d[y][x]   = 0;
    q[tail++] = y * MAP + x;
    while (head < tail) {
        uint8_t c = q[head++], cx = c % MAP, cy = c / MAP;
        for (uint8_t k = 0; k < 4; k++) {
            int8_t nx = cx + DX[k], ny = cy + DY[k];
            if (at(nx, ny) == WALL || d[ny][nx] != 255) continue;
            d[ny][nx] = d[cy][cx] + 1;
            q[tail++] = ny * MAP + nx;
        }
    }
}

// A random floor cell at least min_dist from the player with nothing on it.
static bool free_cell(uint8_t d[MAP][MAP], uint8_t min_dist, uint8_t *ox, uint8_t *oy) {
    for (uint8_t tries = 0; tries < 200; tries++) {
        uint8_t x = roll(MAP), y = roll(MAP);
        if (g.map[y][x] != FLOOR || d[y][x] == 255 || d[y][x] < min_dist) continue;
        if (monster_at(x, y) || item_at(x, y)) continue;
        *ox = x;
        *oy = y;
        return true;
    }
    return false;
}

static void look(void);

static void new_floor(uint32_t now) {
    // A maze on the odd cells (recursive backtracker)...
    memset(g.map, WALL, sizeof(g.map));
    memset(g.seen, 0, sizeof(g.seen));
    static uint8_t stack[64];
    uint8_t        sp = 0, cx = 1 + 2 * roll(7), cy = 1 + 2 * roll(7);
    g.map[cy][cx]     = FLOOR;
    stack[sp++]       = cy * MAP + cx;
    while (sp) {
        cx = stack[sp - 1] % MAP;
        cy = stack[sp - 1] / MAP;
        uint8_t options[4], n = 0;
        for (uint8_t k = 0; k < 4; k++) {
            int8_t nx = cx + 2 * DX[k], ny = cy + 2 * DY[k];
            if (nx > 0 && ny > 0 && nx < MAP - 1 && ny < MAP - 1 && g.map[ny][nx] == WALL) options[n++] = k;
        }
        if (!n) {
            sp--;
            continue;
        }
        uint8_t k                        = options[roll(n)];
        g.map[cy + DY[k]][cx + DX[k]]    = FLOOR;
        g.map[cy + 2 * DY[k]][cx + 2 * DX[k]] = FLOOR;
        stack[sp++]                      = (cy + 2 * DY[k]) * MAP + cx + 2 * DX[k];
    }
    // ...with two rooms and some loops, so it is not all dead ends...
    for (uint8_t r = 0; r < 2; r++) {
        uint8_t rx = 1 + 2 * roll(6), ry = 1 + 2 * roll(6);
        for (uint8_t y = ry; y < ry + 3; y++)
            for (uint8_t x = rx; x < rx + 3; x++) g.map[y][x] = FLOOR;
    }
    for (uint8_t i = 0; i < 10; i++) {
        uint8_t x = 1 + roll(MAP - 2), y = 1 + roll(MAP - 2);
        if (g.map[y][x] == WALL && ((x % 2) != (y % 2)) && x < MAP - 1 && y < MAP - 1) g.map[y][x] = FLOOR;
    }
    // ...and doors in some passages: a cell with walls on two opposite sides.
    for (uint8_t y = 1; y < MAP - 1; y++)
        for (uint8_t x = 1; x < MAP - 1; x++) {
            if (g.map[y][x] != FLOOR || (x % 2) == (y % 2) || roll(6)) continue;
            bool ns = g.map[y - 1][x] == WALL && g.map[y + 1][x] == WALL && g.map[y][x - 1] != WALL && g.map[y][x + 1] != WALL;
            bool ew = g.map[y][x - 1] == WALL && g.map[y][x + 1] == WALL && g.map[y - 1][x] != WALL && g.map[y + 1][x] != WALL;
            if (ns || ew) g.map[y][x] = DOOR;
        }

    // The player starts on a random odd cell, facing an open way.
    g.x = 1 + 2 * roll(7);
    g.y = 1 + 2 * roll(7);
    g.map[g.y][g.x] = FLOOR;
    for (uint8_t k = 0; k < 4; k++)
        if (at(g.x + DX[k], g.y + DY[k]) == FLOOR) g.dir = k;

    // The stairs go where it is farthest to walk.
    static uint8_t d[MAP][MAP];
    distances(g.x, g.y, d);
    uint8_t sx = g.x, sy = g.y;
    for (uint8_t y = 0; y < MAP; y++)
        for (uint8_t x = 0; x < MAP; x++)
            if (g.map[y][x] == FLOOR && d[y][x] != 255 && d[y][x] > d[sy][sx]) {
                sx = x;
                sy = y;
            }
    g.map[sy][sx] = STAIRS;

    g.nmon = 0;
    g.nitem = 0;
    uint8_t want = 3 + g.depth;
    if (want > MAX_MONSTERS) want = MAX_MONSTERS;
    while (g.nmon < want) {
        monster_t *m = &g.mon[g.nmon];
        if (!free_cell(d, 4, &m->x, &m->y)) break;
        do m->kind = roll(KINDS);
        while (KIND[m->kind].first > g.depth);
        m->hp    = KIND[m->kind].hp;
        m->awake = false;
        g.nmon++;
    }
    static const uint8_t loot[] = {POTION, POTION, SWORD, HEART};
    uint8_t              nloot  = 2 + roll(2);
    for (uint8_t i = 0; i < nloot && g.nitem < MAX_ITEMS; i++) {
        item_t *it = &g.item[g.nitem];
        if (!free_cell(d, 2, &it->x, &it->y)) break;
        it->kind = loot[roll(g.depth % 3 == 0 ? 4 : 2)]; // swords and hearts on every third floor
        g.nitem++;
    }
    look();
    g.floor_at = now;
}

void dungeon_start(uint32_t seed, uint32_t now_ms) {
    uint8_t best = g.best;
    memset(&g, 0, sizeof(g));
    g.best    = best;
    g.rng     = seed ? seed : 1;
    g.hp      = MAX_HP;
    g.attack  = 1;
    g.potions = 1;
    g.depth   = 1;
    new_floor(now_ms);
}

// ------------------------------------------------------------------ turns

static uint8_t dist(int8_t x0, int8_t y0, int8_t x1, int8_t y1) {
    return (x0 > x1 ? x0 - x1 : x1 - x0) + (y0 > y1 ? y0 - y1 : y1 - y0);
}

static bool monster_can_enter(int8_t x, int8_t y) {
    return open_cell(x, y) && !monster_at(x, y) && !(x == g.x && y == g.y);
}

static void monsters_turn(uint32_t now) {
    g.turn++;
    for (uint8_t i = 0; i < g.nmon; i++) {
        monster_t *m = &g.mon[i];
        uint8_t    d = dist(m->x, m->y, g.x, g.y);
        if (d <= 4) m->awake = true;
        if (!m->awake) continue;
        if (d == 1) {
            if (roll(100) < KIND[m->kind].hit) {
                g.hp        = g.hp > KIND[m->kind].dmg ? g.hp - KIND[m->kind].dmg : 0;
                g.hurt_at   = now;
                g.hurt_recent = true;
                for (uint8_t k = 0; k < 4; k++)
                    if (g.x + DX[k] == m->x && g.y + DY[k] == m->y) g.hurt_from = k;
                if (!g.hp) {
                    g.dead = true;
                    if (g.depth > g.best) g.best = g.depth;
                    return;
                }
            }
            continue;
        }
        if (KIND[m->kind].slow && (g.turn & 1)) continue;
        // Step along the longer way to the player, else the other.
        int8_t ddx = g.x > m->x ? 1 : g.x < m->x ? -1 : 0;
        int8_t ddy = g.y > m->y ? 1 : g.y < m->y ? -1 : 0;
        bool   xfirst = dist(m->x, 0, g.x, 0) >= dist(0, m->y, 0, g.y);
        if (xfirst && ddx && monster_can_enter(m->x + ddx, m->y)) m->x += ddx;
        else if (ddy && monster_can_enter(m->x, m->y + ddy)) m->y += ddy;
        else if (!xfirst && ddx && monster_can_enter(m->x + ddx, m->y)) m->x += ddx;
    }
}

static void strike(monster_t *m, uint32_t now) {
    if (roll(100) < 80) {
        g.hit_at     = now;
        g.hit_recent = true;
        if (m->hp <= g.attack) {
            *m = g.mon[--g.nmon]; // dead: the last one takes its place
            return;
        }
        m->hp -= g.attack;
    }
    m->awake = true;
}

static void pick_up(void) {
    item_t *it = item_at(g.x, g.y);
    if (!it) return;
    switch (it->kind) {
        case POTION: if (g.potions < 9) g.potions++; break;
        case SWORD: if (g.attack < 4) g.attack++; break;
        case HEART: g.hp = MAX_HP; break;
    }
    *it = g.item[--g.nitem];
}

// Steps one cell in absolute direction k; walking into a monster attacks it.
static bool step(uint8_t k, uint32_t now) {
    int8_t      nx = g.x + DX[k], ny = g.y + DY[k];
    monster_t *m  = monster_at(nx, ny);
    if (m) {
        strike(m, now);
        return true;
    }
    if (!open_cell(nx, ny)) return false;
    g.x = nx;
    g.y = ny;
    pick_up();
    return true;
}

void dungeon_press(uint8_t button, uint32_t now_ms) {
    if (g.dead) {
        if (button == DUNGEON_ACT) dungeon_start(rnd(), now_ms);
        return;
    }
    g.hurt_recent = g.hit_recent = false;
    bool turn = false;
    switch (button) {
        case DUNGEON_TURN_LEFT: g.dir = (g.dir + 3) % 4; break;
        case DUNGEON_TURN_RIGHT: g.dir = (g.dir + 1) % 4; break;
        case DUNGEON_UP: turn = step(g.dir, now_ms); break;
        case DUNGEON_DOWN: turn = step((g.dir + 2) % 4, now_ms); break;
        case DUNGEON_LEFT: turn = step((g.dir + 3) % 4, now_ms); break;
        case DUNGEON_RIGHT: turn = step((g.dir + 1) % 4, now_ms); break;
        case DUNGEON_ACT: {
            int8_t      fx = g.x + DX[g.dir], fy = g.y + DY[g.dir];
            monster_t *m  = monster_at(fx, fy);
            if (m) {
                strike(m, now_ms);
                turn = true;
            } else if (at(fx, fy) == DOOR) {
                g.map[fy][fx] = FLOOR;
                turn          = true;
            } else if (at(g.x, g.y) == STAIRS) {
                if (g.depth < 99) g.depth++;
                new_floor(now_ms);
                return;
            }
            break;
        }
        case DUNGEON_BACK:
            if (g.potions && g.hp < MAX_HP) {
                g.potions--;
                g.hp = g.hp + 2 > MAX_HP ? MAX_HP : g.hp + 2;
                turn = true;
            }
            break;
        default: return;
    }
    if (turn) monsters_turn(now_ms);
    look();
}

// ------------------------------------------------------------------ drawing

static uint8_t *fb;
static int8_t   ox, oy; // shake offset for the view

static void px(int16_t x, int16_t y, bool on) {
    if (x < 0 || y < 0 || x >= DUNGEON_W || y >= DUNGEON_H) return;
    uint8_t *b = &fb[x + (y / 8) * DUNGEON_W];
    if (on) *b |= 1 << (y % 8);
    else *b &= ~(1 << (y % 8));
}
static void hline(int16_t x0, int16_t x1, int16_t y) {
    for (int16_t x = x0; x <= x1; x++) px(x, y, true);
}
static void vline(int16_t x, int16_t y0, int16_t y1) {
    for (int16_t y = y0; y <= y1; y++) px(x, y, true);
}
static void line_on(int16_t x0, int16_t y0, int16_t x1, int16_t y1, bool on) {
    int16_t dx = x1 > x0 ? x1 - x0 : x0 - x1, dy = y1 > y0 ? y0 - y1 : y1 - y0;
    int8_t  sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    int16_t e = dx + dy;
    for (;;) {
        px(x0, y0, on);
        if (x0 == x1 && y0 == y1) return;
        int16_t e2 = 2 * e;
        if (e2 >= dy) e += dy, x0 += sx;
        if (e2 <= dx) e += dx, y0 += sy;
    }
}

static void line(int16_t x0, int16_t y0, int16_t x1, int16_t y1) { line_on(x0, y0, x1, y1, true); }

// A sprite: one string per row, '#' lit. cut also clears a 1-pixel ring
// around the lit pixels, so it stands out against walls behind it.
static void sprite(const char *const *rows, uint8_t h, int16_t x, int16_t y, bool cut) {
    if (cut)
        for (uint8_t j = 0; j < h; j++)
            for (uint8_t i = 0; rows[j][i]; i++)
                if (rows[j][i] == '#')
                    for (int8_t a = -1; a <= 1; a++)
                        for (int8_t b = -1; b <= 1; b++) px(x + i + a, y + j + b, false);
    for (uint8_t j = 0; j < h; j++)
        for (uint8_t i = 0; rows[j][i]; i++)
            if (rows[j][i] == '#') px(x + i, y + j, true);
}

// The same sprite at half size: a pixel lit when any of its 2x2 is.
static void sprite_half(const char *const *rows, uint8_t h, int16_t x, int16_t y) {
    uint8_t w = strlen(rows[0]);
    for (uint8_t pass = 0; pass < 2; pass++)
        for (uint8_t j = 0; j < h; j += 2)
            for (uint8_t i = 0; i < w; i += 2) {
                bool on = rows[j][i] == '#' || rows[j][i + 1] == '#' || (j + 1 < h && (rows[j + 1][i] == '#' || rows[j + 1][i + 1] == '#'));
                if (!on) continue;
                if (pass == 0)
                    for (int8_t a = -1; a <= 1; a++)
                        for (int8_t b = -1; b <= 1; b++) px(x + i / 2 + a, y + j / 2 + b, false);
                else px(x + i / 2, y + j / 2, true);
            }
}

#define SPR(name, ...) static const char *const name[] = {__VA_ARGS__}
#define LEN(a) (sizeof(a) / sizeof(a[0]))

SPR(SK_BIG, "...####...", "..######..", "..#..#..#.", "..######..", "...#..#...", "....##....", ".########.", "#..####..#", "#..#..#..#", "...####...", "....##....", "...#..#...", "...#..#...", "..##..##..");
SPR(RAT_BIG, "##......##", "###....###", ".########.", ".#..##..#.", ".########.", "..##..##..", "...####...", "..#.##.#..");
SPR(BAT_BIG, "#..........#", "##..#..#..##", "###.####.###", "############", ".##.#..#.##.", "....####....", ".....##.....");
SPR(SLIME_BIG, "....####....", "..########..", ".##########.", ".#..####..#.", ".##########.", "############", "############", ".##########.");
static const struct {
    const char *const *rows;
    uint8_t            h;
    bool               flies;
} LOOK[KINDS] = {
    [RAT]      = {RAT_BIG, LEN(RAT_BIG), false},
    [BAT]      = {BAT_BIG, LEN(BAT_BIG), true},
    [SKELETON] = {SK_BIG, LEN(SK_BIG), false},
    [SLIME]    = {SLIME_BIG, LEN(SLIME_BIG), false},
};

SPR(HEART_FULL, ".#.#.", "#####", "#####", ".###.", "..#..");
SPR(HEART_EMPTY, ".#.#.", "#.#.#", "#...#", ".#.#.", "..#..");
SPR(STAIRS_ICON, "....##", "...###", "..####", ".#####", "######");
SPR(POTION_ICON, ".#.", ".#.", "#.#", "###", "###");
SPR(SWORD_ICON, "....#", "...#.", "#.#..", ".#...", "#.#..");
SPR(SKULL, "..######..", ".########.", "##..##..##", "##..##..##", "##########", "....##....", ".########.", "..#.##.#..");
SPR(DIGITS0, "###", "#.#", "#.#", "#.#", "###");
SPR(DIGITS1, ".#.", "##.", ".#.", ".#.", "###");
SPR(DIGITS2, "##.", "..#", ".#.", "#..", "###");
SPR(DIGITS3, "##.", "..#", ".#.", "..#", "##.");
SPR(DIGITS4, "#.#", "#.#", "###", "..#", "..#");
SPR(DIGITS5, "###", "#..", "##.", "..#", "##.");
SPR(DIGITS6, ".##", "#..", "###", "#.#", "###");
SPR(DIGITS7, "###", "..#", ".#.", ".#.", ".#.");
SPR(DIGITS8, "###", "#.#", "###", "#.#", "###");
SPR(DIGITS9, "###", "#.#", "###", "..#", "##.");
static const char *const *const DIGIT[10] = {DIGITS0, DIGITS1, DIGITS2, DIGITS3, DIGITS4, DIGITS5, DIGITS6, DIGITS7, DIGITS8, DIGITS9};

// Draws n; returns the x after it.
static int16_t number(uint8_t n, int16_t x, int16_t y) {
    if (n >= 10) {
        sprite(DIGIT[n / 10], 5, x, y, false);
        x += 4;
    }
    sprite(DIGIT[n % 10], 5, x, y, false);
    return x + 4;
}

// The view's depth planes: the near edge of the cell f steps ahead.
#define DEPTHS 4
static const struct {
    int8_t x0, x1, y0, y1;
} B[DEPTHS] = {{0, 31, 0, 43}, {6, 25, 8, 35}, {10, 21, 14, 30}, {13, 18, 17, 26}};

// The cell f ahead and s to the side (+1 right) of the player.
static void rel(int8_t f, int8_t s, int8_t *x, int8_t *y) {
    uint8_t r = (g.dir + 1) % 4;
    *x        = g.x + f * DX[g.dir] + s * DX[r];
    *y        = g.y + f * DY[g.dir] + s * DY[r];
}

// How far ahead the view reaches before a wall or a door closes it.
static int8_t view_depth(void) {
    int8_t depth = 1;
    while (depth < DEPTHS) {
        int8_t x, y;
        rel(depth, 0, &x, &y);
        if (at(x, y) == WALL || at(x, y) == DOOR) break;
        depth++;
    }
    return depth;
}

// Puts what the view shows on the automap.
static void look(void) {
    int8_t depth = view_depth(), x, y;
    for (int8_t f = 0; f <= depth && f < DEPTHS; f++)
        for (int8_t s = -1; s <= 1; s++) {
            rel(f, s, &x, &y);
            see(x, y);
        }
}

// The side wall of cell f on side s (-1 left, +1 right), seen at an angle.
static void side_wall(int8_t f, int8_t s, bool door, bool torch, uint32_t now) {
    int16_t xa = s < 0 ? B[f].x0 : B[f].x1, xb = s < 0 ? B[f + 1].x0 : B[f + 1].x1;
    line(xa + ox, B[f].y0 + oy, xb + ox, B[f + 1].y0 + oy);
    line(xa + ox, B[f].y1 + oy, xb + ox, B[f + 1].y1 + oy);
    vline(xb + ox, B[f + 1].y0 + oy, B[f + 1].y1 + oy);
    if (f > 0) vline(xa + ox, B[f].y0 + oy, B[f].y1 + oy);
    int16_t xm = (xa + xb) / 2;
    if (door) {
        // a door edge down the middle of the wall, from below the top line
        int16_t top = (B[f].y0 + B[f + 1].y0) / 2 + 3, bottom = (B[f].y1 + B[f + 1].y1) / 2;
        vline(xm + ox, top + oy, bottom + oy);
        vline(xm + (s < 0 ? 1 : -1) * 2 + ox, top + 1 + oy, bottom + oy);
    } else if (torch && f == 0) {
        int16_t ty = 15 + oy;
        vline(xm + ox, ty + 3, ty + 7);
        hline(xm - 1 + ox, xm + 1 + ox, ty + 3);
        // the flame leans one way, then the other
        bool lean = (now / 300) % 2;
        px(xm + ox, ty + 2, true);
        px(xm + (lean ? 1 : -1) + ox, ty + 1, true);
        px(xm + ox, ty, true);
    }
}

// The face of the cell beside cell f (seen through an opening at f), at plane f+1.
static void side_face(int8_t f, int8_t s) {
    int16_t xa = s < 0 ? B[f].x0 : B[f].x1, xb = s < 0 ? B[f + 1].x0 : B[f + 1].x1;
    if (s < 0) {
        hline(xa + ox, xb + ox, B[f + 1].y0 + oy);
        hline(xa + ox, xb + ox, B[f + 1].y1 + oy);
    } else {
        hline(xb + ox, xa + ox, B[f + 1].y0 + oy);
        hline(xb + ox, xa + ox, B[f + 1].y1 + oy);
    }
    vline(xb + ox, B[f + 1].y0 + oy, B[f + 1].y1 + oy);
}

// The wall straight ahead at plane f.
static void front_wall(int8_t f, bool door) {
    hline(B[f].x0 + ox, B[f].x1 + ox, B[f].y0 + oy);
    hline(B[f].x0 + ox, B[f].x1 + ox, B[f].y1 + oy);
    vline(B[f].x0 + ox, B[f].y0 + oy, B[f].y1 + oy);
    vline(B[f].x1 + ox, B[f].y0 + oy, B[f].y1 + oy);
    if (!door) return;
    int16_t w = (B[f].x1 - B[f].x0) / 4, h = (B[f].y1 - B[f].y0) * 2 / 3;
    int16_t cx = (B[f].x0 + B[f].x1 + 1) / 2;
    int16_t x0 = cx - w, x1 = cx + w - 1, y0 = B[f].y1 - h;
    hline(x0 + ox, x1 + ox, y0 + oy);
    vline(x0 + ox, y0 + oy, B[f].y1 + oy);
    vline(x1 + ox, y0 + oy, B[f].y1 + oy);
    px(x1 - 2 + ox, (y0 + B[f].y1) / 2 + oy, true);
}

// Stairs down: an opening in the floor of cell f, wider at its near edge as
// the floor is, with steps going down from its far edge.
static void floor_point(int8_t f, uint8_t u, uint8_t v, int16_t *x, int16_t *y) {
    // u: 0 the far edge of the cell's floor .. 8 the near edge; v: 0 left .. 8 right
    int16_t xl = B[f + 1].x0 + (B[f].x0 - B[f + 1].x0) * u / 8;
    int16_t xr = B[f + 1].x1 + (B[f].x1 - B[f + 1].x1) * u / 8;
    *y         = B[f + 1].y1 + (B[f].y1 - B[f + 1].y1) * u / 8;
    *x         = xl + (xr - xl) * v / 8;
}

static void hole(int8_t f) {
    int16_t x0, y0, x1, y1, x2, y2, x3, y3;
    floor_point(f, 2, 2, &x0, &y0); // far left
    floor_point(f, 2, 6, &x1, &y1); // far right
    floor_point(f, 7, 1, &x2, &y2); // near left
    floor_point(f, 7, 7, &x3, &y3); // near right
    line(x0 + ox, y0 + oy, x1 + ox, y1 + oy);
    line(x2 + ox, y2 + oy, x3 + ox, y3 + oy);
    line(x0 + ox, y0 + oy, x2 + ox, y2 + oy);
    line(x1 + ox, y1 + oy, x3 + ox, y3 + oy);
    // steps: short lines under the far edge, each a little lower and narrower
    for (int16_t i = 1; y0 + 2 * i < y2 - 1; i++) hline(x0 + i + 1 + ox, x1 - i - 1 + ox, y0 + 2 * i + oy);
}

static void draw_monster(monster_t *m, int8_t f, uint32_t now) {
    const char *const *rows = LOOK[m->kind].rows;
    uint8_t            h = LOOK[m->kind].h, w = strlen(rows[0]);
    bool               bob = (now / 500 + m->x + m->y) % 2;
    // a monster just hit jumps aside for a moment
    int8_t jolt = g.hit_recent && now - g.hit_at < 200 && f == 1 ? 1 : 0;
    if (f == 1) {
        int16_t floor = 33, y = LOOK[m->kind].flies ? 14 + bob : floor - h + 1 - (bob && h > 8);
        sprite(rows, h, 16 - w / 2 + jolt + ox, y + oy, true);
        if (jolt) { // the blow: a lit slash with a dark edge, so it shows on any sprite
            int16_t x0 = 11 + ox, y0 = y - 1 + oy, x1 = 21 + ox, y1 = y + h - 1 + oy;
            line_on(x0 - 1, y0, x1 - 1, y1, false);
            line_on(x0 + 1, y0, x1 + 1, y1, false);
            line(x0, y0, x1, y1);
        }
    } else if (f == 2) {
        int16_t floor = 28, hh = (h + 1) / 2, y = LOOK[m->kind].flies ? 17 + bob : floor - hh + 1;
        sprite_half(rows, h, 16 - w / 4 + ox, y + oy);
    } else {
        int16_t y = LOOK[m->kind].flies ? 19 : 24;
        for (int8_t a = -1; a <= 2; a++)
            for (int8_t b = -1; b <= 2; b++) px(15 + a + ox, y + b + oy, a >= 0 && a <= 1 && b >= 0 && b <= 1);
    }
}

static void draw_item(item_t *it, int8_t f) {
    const char *const *rows = it->kind == POTION ? POTION_ICON : it->kind == SWORD ? SWORD_ICON : HEART_FULL;
    if (f == 1) sprite(rows, 5, 15 - (it->kind == POTION ? 0 : 1) + ox, 29 + oy, true);
    else if (f == 2) {
        px(15 + ox, 26 + oy, true);
        px(16 + ox, 26 + oy, true);
    }
}

static void draw_view(uint32_t now) {
    int8_t depth = view_depth();
    for (int8_t f = 0; f < depth && f < DEPTHS - 1; f++) {
        for (int8_t s = -1; s <= 1; s += 2) {
            int8_t x, y;
            rel(f, s, &x, &y);
            uint8_t t = at(x, y);
            if (t == WALL || t == DOOR) {
                side_wall(f, s, t == DOOR, (x * 7 + y * 3) % 5 == 0, now);
            } else {
                int8_t bx, by;
                rel(f + 1, s, &bx, &by);
                if (at(bx, by) == WALL || at(bx, by) == DOOR) side_face(f, s);
            }
        }
        // the floor line where cell f ends
        if (f > 0) hline(B[f].x0 + ox, B[f].x1 + ox, B[f].y1 + oy);
        int8_t x, y;
        rel(f, 0, &x, &y);
        if (at(x, y) == STAIRS) hole(f);
    }
    if (depth < DEPTHS) {
        int8_t x, y;
        rel(depth, 0, &x, &y);
        front_wall(depth, at(x, y) == DOOR);
    }
    // what stands in the way, far to near
    for (int8_t f = depth - 1; f >= 1; f--) {
        int8_t x, y;
        rel(f, 0, &x, &y);
        item_t *it = item_at(x, y);
        if (it) draw_item(it, f);
        monster_t *m = monster_at(x, y);
        if (m) draw_monster(m, f, now);
    }
    hline(0, 31, 43 + oy);
}

// A tick on the view's edge for a monster beside or behind the player.
static void draw_threats(void) {
    for (uint8_t i = 0; i < g.nmon; i++) {
        monster_t *m = &g.mon[i];
        if (dist(m->x, m->y, g.x, g.y) != 1) continue;
        uint8_t k = 0;
        for (; k < 4; k++)
            if (g.x + DX[k] == m->x && g.y + DY[k] == m->y) break;
        uint8_t side = (k + 4 - g.dir) % 4; // 0 ahead, 1 right, 2 behind, 3 left
        if (side == 1) {
            vline(31, 18, 25);
            vline(30, 20, 23);
        } else if (side == 3) {
            vline(0, 18, 25);
            vline(1, 20, 23);
        } else if (side == 2) {
            hline(12, 19, 42);
            hline(14, 17, 41);
        }
    }
}

// The explored map around the player, 8 x 14 cells of 4 px.
#define AM_Y 47
static void draw_automap(void) {
    int8_t x0 = g.x - 4, y0 = g.y - 7;
    if (x0 < 0) x0 = 0;
    if (x0 > MAP - 8) x0 = MAP - 8;
    if (y0 < 0) y0 = 0;
    if (y0 > MAP - 14) y0 = MAP - 14;
    for (int8_t cy = 0; cy < 14; cy++)
        for (int8_t cx = 0; cx < 8; cx++) {
            int8_t  x = x0 + cx, y = y0 + cy;
            int16_t ax = cx * 4, ay = AM_Y + cy * 4;
            uint8_t t  = at(x, y);
            if (!seen(x, y) || t == WALL) continue;
            if (t == STAIRS) {
                px(ax + 3, ay, true);
                hline(ax + 2, ax + 3, ay + 1);
                hline(ax + 1, ax + 3, ay + 2);
                hline(ax, ax + 3, ay + 3);
                continue;
            }
            // a corridor two pixels wide, joined to its seen neighbours
            hline(ax + 1, ax + 2, ay + 1);
            hline(ax + 1, ax + 2, ay + 2);
            if (seen(x + 1, y) && at(x + 1, y) != WALL) {
                hline(ax + 3, ax + 4, ay + 1);
                hline(ax + 3, ax + 4, ay + 2);
            }
            if (seen(x, y + 1) && at(x, y + 1) != WALL) {
                vline(ax + 1, ay + 3, ay + 4);
                vline(ax + 2, ay + 3, ay + 4);
            }
            // rooms fill in rather than turning into a grid of dots
            if (seen(x + 1, y + 1) && at(x + 1, y + 1) != WALL && at(x + 1, y) != WALL && at(x, y + 1) != WALL && seen(x + 1, y) && seen(x, y + 1)) {
                hline(ax + 3, ax + 4, ay + 3);
                hline(ax + 3, ax + 4, ay + 4);
            }
            if (t == DOOR) { // a hollow square
                hline(ax, ax + 3, ay);
                hline(ax, ax + 3, ay + 3);
                vline(ax, ay, ay + 3);
                vline(ax + 3, ay, ay + 3);
                hline(ax + 1, ax + 2, ay + 1);
                for (int8_t i = 1; i <= 2; i++)
                    for (int8_t j = 1; j <= 2; j++) px(ax + i, ay + j, false);
            }
        }
    // the player: an arrow the way it faces, cut out of the corridor
    int16_t ax = (g.x - x0) * 4, ay = AM_Y + (g.y - y0) * 4;
    for (int8_t a = -1; a <= 4; a++)
        for (int8_t b = -1; b <= 4; b++) px(ax + a, ay + b, false);
    static const char *const ARROW[4][4] = {
        {".##.", ".##.", "####", "#..#"},
        {"##..", ".###", ".###", "##.."},
        {"#..#", "####", ".##.", ".##."},
        {"..##", "###.", "###.", "..##"},
    };
    sprite(ARROW[g.dir], 4, ax, ay, false);
}

static void draw_status(void) {
    for (int16_t x = 0; x < DUNGEON_W; x += 2) px(x, 105, true);
    for (uint8_t i = 0; i < MAX_HP; i++) sprite(i < g.hp ? HEART_FULL : HEART_EMPTY, 5, 1 + i * 6, 109, false);
    sprite(STAIRS_ICON, 5, 0, 119, false);
    number(g.depth, 8, 119);
    if (g.attack > 1) {
        sprite(SWORD_ICON, 5, 16, 119, false);
        number(g.attack, 21, 119) ;
    }
    if (g.potions) {
        sprite(POTION_ICON, 5, 25, 119, false);
        number(g.potions, 29, 119);
    }
}

static void draw_dead(void) {
    sprite(SKULL, LEN(SKULL), 11, 10, false);
    sprite(STAIRS_ICON, 5, 6, 26, false);
    number(g.depth, 14, 26);
    if (g.best > 1) {
        // the best run so far, under a crown
        static const char *const CROWN[] = {"#.#.#", "#####", "#####"};
        sprite(CROWN, 3, 7, 35, false);
        number(g.best, 14, 34);
    }
    hline(0, 31, 43);
}

void dungeon_render(uint8_t frame[DUNGEON_FRAME_SIZE], uint32_t now_ms) {
    fb = frame;
    memset(frame, 0, DUNGEON_FRAME_SIZE);
    ox = oy = 0;
    if (g.dead) {
        draw_dead();
    } else {
        // a blow taken shakes the view for a moment
        if (g.hurt_recent && now_ms - g.hurt_at < 240) ox = ((now_ms - g.hurt_at) / 60) % 2 ? 1 : -1;
        draw_view(now_ms);
        ox = 0;
        draw_threats();
    }
    draw_automap();
    draw_status();
}

#ifdef DUNGEON_SIM
// For the simulator's scenes and tests only: puts something f cells ahead,
// clearing the way to it. what: r b k m (rat bat skeleton slime), p s h
// (potion sword heart), > (stairs).
void dungeon_sim_put(uint8_t f, char what) {
    int8_t x, y;
    for (uint8_t i = 1; i <= f; i++) {
        rel(i, 0, &x, &y);
        if (x <= 0 || y <= 0 || x >= MAP - 1 || y >= MAP - 1) return;
        if (g.map[y][x] != STAIRS) g.map[y][x] = FLOOR;
    }
    const char *mons = "rbkm", *items = "psh";
    for (uint8_t k = 0; mons[k]; k++)
        if (what == mons[k] && g.nmon < MAX_MONSTERS && !monster_at(x, y))
            g.mon[g.nmon++] = (monster_t){.x = x, .y = y, .kind = k, .hp = KIND[k].hp, .awake = true};
    for (uint8_t k = 0; items[k]; k++)
        if (what == items[k] && g.nitem < MAX_ITEMS && !item_at(x, y)) g.item[g.nitem++] = (item_t){.x = x, .y = y, .kind = k};
    if (what == '>') g.map[y][x] = STAIRS;
    look();
}

// 0 kills the player.
void dungeon_sim_hp(uint8_t hp) {
    g.hp = hp > MAX_HP ? MAX_HP : hp;
    if (!hp) {
        g.dead = true;
        if (g.depth > g.best) g.best = g.depth;
    }
}
#endif
