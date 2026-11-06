// Left OLED screens drawn from host data (hostdata.h):
//   SYS     battery and clock; CPU and GPU load graphs, each with its memory
//           (RAM, VRAM) as a tank beside it
//   MUSIC   album art, scrolling title and artist, spectrum, track position
//   AGENTS  Agentique sessions, newest update first: working, waiting on you,
//           finished and unseen, idle
// The context picks one (music playing, else SYS); the knob press overrides it
// until the context changes. The agent screen only comes up by knob: a new
// question puts the asking robot in the corner of the other screens instead. Without host data for
// HOST_TIMEOUT the cat animation shows instead.
#include QMK_KEYBOARD_H
#include <stdio.h>
#include <string.h>
#include "fb.h"
#include "hostdata.h"
#include "screens.h"
#include "gfx/idle_small.h"

#define HOST_TIMEOUT 3000   // ms without any report before the cat takes over
#define MEDIA_TIMEOUT 3000  // music counts as playing while reports are this fresh
#define AGENTS_TIMEOUT 5000 // agent rows count while reports are this fresh
#define VOLUME_SHOW 1500    // ms the volume readout stays after a change

enum screen { SCREEN_SYS, SCREEN_MUSIC, SCREEN_AGENTS, SCREEN_COUNT };

static bool        override;
static enum screen override_screen, override_context;
static enum screen shown = SCREEN_SYS;

static enum screen context(void) {
    if (host_fresh(host.last_media, MEDIA_TIMEOUT) && host.playing) return SCREEN_MUSIC;
    return SCREEN_SYS;
}

void screens_next(void) {
    override_screen  = (shown + 1) % SCREEN_COUNT;
    override_context = context();
    override         = true;
}

static enum screen pick(void) {
    enum screen ctx = context();
    if (override && ctx != override_context) override = false;
    return override ? override_screen : ctx;
}

static void bar(int y, uint8_t pct) {
    fb_rect(0, y, FB_W, 3);
    fb_fill(0, y + 1, MIN(pct, 100) * FB_W / 100, 1, true);
}

// A line graph of one metric's 0..100 history in a w x h box at x0, y0, newest
// at the right edge, filling in from the right while history is short.
static void graph(int x0, int y0, int w, int h, enum host_metric m) {
    int n = MIN(host.history_len, w), prev = -1;
    for (int i = 0; i < n; i++) {
        int v = MIN(host.history[m][HOST_HISTORY - n + i], 100) * (h - 1) / 100;
        int y = y0 + h - 1 - v;
        if (prev < 0) prev = y;
        for (int k = MIN(prev, y); k <= MAX(prev, y); k++) fb_px(x0 + w - n + i, k, true);
        prev = y;
    }
}

// A solid vertical level, outlined.
static void tank(int x, int y, int w, int h, uint16_t used, uint16_t total) {
    fb_rect(x, y, w, h);
    int fill = total ? (int)MIN(used, total) * (h - 2) / total : 0;
    fb_fill(x + 1, y + h - 1 - fill, w - 2, fill, true);
}

// Icons as rows of bits, leftmost pixel in bit (width - 1).
static void icon(const uint8_t *rows, int n, int width, int x, int y) {
    for (int r = 0; r < n; r++) {
        for (int c = 0; c < width; c++) {
            if (rows[r] & (1 << (width - 1 - c))) fb_px(x + c, y + r, true);
        }
    }
}
static const uint8_t icon_cpu[]  = {0x14, 0x3E, 0x63, 0x2A, 0x63, 0x3E, 0x14};
static const uint8_t icon_gpu[]  = {0x7F, 0x5D, 0x55, 0x5D, 0x7F, 0x2A};
static const uint8_t icon_ram[]  = {0x7F, 0x55, 0x7F, 0x2A};
static const uint8_t icon_plug[] = {0x0A, 0x0A, 0x1F, 0x1F, 0x0E, 0x04};

static void format_gib(char *buf, size_t len, uint16_t tenths) {
    if (tenths < 100) {
        snprintf(buf, len, "%u.%uG", tenths / 10, tenths % 10);
    } else {
        snprintf(buf, len, "%uG", (tenths + 5) / 10);
    }
}

static void robot(int x, int y, uint8_t state, uint8_t i);
static bool question_is_new(void);

// Battery (only while charging or discharging) with its % on one line, the
// asking robot in place of the % while a question is new, then the clock.
static void render_status(void) {
    char buf[8];
    bool ask = question_is_new();
    if (host.battery_state != BATTERY_HIDDEN) {
        fb_rect(0, 0, 15, 8);
        fb_fill(15, 2, 2, 4, true);
        fb_fill(2, 2, (host.battery * 11 + 50) / 100, 4, true);
        if (host.battery_state == BATTERY_CHARGING) {
            fb_fill(4, 1, 7, 6, false);
            icon(icon_plug, 6, 5, 5, 1);
        }
        if (!ask) {
            snprintf(buf, sizeof(buf), "%u%%", host.battery);
            fb_tiny(buf, 19, 2, true);
        }
    }
    if (ask) robot(19, 0, AGENT_WAITING, 0);
    snprintf(buf, sizeof(buf), "%02u:%02u", host.hour, host.minute);
    fb_text(buf, 1, 11, 1, true);
    fb_dotted(21);
}

// A load graph with its memory tank beside it: icon and load % on top, the
// memory icon and GiB used below.
static void render_pair(int y, const uint8_t *load_icon, int load_rows, enum host_metric m, uint8_t load,
                        const char *mem_tag, uint16_t used, uint8_t total) {
    char buf[8];
    icon(load_icon, load_rows, 7, 0, y);
    snprintf(buf, sizeof(buf), "%u%%", load);
    fb_tiny(buf, 9, y + 1, true);
    graph(0, y + 9, 23, 28, m);
    tank(25, y + 9, 7, 28, used, total * 10);
    icon(icon_ram, 4, 7, 0, y + 39);
    if (mem_tag) fb_tiny(mem_tag, 8, y + 38, true);
    format_gib(buf, sizeof(buf), used);
    fb_tiny(buf, FB_W + 1 - fb_tiny_width(buf), y + 38, true);
}

static void render_sys(void) {
    render_status();
    render_pair(25, icon_cpu, 7, METRIC_CPU, host.cpu, NULL, host.ram_used, host.ram_total);
    fb_dotted(73);
    render_pair(78, icon_gpu, 6, METRIC_GPU, host.gpu, "V", host.vram_used, host.vram_total);
}

// Scrolls text that does not fit; text that fits stands still.
static void marquee(const char *s, int y, uint16_t ms_per_px, bool tiny) {
    int w = tiny ? fb_tiny_width(s) : (int)strlen(s) * 6;
    if (w <= FB_W) {
        tiny ? fb_tiny(s, 0, y, true) : fb_text(s, 0, y, 1, true);
        return;
    }
    int gap = 12, off = (timer_read32() / ms_per_px) % (w + gap);
    for (int base = -off; base < FB_W; base += w + gap) {
        tiny ? fb_tiny(s, base, y, true) : fb_text(s, base, y, 1, true);
    }
}

static uint8_t peaks[HOST_BANDS];

static void render_music(void) {
    char buf[12];
    fb_pages(host.art, 0, HOST_ART_SIZE);
    marquee(host.title[0] ? host.title : "-", 34, 70, false);
    marquee(host.artist, 44, 110, true);

    bool live = host_fresh(host.last_spectrum, 300);
    for (int b = 0; b < HOST_BANDS; b++) {
        uint8_t v = live ? host.bands[b] : 0;
        int     h = v * 58 / 255;
        peaks[b]  = MAX(v, peaks[b] > 4 ? peaks[b] - 4 : 0);
        int ph    = peaks[b] * 58 / 255;
        fb_fill(1 + b * 3, 112 - h, 2, h, true);
        fb_fill(1 + b * 3, 111 - ph, 2, 1, true);
    }

    bar(115, host.length ? (uint32_t)host.position * 100 / host.length : 0);
    snprintf(buf, sizeof(buf), "%u:%02u", host.position / 60, host.position % 60);
    fb_tiny(buf, (FB_W - fb_tiny_width(buf)) / 2, 121, true);
}

// A 9x9 robot per session: a solid head with cut-out eyes and mouth, hollow
// when idle. Working sways its antenna, finished smiles, asking has a ?,
// idle sleeps (Z). Rows are 9 bits, leftmost pixel in bit 8.
static const uint16_t robot_antenna[] = {0x010, 0x020, 0x010, 0x008};
static const uint16_t robot_open[]    = {0x07C, 0x0FE, 0x092, 0x0FE, 0x0C6, 0x0FE, 0x044};
static const uint16_t robot_smile[]   = {0x07C, 0x0FE, 0x092, 0x0FE, 0x0BA, 0x0C6, 0x044};
static const uint16_t robot_hollow[]  = {0x07C, 0x082, 0x0AA, 0x082, 0x0BA, 0x082, 0x07C};

static void robot(int x, int y, uint8_t state, uint8_t i) {
    const uint16_t *head = state == AGENT_DONE ? robot_smile : state == AGENT_IDLE ? robot_hollow : robot_open;
    uint16_t        rows[9];
    rows[0] = state == AGENT_WORKING ? robot_antenna[(timer_read32() / 500 + i) % 4] : robot_antenna[0];
    rows[1] = 0x010;
    for (int r = 0; r < 7; r++) rows[2 + r] = head[r];
    for (int r = 0; r < 9; r++) {
        for (int c = 0; c < 9; c++) {
            if (rows[r] & (0x100 >> c)) fb_px(x + c, y + r, true);
        }
    }
    if (state == AGENT_WAITING) fb_tiny("?", x + 9, y, true);
    if (state == AGENT_IDLE) fb_tiny("Z", x + 9, y, true);
}

static void format_age(char *buf, size_t len, uint8_t code) {
    if (code < 60) {
        snprintf(buf, len, "%uM", code);
    } else if (code < 84) {
        snprintf(buf, len, "%uH", code - 60);
    } else {
        snprintf(buf, len, "%uD", code - 84);
    }
}

static void render_agents(void) {
    char buf[12];
    snprintf(buf, sizeof(buf), "RUN %u", host.agents_running);
    fb_tiny(buf, 0, 0, true);
    snprintf(buf, sizeof(buf), "?%u", host.agents_waiting);
    fb_tiny(buf, FB_W + 1 - fb_tiny_width(buf), 0, true);
    fb_dotted(7);

    int y = 10;
    if (host.agent_count == 0) {
        robot(0, y, AGENT_IDLE, 0);
        fb_tiny("QUIET", 13, y + 2, true);
        y += 12;
    }
    for (int i = 0; i < host.agent_count; i++, y += 12) {
        const agent_row_t *row = &host.agents[i];
        robot(0, y, row->state, i);
        char name[5];
        memcpy(name, row->name, 4);
        name[4] = 0;
        fb_tiny(name, 15, y + 2, true);
    }

    if (host.later_waiting || host.later_idle) {
        y += 2;
        fb_tiny("LATER", 0, y, true);
        fb_dotted(y + 7);
        y += 11;
        if (host.later_waiting) {
            robot(0, y, AGENT_WAITING, 0);
            snprintf(buf, sizeof(buf), "%u", host.later_waiting);
            fb_tiny(buf, 15, y + 2, true);
            format_age(buf, sizeof(buf), host.oldest_wait);
            fb_tiny(buf, FB_W + 1 - fb_tiny_width(buf), y + 2, true);
            y += 12;
        }
        if (host.later_idle) {
            robot(0, y, AGENT_IDLE, 0);
            snprintf(buf, sizeof(buf), "%u", host.later_idle);
            fb_tiny(buf, 15, y + 2, true);
        }
    }
}

static bool question_is_new(void) {
    return host_fresh(host.last_agents, AGENTS_TIMEOUT) && host.new_question;
}

// The asking robot in the top right corner of the music screen while a
// question is new; perf has a place for it in its status line.
static void render_question_mark(void) {
    if (!question_is_new()) return;
    fb_fill(19, 0, 13, 10, false);
    robot(20, 0, AGENT_WAITING, 0);
}

// Over any screen while the volume is changing.
static void render_volume(void) {
    char buf[8];
    fb_fill(0, 62, FB_W, 30, false);
    fb_rect(0, 62, FB_W, 30);
    fb_tiny("VOL", 10, 65, true);
    if (host.muted) {
        fb_text("MUT", 7, 74, 1, true);
        return;
    }
    snprintf(buf, sizeof(buf), "%u", host.volume);
    fb_text(buf, (FB_W - (int)strlen(buf) * 6) / 2, 72, 1, true);
    fb_rect(3, 83, 26, 5);
    fb_fill(4, 84, MIN(host.volume, 100) * 24 / 100, 3, true);
}

// The cat from the old status column, in the middle of the screen.
static void render_cat(void) {
    Animation *a = &gfx_idle_small_animation;
    if (timer_elapsed(a->timer) >= a->delays[a->idx]) {
        a->idx   = (a->idx + 1) % a->frame_count;
        a->timer = timer_read();
    }
    fb_pages((const uint8_t *)a->frames + a->idx * a->frame_size, 6, a->frame_size);
}

void screens_render(void) {
    fb_clear();
    if (!host_fresh(host.last_any, HOST_TIMEOUT)) {
        override = false;
        render_cat();
    } else {
        shown = pick();
        switch (shown) {
            case SCREEN_MUSIC:
                render_music();
                break;
            case SCREEN_AGENTS:
                render_agents();
                break;
            default:
                render_sys();
        }
        if (shown == SCREEN_MUSIC) render_question_mark();
        if (host.volume != 255 && host_fresh(host.volume_changed, VOLUME_SHOW)) render_volume();
    }
    fb_flush();
}
