#include QMK_KEYBOARD_H
#include <string.h>
#include "fb.h"

// The OLED driver compiles the keyboard's glcdfont.c, which defines this.
extern const unsigned char font[];

static uint8_t fb[FB_W * FB_H / 8];

// 3x5 glyphs for ASCII 32..90, rows top to bottom, 3 bits a row, left bit high
static const uint16_t tiny_font[] = {
    0x0000, 0x2482, 0x5A00, 0x5F7D, 0x0000, 0x52A5, 0x05D0, 0x2400, // space ! " # $ % & '
    0x1491, 0x4494, 0x2A80, 0x05D0, 0x0014, 0x01C0, 0x0002, 0x12A4, // ( ) * + , - . /
    0x7B6F, 0x2C97, 0x73E7, 0x73CF, 0x5BC9, 0x79CF, 0x79EF, 0x7292, // 0-7
    0x7BEF, 0x7BCF, 0x0410, 0x0414, 0x1511, 0x0E38, 0x4454, 0x7282, // 8 9 : ; < = > ?
    0x0000, 0x2BED, 0x6BAE, 0x3923, 0x6B6E, 0x79A7, 0x79A4, 0x396B, // @ A-G
    0x5BED, 0x7497, 0x126A, 0x5BAD, 0x4927, 0x5FED, 0x6B6D, 0x2B6A, // H-O
    0x6BA4, 0x2B73, 0x6BAD, 0x388E, 0x7492, 0x5B6F, 0x5B6A, 0x5BFD, // P-W
    0x5AAD, 0x5A92, 0x72A7,                                         // X-Z
};

void fb_clear(void) {
    memset(fb, 0, sizeof(fb));
}

void fb_px(int x, int y, bool on) {
    if (x < 0 || x >= FB_W || y < 0 || y >= FB_H) return;
    uint8_t *b = &fb[x + (y >> 3) * FB_W];
    if (on) {
        *b |= 1 << (y & 7);
    } else {
        *b &= ~(1 << (y & 7));
    }
}

void fb_fill(int x, int y, int w, int h, bool on) {
    for (int j = 0; j < h; j++) {
        for (int i = 0; i < w; i++) fb_px(x + i, y + j, on);
    }
}

void fb_rect(int x, int y, int w, int h) {
    for (int i = 0; i < w; i++) {
        fb_px(x + i, y, true);
        fb_px(x + i, y + h - 1, true);
    }
    for (int j = 0; j < h; j++) {
        fb_px(x, y + j, true);
        fb_px(x + w - 1, y + j, true);
    }
}

void fb_dotted(int y) {
    for (int x = 0; x < FB_W; x += 2) fb_px(x, y, true);
}

void fb_pages(const uint8_t *src, uint8_t page, uint16_t len) {
    uint16_t off = page * FB_W;
    if (off >= sizeof(fb)) return;
    memcpy(fb + off, src, MIN(len, sizeof(fb) - off));
}

void fb_glyph(uint8_t c, int x, int y, uint8_t scale, bool on) {
    if (c > OLED_FONT_END) c = '?';
    for (int i = 0; i < 6; i++) {
        uint8_t col = pgm_read_byte(&font[c * 6 + i]);
        for (int k = 0; k < 8; k++) {
            if (col & (1 << k)) fb_fill(x + i * scale, y + k * scale, scale, scale, on);
        }
    }
}

void fb_text(const char *s, int x, int y, uint8_t scale, bool on) {
    for (; *s; s++, x += 6 * scale) {
        if (x >= FB_W) break;
        if (x > -6 * scale) fb_glyph((uint8_t)*s, x, y, scale, on);
    }
}

static uint16_t tiny_glyph(char c) {
    if (c >= 'a' && c <= 'z') c -= 'a' - 'A';
    if (c < 32 || c > 'Z') return 0;
    return tiny_font[c - 32];
}

void fb_tiny(const char *s, int x, int y, bool on) {
    for (; *s; s++, x += 4) {
        if (x >= FB_W) break;
        uint16_t g = tiny_glyph(*s);
        for (int r = 0; r < 5; r++) {
            for (int q = 0; q < 3; q++) {
                if (g & (1 << (14 - r * 3 - q))) fb_px(x + q, y + r, on);
            }
        }
    }
}

int fb_tiny_width(const char *s) {
    return strlen(s) * 4;
}

void fb_tiny_inv(const char *s, int x, int y) {
    fb_fill(x - 1, y - 1, fb_tiny_width(s) + 1, 7, true);
    fb_tiny(s, x, y, false);
}

void fb_flush(void) {
    oled_set_cursor(0, 0);
    oled_write_raw((const char *)fb, sizeof(fb));
}
