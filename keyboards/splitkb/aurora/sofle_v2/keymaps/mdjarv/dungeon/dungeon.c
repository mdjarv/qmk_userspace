// A first-person grid crawler. Each floor is a 16x16 maze with a few rooms,
// loops and doors; find the stairs and go down. Turn-based: turning is free,
// every other action gives the monsters a turn.
//
// The rules live here; view.c draws the left screen, hud.c the right one.
#include "dungeon_internal.h"
#include <string.h>

// ------------------------------------------------------------------ the map

const int8_t DX[4] = {0, 1, 0, -1}, DY[4] = {-1, 0, 1, 0};

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


dungeon_game_t dg;

static uint32_t rnd(void) { // xorshift32; never 0
    dg.rng ^= dg.rng << 13;
    dg.rng ^= dg.rng >> 17;
    dg.rng ^= dg.rng << 5;
    return dg.rng;
}
static uint8_t roll(uint8_t n) { return rnd() % n; }

uint8_t dg_at(int8_t x, int8_t y) { return x < 0 || y < 0 || x >= MAP || y >= MAP ? WALL : dg.map[y][x]; }
static bool    open_cell(int8_t x, int8_t y) { return dg_at(x, y) == FLOOR || dg_at(x, y) == STAIRS; }

monster_t *dg_monster_at(int8_t x, int8_t y) {
    for (uint8_t i = 0; i < dg.nmon; i++)
        if (dg.mon[i].x == x && dg.mon[i].y == y) return &dg.mon[i];
    return NULL;
}

item_t *dg_item_at(int8_t x, int8_t y) {
    for (uint8_t i = 0; i < dg.nitem; i++)
        if (dg.item[i].x == x && dg.item[i].y == y) return &dg.item[i];
    return NULL;
}

static void see(int8_t x, int8_t y) {
    if (x >= 0 && y >= 0 && x < MAP && y < MAP) dg.seen[y] |= 1u << x;
}
bool dg_seen(int8_t x, int8_t y) { return x >= 0 && y >= 0 && x < MAP && y < MAP && (dg.seen[y] >> x & 1); }

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
            if (dg_at(nx, ny) == WALL || d[ny][nx] != 255) continue;
            d[ny][nx] = d[cy][cx] + 1;
            q[tail++] = ny * MAP + nx;
        }
    }
}

// A random floor cell at least min_dist from the player with nothing on it.
static bool free_cell(uint8_t d[MAP][MAP], uint8_t min_dist, uint8_t *ox, uint8_t *oy) {
    for (uint8_t tries = 0; tries < 200; tries++) {
        uint8_t x = roll(MAP), y = roll(MAP);
        if (dg.map[y][x] != FLOOR || d[y][x] == 255 || d[y][x] < min_dist) continue;
        if (dg_monster_at(x, y) || dg_item_at(x, y)) continue;
        *ox = x;
        *oy = y;
        return true;
    }
    return false;
}

// The cell f ahead and s to the side (+1 right) of the player.
static void rel(int8_t f, int8_t s, int8_t *x, int8_t *y) {
    uint8_t r = (dg.dir + 1) % 4;
    *x        = dg.x + f * DX[dg.dir] + s * DX[r];
    *y        = dg.y + f * DY[dg.dir] + s * DY[r];
}

#define SIGHT 6 // cells ahead the view can show
// Puts what the view shows on the map: the way ahead until something closes
// it, and what is either side of it.
static void look(void) {
    int8_t x, y;
    for (int8_t f = 0; f <= SIGHT; f++) {
        for (int8_t s = -1; s <= 1; s++) {
            rel(f, s, &x, &y);
            see(x, y);
        }
        rel(f, 0, &x, &y);
        if (f > 0 && !open_cell(x, y)) break;
    }
}

static void new_floor(uint32_t now) {
    // A maze on the odd cells (recursive backtracker)...
    memset(dg.map, WALL, sizeof(dg.map));
    memset(dg.seen, 0, sizeof(dg.seen));
    static uint8_t stack[64];
    uint8_t        sp = 0, cx = 1 + 2 * roll(7), cy = 1 + 2 * roll(7);
    dg.map[cy][cx]     = FLOOR;
    stack[sp++]       = cy * MAP + cx;
    while (sp) {
        cx = stack[sp - 1] % MAP;
        cy = stack[sp - 1] / MAP;
        uint8_t options[4], n = 0;
        for (uint8_t k = 0; k < 4; k++) {
            int8_t nx = cx + 2 * DX[k], ny = cy + 2 * DY[k];
            if (nx > 0 && ny > 0 && nx < MAP - 1 && ny < MAP - 1 && dg.map[ny][nx] == WALL) options[n++] = k;
        }
        if (!n) {
            sp--;
            continue;
        }
        uint8_t k                        = options[roll(n)];
        dg.map[cy + DY[k]][cx + DX[k]]    = FLOOR;
        dg.map[cy + 2 * DY[k]][cx + 2 * DX[k]] = FLOOR;
        stack[sp++]                      = (cy + 2 * DY[k]) * MAP + cx + 2 * DX[k];
    }
    // ...with two rooms and some loops, so it is not all dead ends...
    for (uint8_t r = 0; r < 2; r++) {
        uint8_t rx = 1 + 2 * roll(6), ry = 1 + 2 * roll(6);
        for (uint8_t y = ry; y < ry + 3; y++)
            for (uint8_t x = rx; x < rx + 3; x++) dg.map[y][x] = FLOOR;
    }
    for (uint8_t i = 0; i < 10; i++) {
        uint8_t x = 1 + roll(MAP - 2), y = 1 + roll(MAP - 2);
        if (dg.map[y][x] == WALL && ((x % 2) != (y % 2)) && x < MAP - 1 && y < MAP - 1) dg.map[y][x] = FLOOR;
    }
    // ...and doors in some passages: a cell with walls on two opposite sides.
    for (uint8_t y = 1; y < MAP - 1; y++)
        for (uint8_t x = 1; x < MAP - 1; x++) {
            if (dg.map[y][x] != FLOOR || (x % 2) == (y % 2) || roll(6)) continue;
            bool ns = dg.map[y - 1][x] == WALL && dg.map[y + 1][x] == WALL && dg.map[y][x - 1] != WALL && dg.map[y][x + 1] != WALL;
            bool ew = dg.map[y][x - 1] == WALL && dg.map[y][x + 1] == WALL && dg.map[y - 1][x] != WALL && dg.map[y + 1][x] != WALL;
            if (ns || ew) dg.map[y][x] = DOOR;
        }

    // The player starts on a random odd cell, facing an open way.
    dg.x = 1 + 2 * roll(7);
    dg.y = 1 + 2 * roll(7);
    dg.map[dg.y][dg.x] = FLOOR;
    for (uint8_t k = 0; k < 4; k++)
        if (dg_at(dg.x + DX[k], dg.y + DY[k]) == FLOOR) dg.dir = k;

    // The stairs go where it is farthest to walk.
    static uint8_t d[MAP][MAP];
    distances(dg.x, dg.y, d);
    uint8_t sx = dg.x, sy = dg.y;
    for (uint8_t y = 0; y < MAP; y++)
        for (uint8_t x = 0; x < MAP; x++)
            if (dg.map[y][x] == FLOOR && d[y][x] != 255 && d[y][x] > d[sy][sx]) {
                sx = x;
                sy = y;
            }
    dg.map[sy][sx] = STAIRS;

    dg.nmon = 0;
    dg.nitem = 0;
    uint8_t want = 3 + dg.depth;
    if (want > MAX_MONSTERS) want = MAX_MONSTERS;
    while (dg.nmon < want) {
        monster_t *m = &dg.mon[dg.nmon];
        if (!free_cell(d, 4, &m->x, &m->y)) break;
        do m->kind = roll(KINDS);
        while (KIND[m->kind].first > dg.depth);
        m->hp    = KIND[m->kind].hp;
        m->awake = false;
        dg.nmon++;
    }
    static const uint8_t loot[] = {POTION, POTION, SWORD, HEART};
    uint8_t              nloot  = 2 + roll(2);
    for (uint8_t i = 0; i < nloot && dg.nitem < MAX_ITEMS; i++) {
        item_t *it = &dg.item[dg.nitem];
        if (!free_cell(d, 2, &it->x, &it->y)) break;
        it->kind  = loot[roll(dg.depth % 3 == 0 ? 4 : 2)]; // swords and hearts on every third floor
        it->level = 2 + dg.depth / 3 > 4 ? 4 : 2 + dg.depth / 3;
        dg.nitem++;
    }
    look();
    dg.floor_at = now;
    dg.floors++;
    dg.version++;
}

void dungeon_start(uint32_t seed, uint32_t now_ms) {
    uint8_t  best = dg.best;
    uint32_t version = dg.version, floors = dg.floors;
    memset(&dg, 0, sizeof(dg));
    dg.best    = best;
    dg.version = version + 1;
    dg.floors  = floors;
    dg.rng     = seed ? seed : 1;
    dg.hp      = MAX_HP;
    dg.attack  = 1;
    dg.depth   = 1;
    for (uint8_t k = 0; k < PACK; k++) dg.pack[k].kind = NOTHING;
    dg.pack[0].kind = POTION;
    new_floor(now_ms);
}

// ------------------------------------------------------------------ turns

uint8_t dg_dist(int8_t x0, int8_t y0, int8_t x1, int8_t y1) {
    return (x0 > x1 ? x0 - x1 : x1 - x0) + (y0 > y1 ? y0 - y1 : y1 - y0);
}

static bool monster_can_enter(int8_t x, int8_t y) {
    return open_cell(x, y) && !dg_monster_at(x, y) && !(x == dg.x && y == dg.y);
}

static void monsters_turn(uint32_t now) {
    dg.turn++;
    for (uint8_t i = 0; i < dg.nmon; i++) {
        monster_t *m = &dg.mon[i];
        uint8_t    d = dg_dist(m->x, m->y, dg.x, dg.y);
        if (d <= 4) m->awake = true;
        if (!m->awake) continue;
        if (d == 1) {
            if (roll(100) < KIND[m->kind].hit) {
                dg.hp        = dg.hp > KIND[m->kind].dmg ? dg.hp - KIND[m->kind].dmg : 0;
                dg.hurt_at = now;
                dg.hurt    = true;
                if (!dg.hp) {
                    dg.dead = true;
                    if (dg.depth > dg.best) dg.best = dg.depth;
                    return;
                }
            }
            continue;
        }
        if (KIND[m->kind].slow && (dg.turn & 1)) continue;
        // Step along the longer way to the player, else the other.
        int8_t ddx = dg.x > m->x ? 1 : dg.x < m->x ? -1 : 0;
        int8_t ddy = dg.y > m->y ? 1 : dg.y < m->y ? -1 : 0;
        bool   xfirst = dg_dist(m->x, 0, dg.x, 0) >= dg_dist(0, m->y, 0, dg.y);
        if (xfirst && ddx && monster_can_enter(m->x + ddx, m->y)) m->x += ddx;
        else if (ddy && monster_can_enter(m->x, m->y + ddy)) m->y += ddy;
        else if (!xfirst && ddx && monster_can_enter(m->x + ddx, m->y)) m->x += ddx;
    }
}

static void strike(monster_t *m, uint32_t now) {
    dg.swing_at = now;
    dg.swung    = true;
    if (roll(100) < 80) {
        dg.hit_at = now;
        dg.hit    = true;
        if (m->hp <= dg.attack) {
            *m = dg.mon[--dg.nmon]; // dead: the last one takes its place
            return;
        }
        m->hp -= dg.attack;
    }
    m->awake = true;
}

uint8_t dg_potions(void) {
    uint8_t n = 0;
    for (uint8_t k = 0; k < PACK; k++) n += dg.pack[k].kind == POTION;
    return n;
}

// A heart heals at once; potions and swords go in the pack, if it has room.
static void pick_up(void) {
    item_t *it = dg_item_at(dg.x, dg.y);
    if (!it) return;
    if (it->kind == HEART) {
        dg.hp = MAX_HP;
    } else {
        uint8_t k = 0;
        while (k < PACK && dg.pack[k].kind != NOTHING) k++;
        if (k == PACK) return; // full: it stays on the floor
        dg.pack[k] = (carried_t){it->kind, it->level};
    }
    *it = dg.item[--dg.nitem];
}

// Where the inventory cursor goes from each slot: up, down, left, right.
// The hands are a row of two over the pack's rows of three.
static const uint8_t MOVE[4][SLOTS] = {
    {SLOT_TORCH, SLOT_WEAPON, SLOT_TORCH, SLOT_WEAPON, SLOT_WEAPON, SLOT_PACK, SLOT_PACK + 1, SLOT_PACK + 2},
    {SLOT_PACK, SLOT_PACK + 2, SLOT_PACK + 3, SLOT_PACK + 4, SLOT_PACK + 5, SLOT_PACK + 3, SLOT_PACK + 4, SLOT_PACK + 5},
    {SLOT_TORCH, SLOT_TORCH, SLOT_PACK, SLOT_PACK, SLOT_PACK + 1, SLOT_PACK + 3, SLOT_PACK + 3, SLOT_PACK + 4},
    {SLOT_WEAPON, SLOT_WEAPON, SLOT_PACK + 1, SLOT_PACK + 2, SLOT_PACK + 2, SLOT_PACK + 4, SLOT_PACK + 5, SLOT_PACK + 5},
};

// A key while the inventory is open. Returns whether it used a turn.
static bool menu_press(uint8_t button) {
    switch (button) {
        case DUNGEON_UP: dg.cursor = MOVE[0][dg.cursor]; return false;
        case DUNGEON_DOWN: dg.cursor = MOVE[1][dg.cursor]; return false;
        case DUNGEON_LEFT: dg.cursor = MOVE[2][dg.cursor]; return false;
        case DUNGEON_RIGHT: dg.cursor = MOVE[3][dg.cursor]; return false;
        case DUNGEON_BACK:
        case DUNGEON_MENU: dg.menu = false; return false;
        case DUNGEON_ACT: break;
        default: return false;
    }
    if (dg.cursor < SLOT_PACK) return false;
    carried_t *c = &dg.pack[dg.cursor - SLOT_PACK];
    if (c->kind == POTION && dg.hp < MAX_HP) { // drinking takes a turn
        dg.hp   = dg.hp + 2 > MAX_HP ? MAX_HP : dg.hp + 2;
        c->kind = NOTHING;
        return true;
    }
    if (c->kind == SWORD) { // swords swap hands for free
        uint8_t level = c->level;
        c->level      = dg.attack;
        dg.attack     = level;
    }
    return false;
}

// Steps one cell in absolute direction k; walking into a monster attacks it.
static bool step(uint8_t k, uint32_t now) {
    int8_t      nx = dg.x + DX[k], ny = dg.y + DY[k];
    monster_t *m  = dg_monster_at(nx, ny);
    if (m) {
        strike(m, now);
        return true;
    }
    if (!open_cell(nx, ny)) return false;
    dg.x = nx;
    dg.y = ny;
    pick_up();
    return true;
}

void dungeon_press(uint8_t button, uint32_t now_ms) {
    if (dg.dead) {
        if (button == DUNGEON_ACT) dungeon_start(rnd(), now_ms);
        return;
    }
    dg.swung = dg.hit = dg.hurt = false;
    dg.version++;
    dg.pressed_at = now_ms;
    bool turn = false;
    if (dg.menu) {
        if (menu_press(button)) monsters_turn(now_ms);
        return;
    }
    switch (button) {
        case DUNGEON_TURN_LEFT: dg.dir = (dg.dir + 3) % 4; break;
        case DUNGEON_TURN_RIGHT: dg.dir = (dg.dir + 1) % 4; break;
        case DUNGEON_UP: turn = step(dg.dir, now_ms); break;
        case DUNGEON_DOWN: turn = step((dg.dir + 2) % 4, now_ms); break;
        case DUNGEON_LEFT: turn = step((dg.dir + 3) % 4, now_ms); break;
        case DUNGEON_RIGHT: turn = step((dg.dir + 1) % 4, now_ms); break;
        case DUNGEON_ACT: {
            // the sword swings whatever is there, so a press always shows;
            // it lands only on a monster in the next cell
            dg.swing_at = now_ms;
            dg.swung    = true;
            int8_t      fx = dg.x + DX[dg.dir], fy = dg.y + DY[dg.dir];
            monster_t *m  = dg_monster_at(fx, fy);
            if (m) {
                strike(m, now_ms);
                turn = true;
            } else if (dg_at(fx, fy) == DOOR) {
                dg.map[fy][fx] = FLOOR;
                turn          = true;
            } else if (dg_at(dg.x, dg.y) == STAIRS) {
                if (dg.depth < 99) dg.depth++;
                new_floor(now_ms);
                return;
            }
            break;
        }
        case DUNGEON_MENU: dg.menu = true; break;
        default: return;
    }
    if (turn) monsters_turn(now_ms);
    look();
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
        if (dg.map[y][x] != STAIRS) dg.map[y][x] = FLOOR;
    }
    const char *mons = "rbkm", *items = "psh";
    for (uint8_t k = 0; mons[k]; k++)
        if (what == mons[k] && dg.nmon < MAX_MONSTERS && !dg_monster_at(x, y))
            dg.mon[dg.nmon++] = (monster_t){.x = x, .y = y, .kind = k, .hp = KIND[k].hp, .awake = true};
    for (uint8_t k = 0; items[k]; k++)
        if (what == items[k] && dg.nitem < MAX_ITEMS && !dg_item_at(x, y)) dg.item[dg.nitem++] = (item_t){.x = x, .y = y, .kind = k, .level = 2};
    if (what == '>') dg.map[y][x] = STAIRS;
    look();
    dg.version++;
}

// 0 kills the player.
void dungeon_sim_hp(uint8_t hp) {
    dg.hp = hp > MAX_HP ? MAX_HP : hp;
    dg.version++;
    if (!hp) {
        dg.dead = true;
        if (dg.depth > dg.best) dg.best = dg.depth;
    }
}
#endif
