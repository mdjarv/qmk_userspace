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
    // the player: a solid arrow the way it faces, drawn over the corridor
    static const char *const ARROW[4][4] = {
        {".##.", "####", "####", "#..#"},
        {"##..", "####", "####", "##.."},
        {"#..#", "####", "####", ".##."},
        {"..##", "####", "####", "..##"},
    };
    int16_t ax = (dg.x - x0) * 4, ay = (dg.y - y0) * 4;
    dg_fill(ax, ay, ax + 3, ay + 3, false);
    dg_sprite(ARROW[dg.dir], 4, ax, ay);
}

// What the hero carries: the sword (with its level) and the torch in hand,
// potions in the pack.
static void kit(void) {
    SPR(TORCH_ICON, "..#..", ".###.", "..#..", ".###.", "..#..", "..#..", "..#..");
    SPR(SWORD_BIG, "......#", ".....#.", "....#..", "#..#...", ".##....", ".##....", "#..#...");
    int16_t y = 86;
    dg_rect(0, y, 14, y + 14);
    dg_sprite(TORCH_ICON, 7, 5, y + 4);
    dg_rect(17, y, 31, y + 14);
    dg_sprite(SWORD_BIG, 7, 21, y + 4);
    if (dg.attack > 1) dg_number(dg.attack, 27, y + 9);
    y = 106;
    for (uint8_t k = 0; k < 3; k++) {
        int16_t x = k * 11;
        dg_rect(x, y, x + 9, y + 10);
    }
    if (dg.potions) {
        dg_sprite(DG_POTION, 5, 3, y + 3);
        if (dg.potions > 1) dg_number(dg.potions, 13, y + 3);
    }
}

void dungeon_render_hud(uint8_t frame[DUNGEON_FRAME_SIZE], uint32_t now_ms) {
    (void)now_ms;
    dg_fb = frame;
    memset(frame, 0, DUNGEON_FRAME_SIZE);
    automap();
    kit();
}
