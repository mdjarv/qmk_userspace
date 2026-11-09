#include "draw.h"
#include "dungeon.h"

uint8_t *dg_fb;

void dg_px(int16_t x, int16_t y, bool on) {
    if (x < 0 || y < 0 || x >= DUNGEON_W || y >= DUNGEON_H) return;
    uint8_t *b = &dg_fb[x + (y / 8) * DUNGEON_W];
    if (on) *b |= 1 << (y % 8);
    else *b &= ~(1 << (y % 8));
}

bool dg_get(int16_t x, int16_t y) {
    if (x < 0 || y < 0 || x >= DUNGEON_W || y >= DUNGEON_H) return false;
    return dg_fb[x + (y / 8) * DUNGEON_W] >> (y % 8) & 1;
}

void dg_hline(int16_t x0, int16_t x1, int16_t y) {
    for (int16_t x = x0; x <= x1; x++) dg_px(x, y, true);
}

void dg_vline(int16_t x, int16_t y0, int16_t y1) {
    for (int16_t y = y0; y <= y1; y++) dg_px(x, y, true);
}

void dg_rect(int16_t x0, int16_t y0, int16_t x1, int16_t y1) {
    dg_hline(x0, x1, y0);
    dg_hline(x0, x1, y1);
    dg_vline(x0, y0, y1);
    dg_vline(x1, y0, y1);
}

void dg_fill(int16_t x0, int16_t y0, int16_t x1, int16_t y1, bool on) {
    for (int16_t y = y0; y <= y1; y++)
        for (int16_t x = x0; x <= x1; x++) dg_px(x, y, on);
}

void dg_sprite(const char *const *rows, uint8_t h, int16_t x, int16_t y) {
    for (uint8_t j = 0; j < h; j++)
        for (uint8_t i = 0; rows[j][i]; i++)
            if (rows[j][i] == '#') dg_px(x + i, y + j, true);
}

void dg_sprite_ring(const char *const *rows, uint8_t h, int16_t x, int16_t y) {
    for (uint8_t j = 0; j < h; j++)
        for (uint8_t i = 0; rows[j][i]; i++)
            if (rows[j][i] == '#')
                for (int8_t a = -1; a <= 1; a++)
                    for (int8_t b = -1; b <= 1; b++) dg_px(x + i + a, y + j + b, false);
}

SPR(D0, "###", "#.#", "#.#", "#.#", "###");
SPR(D1, ".#.", "##.", ".#.", ".#.", "###");
SPR(D2, "##.", "..#", ".#.", "#..", "###");
SPR(D3, "##.", "..#", ".#.", "..#", "##.");
SPR(D4, "#.#", "#.#", "###", "..#", "..#");
SPR(D5, "###", "#..", "##.", "..#", "##.");
SPR(D6, ".##", "#..", "###", "#.#", "###");
SPR(D7, "###", "..#", ".#.", ".#.", ".#.");
SPR(D8, "###", "#.#", "###", "#.#", "###");
SPR(D9, "###", "#.#", "###", "..#", "##.");
static const char *const *const DIGIT[10] = {D0, D1, D2, D3, D4, D5, D6, D7, D8, D9};

int16_t dg_number(uint8_t n, int16_t x, int16_t y) {
    if (n >= 10) {
        dg_sprite(DIGIT[n / 10 % 10], 5, x, y);
        x += 4;
    }
    dg_sprite(DIGIT[n % 10], 5, x, y);
    return x + 4;
}

const char *const DG_POTION[5] = {".#.", ".#.", "#.#", "###", "###"};
const char *const DG_SWORD[5]  = {"....#", "...#.", "#.#..", ".#...", "#.#.."};
const char *const DG_STAIRS[5] = {"....##", "...###", "..####", ".#####", "######"};
const char *const DG_HEART[5]  = {".#.#.", "#####", "#####", ".###.", "..#.."};
