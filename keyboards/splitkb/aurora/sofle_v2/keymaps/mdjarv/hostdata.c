// Receives frames from the host (see hostdata.h). Only the USB half gets them.
#include QMK_KEYBOARD_H
#include <string.h>
#include "raw_hid.h"
#include "hostdata.h"

static uint8_t  back[HOST_FRAME_SIZE], front[HOST_FRAME_SIZE];
static bool     presented;
static uint32_t last_report;

const uint8_t *host_frame(uint32_t timeout_ms) {
    if (!presented || timer_elapsed32(last_report) >= timeout_ms) return NULL;
    return front;
}

void host_send_event(uint8_t kind) {
    uint8_t r[32] = {HOST_EVENT, kind};
    raw_hid_send(r, sizeof(r));
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
        default:
            return;
    }
    last_report = timer_read32();
}
