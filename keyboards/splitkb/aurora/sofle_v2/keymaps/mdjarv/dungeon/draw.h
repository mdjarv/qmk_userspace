// Pixel drawing into a frame in OLED layout, shared by both screens.
#pragma once

#include <stdbool.h>
#include <stdint.h>

// The frame being drawn; set before drawing.
extern uint8_t *dg_fb;

void    dg_px(int16_t x, int16_t y, bool on);
bool    dg_get(int16_t x, int16_t y);
void    dg_hline(int16_t x0, int16_t x1, int16_t y);
void    dg_vline(int16_t x, int16_t y0, int16_t y1);
void    dg_rect(int16_t x0, int16_t y0, int16_t x1, int16_t y1);
void    dg_fill(int16_t x0, int16_t y0, int16_t x1, int16_t y1, bool on);
// A sprite is one string per row, '#' lit. dg_sprite_ring clears a 1-pixel
// ring around its lit pixels, so it stands out from what is behind it; draw
// the rings of things that touch first, then their pixels.
void    dg_sprite(const char *const *rows, uint8_t h, int16_t x, int16_t y);
void    dg_sprite_ring(const char *const *rows, uint8_t h, int16_t x, int16_t y);
// Draws n in 3x5 digits; returns the x after it.
int16_t dg_number(uint8_t n, int16_t x, int16_t y);

#define SPR(name, ...) static const char *const name[] = {__VA_ARGS__}
#define LEN(a) (sizeof(a) / sizeof(a[0]))

// Icons both screens use.
extern const char *const DG_POTION[5], *const DG_SWORD[5], *const DG_STAIRS[5], *const DG_HEART[5];
