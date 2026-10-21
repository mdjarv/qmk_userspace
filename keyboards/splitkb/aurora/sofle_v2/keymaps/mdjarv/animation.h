#pragma once

#include "quantum.h"

typedef struct {
    const char     *frames;      // frame data in PROGMEM, frame_count frames back to back
    uint16_t        frame_size;  // bytes per frame
    const uint16_t *delays;      // ms to show each frame
    uint8_t         frame_count;
    uint8_t         idx;         // current frame
    uint16_t        timer;       // when the current frame started
} Animation;

// Draws the current frame at the cursor, advancing when its delay has passed.
static inline void render_animation(Animation *anim) {
    if (timer_elapsed(anim->timer) >= anim->delays[anim->idx]) {
        anim->idx   = (anim->idx + 1) % anim->frame_count;
        anim->timer = timer_read();
    }
    oled_write_raw_P(anim->frames + (anim->idx * anim->frame_size), anim->frame_size);
}
