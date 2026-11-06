// Receives frames from the host (see hostdata.h). Only the USB half gets them.
#include QMK_KEYBOARD_H
#include <string.h>
#include "raw_hid.h"
#include "hostdata.h"

static uint8_t  back[HOST_FRAME_SIZE], front[HOST_FRAME_SIZE];
static bool     presented;
static uint32_t last_report;
static uint32_t awake_until; // timer_read32() deadline of the last HOST_KEEP_AWAKE
static bool     awake;

const uint8_t *host_frame(uint32_t timeout_ms) {
    if (!presented || timer_elapsed32(last_report) >= timeout_ms) return NULL;
    return front;
}

// Only while the host is there: with nobody reading, QMK's send waits up to
// 100 ms once before it gives up.
#define HOST_LISTENING_MS 3000

void host_send_event(uint8_t kind, uint8_t a, uint8_t b) {
    if (!presented || timer_elapsed32(last_report) >= HOST_LISTENING_MS) return;
    uint8_t r[32] = {HOST_EVENT, kind, a, b};
    raw_hid_send(r, sizeof(r));
}

bool host_keep_awake(void) {
    if (awake && (int32_t)(timer_read32() - awake_until) >= 0) awake = false; // deadline passed
    return awake;
}

void raw_hid_receive(uint8_t *d, uint8_t length) {
    if (length < 32) return;
    switch (d[0]) {
        case HOST_FRAME: {
            uint16_t off = d[1] * HOST_CHUNK;
            if (off < HOST_FRAME_SIZE) memcpy(back + off, d + 2, MIN(HOST_CHUNK, HOST_FRAME_SIZE - off));
            break;
        }
        case HOST_PRESENT:
            memcpy(front, back, HOST_FRAME_SIZE);
            presented = true;
            break;
        case HOST_BRIGHTNESS:
            oled_set_brightness(d[1]);
            break;
        case HOST_KEEP_AWAKE:
            awake       = d[1] > 0;
            awake_until = timer_read32() + d[1] * 1000u;
            break;
        default:
            return;
    }
    last_report = timer_read32();
}
