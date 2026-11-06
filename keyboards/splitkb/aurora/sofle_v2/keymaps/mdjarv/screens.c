// The left OLED shows whatever tools/kbscreen draws (its screens are
// JavaScript in tools/kbscreen/js). Without a frame for HOST_TIMEOUT the cat
// animation from the old status column shows instead.
#include QMK_KEYBOARD_H
#include <string.h>
#include "hostdata.h"
#include "screens.h"
#include "gfx/idle_small.h"

#define HOST_TIMEOUT 3000  // ms without a report before the cat takes over
#define KNOB_LONG_MS 500    // a press held this long is a long press
#define KNOB_DOUBLE_MS 250  // a second press this soon after the first is a double press
#define STATE_EVERY_MS 1000 // layer and mods are resent this often, for a host that just connected

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

static bool     knob_down, knob_pending, knob_long_sent;
static uint16_t knob_pressed_at, knob_released_at;

void screens_knob(bool pressed) {
    if (pressed) {
        if (knob_pending && timer_elapsed(knob_released_at) < KNOB_DOUBLE_MS) {
            knob_pending = false;
            host_send_event(HOST_EVENT_KNOB_DOUBLE, 0, 0);
            knob_long_sent = true; // this press is used up; its release sends nothing
        } else {
            knob_long_sent = false;
        }
        knob_down       = true;
        knob_pressed_at = timer_read();
    } else {
        knob_down = false;
        if (!knob_long_sent) {
            knob_pending     = true;
            knob_released_at = timer_read();
        }
    }
}

void screens_task(void) {
    if (knob_down && !knob_long_sent && timer_elapsed(knob_pressed_at) >= KNOB_LONG_MS) {
        knob_long_sent = true;
        host_send_event(HOST_EVENT_KNOB_LONG, 0, 0);
    }
    if (knob_pending && timer_elapsed(knob_released_at) >= KNOB_DOUBLE_MS) {
        knob_pending = false;
        host_send_event(HOST_EVENT_KNOB, 0, 0);
    }

    static uint8_t  last_layer = 255, last_mods;
    static uint16_t last_sent;
    uint8_t         layer = get_highest_layer(layer_state | default_layer_state);
    uint8_t         mods  = get_mods() | get_oneshot_mods();
    if (layer != last_layer || mods != last_mods || timer_elapsed(last_sent) >= STATE_EVERY_MS) {
        last_layer = layer;
        last_mods  = mods;
        last_sent  = timer_read();
        host_send_event(HOST_EVENT_STATE, layer, mods);
    }
}
