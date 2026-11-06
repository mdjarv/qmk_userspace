// Left OLED screens drawn from host data (hostdata.h):
//   SYS     line graphs of CPU, GPU, RAM, temperature and power
//   MUSIC   album art, scrolling title and artist, spectrum, track position
//   AGENTS  Agentique sessions: working, waiting on you, done, idle
// The context picks one (an agent waiting, else music playing, else SYS). The
// knob press overrides it until the context changes. Without host data for
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
    if (host_fresh(host.last_agents, AGENTS_TIMEOUT) && host.agents_waiting > 0) return SCREEN_AGENTS;
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

// A line graph of one metric's history, h rows tall, newest at the right edge,
// filling in from the right while history is short. lo..hi spans the height.
static void graph(int y0, int h, enum host_metric m, uint8_t lo, uint8_t hi) {
    int prev = -1;
    for (int i = 0; i < host.history_len; i++) {
        int x = FB_W - host.history_len + i;
        int v = host.history[m][HOST_HISTORY - host.history_len + i];
        v     = (MIN(MAX(v, lo), hi) - lo) * (h - 1) / (hi - lo);
        int y = y0 + h - 1 - v;
        if (prev < 0) prev = y;
        for (int k = MIN(prev, y); k <= MAX(prev, y); k++) fb_px(x, k, true);
        prev = y;
    }
}

// Power has no natural ceiling: scale to the history's peak, at least 20 W.
static uint8_t power_peak(void) {
    uint8_t peak = 20;
    for (int i = HOST_HISTORY - host.history_len; i < HOST_HISTORY; i++) peak = MAX(peak, host.history[METRIC_POWER][i]);
    return peak;
}

static void render_sys(void) {
    static const char *const labels[] = {"CPU", "GPU", "RAM", "TMP", "PWR"};
    static const char *const units[]  = {"%", "%", "%", "*", "W"};
    const uint8_t            now[]    = {host.cpu, host.gpu, host.ram, host.temp, host.power};
    const uint8_t            lo[]     = {0, 0, 0, 30, 0};
    const uint8_t            hi[]     = {100, 100, 100, 100, power_peak()};
    char                     buf[8];
    for (int m = 0; m < 5; m++) {
        int y = m * 26;
        fb_tiny(labels[m], 0, y, true);
        snprintf(buf, sizeof(buf), "%u%s", now[m], units[m]);
        fb_tiny(buf, FB_W + 1 - fb_tiny_width(buf), y, true);
        graph(y + 7, 16, m, lo[m], hi[m]);
    }
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

static void render_agents(void) {
    static const uint8_t spin[] = {'|', '/', '-', '\\'};
    char                 buf[12];
    uint32_t             t     = timer_read32();
    bool                 blink = (t / 450) % 2 == 0;

    fb_fill(0, 0, FB_W, 9, true);
    fb_text("AGENT", 1, 0, 1, false);
    if (host.agent_count == 0) fb_tiny("NONE", 8, 13, true);
    for (int i = 0; i < host.agent_count; i++) {
        const agent_row_t *row = &host.agents[i];
        int                y   = 12 + i * 11;
        bool               inv = row->state == AGENT_WAITING && blink;
        if (inv) fb_fill(0, y - 1, FB_W, 9, true);
        switch (row->state) {
            case AGENT_WORKING:
                fb_glyph(spin[(t / 150 + i) % 4], 0, y, 1, true);
                break;
            case AGENT_WAITING:
                fb_glyph('!', 0, y, 1, !inv);
                break;
            case AGENT_DONE: // a check mark
                fb_px(4, y + 2, true);
                fb_px(3, y + 3, true);
                fb_px(0, y + 4, true);
                fb_px(2, y + 4, true);
                fb_px(1, y + 5, true);
                break;
            default:
                fb_px(2, y + 4, true);
        }
        fb_tiny(row->name, 8, y + 1, !inv);
    }
    fb_dotted(103);
    snprintf(buf, sizeof(buf), "RUN  %u", host.agents_running);
    fb_tiny(buf, 0, 107, true);
    snprintf(buf, sizeof(buf), "WAIT %u", host.agents_waiting);
    fb_tiny(buf, 0, 114, true);
    snprintf(buf, sizeof(buf), "IDLE %u", host.agents_idle);
    fb_tiny(buf, 0, 121, true);
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
        if (host.volume != 255 && host_fresh(host.volume_changed, VOLUME_SHOW)) render_volume();
    }
    fb_flush();
}
