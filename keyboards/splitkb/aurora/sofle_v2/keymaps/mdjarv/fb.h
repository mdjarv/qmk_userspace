// A 32x128 framebuffer for the portrait OLED, laid out like the OLED driver's
// own buffer (byte x + (y / 8) * 32, bit y % 8). Screens draw into it and
// fb_flush hands it to the driver, which only sends the bytes that changed.
#pragma once

#include <stdbool.h>
#include <stdint.h>

#define FB_W 32
#define FB_H 128

void fb_clear(void);
void fb_px(int x, int y, bool on);
void fb_fill(int x, int y, int w, int h, bool on);
void fb_rect(int x, int y, int w, int h);
void fb_dotted(int y); // a dotted divider across the screen
// Copies whole 8-row pages (32 bytes each) of OLED-layout data to page.
void fb_pages(const uint8_t *src, uint8_t page, uint16_t len);

// The keyboard's 6x8 OLED font, scaled up by scale. Draws set bits only.
void fb_glyph(uint8_t c, int x, int y, uint8_t scale, bool on);
void fb_text(const char *s, int x, int y, uint8_t scale, bool on);
// A 3x5 font on a 4-pixel pitch, 8 characters a line. Upper case only.
void fb_tiny(const char *s, int x, int y, bool on);
// Tiny text on a lit box one pixel larger than the text.
void fb_tiny_inv(const char *s, int x, int y);
int  fb_tiny_width(const char *s);

void fb_flush(void);
