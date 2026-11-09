// Placeholder until the design round picks the game: one walled room on a
// 4x4 grid and a blinking hero that walks it. It proves the input, the
// drawing and the simulator; the game itself replaces all of this.
#include "dungeon.h"
#include <string.h>

#define CELL 4
#define COLS (DUNGEON_W / CELL)
#define ROWS (DUNGEON_H / CELL)

static struct {
    uint32_t rng;
    uint8_t  x, y;
    uint32_t moved_at;
    uint8_t  map[ROWS][COLS]; // 1 = wall
} g;

static uint32_t rnd(void) { // xorshift32; the seed must not be 0
    g.rng ^= g.rng << 13;
    g.rng ^= g.rng >> 17;
    g.rng ^= g.rng << 5;
    return g.rng;
}

void dungeon_start(uint32_t seed, uint32_t now_ms) {
    memset(&g, 0, sizeof(g));
    g.rng = seed ? seed : 1;
    for (uint8_t r = 0; r < ROWS; r++)
        for (uint8_t c = 0; c < COLS; c++)
            g.map[r][c] = r == 0 || c == 0 || r == ROWS - 1 || c == COLS - 1 || (rnd() % 9 == 0);
    g.x        = COLS / 2;
    g.y        = ROWS - 2;
    g.map[g.y][g.x] = 0;
    g.moved_at = now_ms;
}

void dungeon_press(uint8_t button, uint32_t now_ms) {
    int8_t dx = 0, dy = 0;
    switch (button) {
        case DUNGEON_UP: dy = -1; break;
        case DUNGEON_DOWN: dy = 1; break;
        case DUNGEON_LEFT: dx = -1; break;
        case DUNGEON_RIGHT: dx = 1; break;
        default: return;
    }
    uint8_t nx = g.x + dx, ny = g.y + dy;
    if (nx >= COLS || ny >= ROWS || g.map[ny][nx]) return;
    g.x        = nx;
    g.y        = ny;
    g.moved_at = now_ms;
}

static void px(uint8_t *f, uint8_t x, uint8_t y) {
    if (x < DUNGEON_W && y < DUNGEON_H) f[x + (y / 8) * DUNGEON_W] |= 1 << (y % 8);
}

void dungeon_render(uint8_t f[DUNGEON_FRAME_SIZE], uint32_t now_ms) {
    memset(f, 0, DUNGEON_FRAME_SIZE);
    for (uint8_t r = 0; r < ROWS; r++)
        for (uint8_t c = 0; c < COLS; c++)
            if (g.map[r][c])
                for (uint8_t i = 0; i < CELL; i++) {
                    px(f, c * CELL + i, r * CELL);
                    px(f, c * CELL, r * CELL + i);
                }
    // The hero shows solid for a second after moving, then blinks at 2 Hz.
    uint32_t idle = now_ms - g.moved_at;
    if (idle < 1000 || (idle / 250) % 2 == 0)
        for (uint8_t i = 1; i < CELL; i++)
            for (uint8_t j = 1; j < CELL; j++) px(f, g.x * CELL + i, g.y * CELL + j);
}
