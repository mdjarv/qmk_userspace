// Receives the host daemon's reports (see hostdata.h). Only the USB half gets them.
#include QMK_KEYBOARD_H
#include <string.h>
#include "raw_hid.h"
#include "hostdata.h"

host_state_t host = {.volume = 255};

bool host_fresh(uint32_t last, uint32_t ms) {
    return last != 0 && timer_elapsed32(last) < ms;
}

// timer_read32() is 0 for the first millisecond after boot, which reads as
// "never" in host_fresh.
static uint32_t now(void) {
    uint32_t t = timer_read32();
    return t ? t : 1;
}

static void record_history(const uint8_t sample[2]) {
    if (host.history_len < HOST_HISTORY) {
        host.history_len++;
    }
    for (uint8_t m = 0; m < 2; m++) {
        memmove(host.history[m], host.history[m] + 1, HOST_HISTORY - 1);
        host.history[m][HOST_HISTORY - 1] = sample[m];
    }
}

static void receive_text(const uint8_t *d) {
    char   *dst   = d[1] == 0 ? host.title : d[1] == 1 ? host.artist : NULL;
    uint8_t total = d[2], off = d[3];
    if (!dst || total > HOST_TEXT_MAX || off >= HOST_TEXT_MAX) return;
    uint8_t n = MIN(28, HOST_TEXT_MAX - off);
    memcpy(dst + off, d + 4, n);
    dst[total] = 0;
}

static void receive_agents(const uint8_t *d) {
    uint8_t total = MIN(d[1], HOST_AGENT_ROWS), first = d[2], n = MIN(d[3], 3);
    host.agent_count    = total;
    host.agents_running = d[4];
    host.agents_waiting = d[5];
    host.later_waiting  = d[6];
    host.later_idle     = d[7];
    host.oldest_wait    = d[8];
    host.new_question   = d[9] & 1;
    for (uint8_t i = 0; i < n && first + i < HOST_AGENT_ROWS; i++) {
        const uint8_t *row = d + 10 + i * 6;
        agent_row_t   *dst = &host.agents[first + i];
        memcpy(dst->name, row, 5);
        dst->name[5] = 0;
        dst->state   = row[5];
    }
    host.last_agents = now();
}

void raw_hid_receive(uint8_t *d, uint8_t length) {
    if (length < 32) return;
    host.last_any = now();
    switch (d[0]) {
        case HOST_SYS:
            host.cpu           = d[1];
            host.gpu           = d[2];
            host.ram_used      = d[3] | d[4] << 8;
            host.ram_total     = d[5];
            host.vram_used     = d[6] | d[7] << 8;
            host.vram_total    = d[8];
            host.battery       = d[9];
            host.battery_state = d[10];
            host.hour          = d[11];
            host.minute        = d[12];
            record_history((uint8_t[]){host.cpu, host.gpu});
            host.last_sys = now();
            break;
        case HOST_MEDIA: {
            uint8_t volume = d[6];
            bool    muted  = d[7];
            // the first report sets the volume without showing the readout
            if (host.last_media && (volume != host.volume || muted != host.muted)) {
                host.volume_changed = now();
            }
            host.playing    = d[1] & 1;
            host.position   = d[2] | d[3] << 8;
            host.length     = d[4] | d[5] << 8;
            host.volume     = volume;
            host.muted      = muted;
            host.last_media = now();
            break;
        }
        case HOST_TEXT:
            receive_text(d);
            break;
        case HOST_ART:
            if (d[1] < 5) {
                uint8_t off = d[1] * 28;
                memcpy(host.art + off, d + 2, MIN(28, HOST_ART_SIZE - off));
            }
            break;
        case HOST_SPECTRUM:
            memcpy(host.bands, d + 1, HOST_BANDS);
            host.last_spectrum = now();
            break;
        case HOST_AGENTS:
            receive_agents(d);
            break;
    }
}
