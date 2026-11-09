// The right screen: the explored map around the player (north up), then
// what the hero carries.
//
// It is drawn from a small state (DUNGEON_HUD_STATE bytes) rather than from
// the game: on the keyboard the game runs on the other half, which sends the
// state across the split link, so this half can draw the screen itself.
#include "dungeon_internal.h"
#include "draw.h"
#include <string.h>

// The map window: 8 x 20 cells of 4 px, plus one more column and row so the
// corridors at its right and bottom edges join up as on the rest of the map.
#define AM_COLS 8
#define AM_ROWS 20
#define WIN_COLS (AM_COLS + 1)
#define WIN_ROWS (AM_ROWS + 1)
enum { CELL_NONE, CELL_FLOOR, CELL_DOOR, CELL_STAIRS }; // NONE: a wall, or not seen yet

// The state, byte by byte:
//   [0..47]  the window's cells, 2 bits each, row by row
//   [48]     player column (bits 0-3), facing (4-5), inventory open (6)
//   [49]     player row
//   [50]     cursor slot (bits 0-2), sword in hand (3-5)
//   [51..56] the pack: kind (bits 0-1: none, potion, sword), sword level (2-4)
#define ST_CELLS 0
#define ST_PLAYER 48
#define ST_ROW 49
#define ST_KIT 50
#define ST_PACK 51
_Static_assert((WIN_COLS * WIN_ROWS * 2 + 7) / 8 <= ST_PLAYER, "the window's cells fit before the player byte");
_Static_assert(ST_PACK + PACK == DUNGEON_HUD_STATE, "DUNGEON_HUD_STATE is the state's size");

static uint8_t cell(const uint8_t *st, int8_t c, int8_t r) {
    if (c < 0 || r < 0 || c >= WIN_COLS || r >= WIN_ROWS) return CELL_NONE;
    uint16_t i = r * WIN_COLS + c;
    return st[ST_CELLS + i / 4] >> (i % 4 * 2) & 3;
}

void dungeon_hud_state(uint8_t st[DUNGEON_HUD_STATE]) {
    memset(st, 0, DUNGEON_HUD_STATE);
    int8_t x0 = dg.x - AM_COLS / 2, y0 = dg.y - AM_ROWS / 2;
    if (x0 < 0) x0 = 0;
    if (x0 > MAP - AM_COLS) x0 = MAP - AM_COLS;
    if (y0 < 0) y0 = 0;
    if (y0 > MAP - AM_ROWS) y0 = MAP - AM_ROWS;
    for (int8_t r = 0; r < WIN_ROWS; r++)
        for (int8_t c = 0; c < WIN_COLS; c++) {
            int8_t  x = x0 + c, y = y0 + r;
            uint8_t t = dg_at(x, y), v = CELL_NONE;
            if (dg_seen(x, y)) v = t == FLOOR ? CELL_FLOOR : t == DOOR ? CELL_DOOR : t == STAIRS ? CELL_STAIRS : CELL_NONE;
            uint16_t i = r * WIN_COLS + c;
            st[ST_CELLS + i / 4] |= v << (i % 4 * 2);
        }
    st[ST_PLAYER] = (dg.x - x0) | dg.dir << 4 | (dg.menu ? 1 << 6 : 0);
    st[ST_ROW]    = dg.y - y0;
    st[ST_KIT]    = dg.cursor | dg.attack << 3;
    for (uint8_t k = 0; k < PACK; k++) {
        const carried_t *c = &dg.pack[k];
        st[ST_PACK + k]    = c->kind == POTION ? 1 : c->kind == SWORD ? 2 | c->level << 2 : 0;
    }
}

static void automap(const uint8_t *st) {
    for (int8_t r = 0; r < AM_ROWS; r++)
        for (int8_t c = 0; c < AM_COLS; c++) {
            int16_t ax = c * 4, ay = r * 4;
            uint8_t t  = cell(st, c, r);
            if (t == CELL_NONE) continue;
            if (t == CELL_STAIRS) {
                dg_px(ax + 3, ay, true);
                dg_hline(ax + 2, ax + 3, ay + 1);
                dg_hline(ax + 1, ax + 3, ay + 2);
                dg_hline(ax, ax + 3, ay + 3);
                continue;
            }
            // a corridor two pixels wide, joined to its seen neighbours
            dg_fill(ax + 1, ay + 1, ax + 2, ay + 2, true);
            if (cell(st, c + 1, r)) dg_fill(ax + 3, ay + 1, ax + 4, ay + 2, true);
            if (cell(st, c, r + 1)) dg_fill(ax + 1, ay + 3, ax + 2, ay + 4, true);
            // rooms fill in rather than turning into a grid of dots
            if (cell(st, c + 1, r + 1) && cell(st, c + 1, r) && cell(st, c, r + 1)) dg_fill(ax + 3, ay + 3, ax + 4, ay + 4, true);
            if (t == CELL_DOOR) { // a hollow square
                dg_rect(ax, ay, ax + 3, ay + 3);
                dg_fill(ax + 1, ay + 1, ax + 2, ay + 2, false);
            }
        }
    // the player: a black arrow with a white outline, which reads on a dark
    // corridor (the outline) and in a filled room (the arrow)
    static const char *const ARROW[4][4] = {
        {".##.", ".##.", "####", "#..#"},
        {"##..", ".###", ".###", "##.."},
        {"#..#", "####", ".##.", ".##."},
        {"..##", "###.", "###.", "..##"},
    };
    uint8_t dir = st[ST_PLAYER] >> 4 & 3;
    int16_t ax = (st[ST_PLAYER] & 15) * 4, ay = st[ST_ROW] * 4;
    for (int8_t j = 0; j < 4; j++)
        for (int8_t i = 0; i < 4; i++)
            if (ARROW[dir][j][i] == '#')
                for (int8_t b = -1; b <= 1; b++)
                    for (int8_t a = -1; a <= 1; a++) dg_px(ax + i + a, ay + j + b, true);
    for (int8_t j = 0; j < 4; j++)
        for (int8_t i = 0; i < 4; i++)
            if (ARROW[dir][j][i] == '#') dg_px(ax + i, ay + j, false);
}

SPR(TORCH_ICON, "..#..", ".###.", "..#..", ".###.", "..#..", "..#..", "..#..");
SPR(SWORD_BIG, "......#", ".....#.", "....#..", "#..#...", ".##....", ".##....", "#..#...");

// The slots' boxes: the hands (two, wide) over the pack (two rows of three).
static void slot_box(uint8_t slot, int16_t *x0, int16_t *y0, int16_t *x1, int16_t *y1) {
    if (slot < SLOT_PACK) {
        *x0 = slot * 17, *x1 = *x0 + 14, *y0 = 84, *y1 = 98;
    } else {
        uint8_t k = slot - SLOT_PACK;
        *x0 = (k % 3) * 11, *x1 = *x0 + 9, *y0 = 103 + (k / 3) * 13, *y1 = *y0 + 11;
    }
}

// What the hero carries. With the inventory open, the slot under the cursor
// has a second frame inside its own.
static void kit(const uint8_t *st) {
    bool    menu   = st[ST_PLAYER] >> 6 & 1;
    uint8_t cursor = st[ST_KIT] & 7, attack = st[ST_KIT] >> 3 & 7;
    for (uint8_t slot = 0; slot < SLOTS; slot++) {
        int16_t x0, y0, x1, y1;
        slot_box(slot, &x0, &y0, &x1, &y1);
        dg_rect(x0, y0, x1, y1);
        if (menu && slot == cursor) dg_rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1);
        int16_t cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        if (slot == SLOT_TORCH) {
            dg_sprite(TORCH_ICON, 7, cx - 2, cy - 3);
        } else if (slot == SLOT_WEAPON) {
            dg_sprite(SWORD_BIG, 7, cx - 4, cy - 3);
            if (attack > 1) dg_number(attack, x1 - 4, y1 - 6);
        } else {
            uint8_t c = st[ST_PACK + slot - SLOT_PACK];
            if ((c & 3) == 1) dg_sprite(DG_POTION, 5, cx - 1, cy - 2);
            if ((c & 3) == 2) {
                dg_sprite(DG_SWORD, 5, x0 + 2, cy - 2);
                dg_number(c >> 2 & 7, x0 + 6, y1 - 6);
            }
        }
    }
}

void dungeon_render_hud(const uint8_t st[DUNGEON_HUD_STATE], uint8_t frame[DUNGEON_FRAME_SIZE]) {
    dg_fb = frame;
    memset(frame, 0, DUNGEON_FRAME_SIZE);
    automap(st);
    kit(st);
}
