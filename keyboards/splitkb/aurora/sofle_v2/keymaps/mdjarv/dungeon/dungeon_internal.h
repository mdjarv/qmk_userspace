// The game state and rules shared by the core's files: dungeon.c (rules),
// view.c (the left screen), hud.c (the right screen). Not part of the API.
#pragma once

#include "dungeon.h"

#define MAP 16
enum { FLOOR, WALL, DOOR, STAIRS };
enum { N, E, S, W };
extern const int8_t DX[4], DY[4];

#define MAX_HP 5
#define MAX_MONSTERS 12
#define MAX_ITEMS 6

enum { RAT, BAT, SKELETON, SLIME, KINDS };
enum { POTION, SWORD, HEART, NOTHING = 0xFF };

typedef struct {
    uint8_t x, y, kind, hp;
    bool    awake;
} monster_t;

typedef struct {
    uint8_t x, y, kind;
    uint8_t level; // a sword's strength
} item_t;

// The inventory: the torch and the weapon in hand, then the pack. The cursor
// moves over these slots in this order.
#define PACK 6
enum { SLOT_TORCH, SLOT_WEAPON, SLOT_PACK, SLOTS = SLOT_PACK + PACK };
typedef struct {
    uint8_t kind, level; // kind NOTHING: empty
} carried_t;

typedef struct {
    uint32_t  rng;
    uint8_t   map[MAP][MAP];
    uint16_t  seen[MAP]; // bit x of row y: shown on the map
    uint8_t   x, y, dir;
    uint8_t   hp, depth, best;
    uint8_t   attack; // the sword in hand
    carried_t pack[PACK];
    bool      menu;   // the keys work the inventory
    uint8_t   cursor; // its slot
    bool      dead;
    uint32_t  turn;
    uint32_t  version; // changes with anything the screens show
    monster_t mon[MAX_MONSTERS];
    uint8_t   nmon;
    item_t    item[MAX_ITEMS];
    uint8_t   nitem;
    // what just happened, for the screens to show for a moment
    uint32_t pressed_at, swing_at, hit_at, hurt_at, floor_at;
    bool     swung, hit, hurt;
} dungeon_game_t;

extern dungeon_game_t dg;

uint8_t    dg_at(int8_t x, int8_t y);
bool       dg_seen(int8_t x, int8_t y);
monster_t *dg_monster_at(int8_t x, int8_t y);
item_t    *dg_item_at(int8_t x, int8_t y);
uint8_t    dg_dist(int8_t x0, int8_t y0, int8_t x1, int8_t y1);
uint8_t    dg_potions(void);
