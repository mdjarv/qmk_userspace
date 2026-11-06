// The left OLED shows whatever tools/kbscreen draws (its screens are
// JavaScript in tools/kbscreen/js). Without a frame for HOST_TIMEOUT the cat
// animation from the old status column shows instead.
#include QMK_KEYBOARD_H
#include <string.h>
#include "hostdata.h"
#include "screens.h"
#include "gfx/idle_small.h"

#define HOST_TIMEOUT 3000 // ms without a report before the cat takes over

static void render_cat(void) {
    static uint8_t buf[HOST_FRAME_SIZE];
    Animation     *a = &gfx_idle_small_animation;
    if (timer_elapsed(a->timer) >= a->delays[a->idx]) {
        a->idx   = (a->idx + 1) % a->frame_count;
        a->timer = timer_read();
    }
    memset(buf, 0, sizeof(buf));
    memcpy(buf + 6 * 32, a->frames + a->idx * a->frame_size, a->frame_size); // rows 48..79
    oled_write_raw((const char *)buf, sizeof(buf));
}

void screens_render(void) {
    const uint8_t *frame = host_frame(HOST_TIMEOUT);
    if (frame) {
        oled_write_raw((const char *)frame, HOST_FRAME_SIZE);
    } else {
        render_cat();
    }
}

void screens_next(void) {
    host_send_event(HOST_EVENT_KNOB);
}
