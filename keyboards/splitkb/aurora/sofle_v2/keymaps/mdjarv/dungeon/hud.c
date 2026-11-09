// The right screen: the explored map around the player (north up), then
// what the hero carries.
#include "dungeon_internal.h"
#include "draw.h"
#include <string.h>

#define AM_COLS 8
#define AM_ROWS 20 // 4 px cells: rows 0-79

static void automap(void) {
    int8_t x0 = dg.x - AM_COLS / 2, y0 = dg.y - AM_ROWS / 2;
    if (x0 < 0) x0 = 0;
    if (x0 > MAP - AM_COLS) x0 = MAP - AM_COLS;
    if (y0 < 0) y0 = 0;
    if (y0 > MAP - AM_ROWS) y0 = MAP - AM_ROWS;
    for (int8_t cy = 0; cy < AM_ROWS; cy++)
        for (int8_t cx = 0; cx < AM_COLS; cx++) {
            int8_t  x = x0 + cx, y = y0 + cy;
            int16_t ax = cx * 4, ay = cy * 4;
            uint8_t t  = dg_at(x, y);
            if (!dg_seen(x, y) || t == WALL) continue;
            if (t == STAIRS) {
                dg_px(ax + 3, ay, true);
                dg_hline(ax + 2, ax + 3, ay + 1);
                dg_hline(ax + 1, ax + 3, ay + 2);
                dg_hline(ax, ax + 3, ay + 3);
                continue;
            }
            // a corridor two pixels wide, joined to its seen neighbours
            dg_fill(ax + 1, ay + 1, ax + 2, ay + 2, true);
            if (dg_seen(x + 1, y) && dg_at(x + 1, y) != WALL) dg_fill(ax + 3, ay + 1, ax + 4, ay + 2, true);
            if (dg_seen(x, y + 1) && dg_at(x, y + 1) != WALL) dg_fill(ax + 1, ay + 3, ax + 2, ay + 4, true);
            // rooms fill in rather than turning into a grid of dots
            if (dg_seen(x + 1, y + 1) && dg_seen(x + 1, y) && dg_seen(x, y + 1) && dg_at(x + 1, y + 1) != WALL && dg_at(x + 1, y) != WALL && dg_at(x, y + 1) != WALL)
                dg_fill(ax + 3, ay + 3, ax + 4, ay + 4, true);
            if (t == DOOR) { // a hollow square
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
    int16_t ax = (dg.x - x0) * 4, ay = (dg.y - y0) * 4;
    for (int8_t j = 0; j < 4; j++)
        for (int8_t i = 0; i < 4; i++)
            if (ARROW[dg.dir][j][i] == '#')
                for (int8_t b = -1; b <= 1; b++)
                    for (int8_t a2 = -1; a2 <= 1; a2++) dg_px(ax + i + a2, ay + j + b, true);
    for (int8_t j = 0; j < 4; j++)
        for (int8_t i = 0; i < 4; i++)
            if (ARROW[dg.dir][j][i] == '#') dg_px(ax + i, ay + j, false);
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
static void kit(void) {
    for (uint8_t slot = 0; slot < SLOTS; slot++) {
        int16_t x0, y0, x1, y1;
        slot_box(slot, &x0, &y0, &x1, &y1);
        dg_rect(x0, y0, x1, y1);
        if (dg.menu && slot == dg.cursor) dg_rect(x0 + 1, y0 + 1, x1 - 1, y1 - 1);
        int16_t cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        if (slot == SLOT_TORCH) {
            dg_sprite(TORCH_ICON, 7, cx - 2, cy - 3);
        } else if (slot == SLOT_WEAPON) {
            dg_sprite(SWORD_BIG, 7, cx - 4, cy - 3);
            if (dg.attack > 1) dg_number(dg.attack, x1 - 4, y1 - 6);
        } else {
            carried_t *c = &dg.pack[slot - SLOT_PACK];
            if (c->kind == POTION) dg_sprite(DG_POTION, 5, cx - 1, cy - 2);
            if (c->kind == SWORD) {
                dg_sprite(DG_SWORD, 5, x0 + 2, cy - 2);
                dg_number(c->level, x0 + 6, y1 - 6);
            }
        }
    }
}
void dungeon_render_hud(uint8_t frame[DUNGEON_FRAME_SIZE], uint32_t now_ms) {
    (void)now_ms;
    dg_fb = frame;
    memset(frame, 0, DUNGEON_FRAME_SIZE);
    automap();
    kit();
}
