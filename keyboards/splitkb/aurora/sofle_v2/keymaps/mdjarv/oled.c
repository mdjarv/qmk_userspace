// OLED screens. USB half (left): host data from tools/kbscreen, see screens.c.
// Other half: the headphones animation, or the amazed face on the game layer.
#include QMK_KEYBOARD_H
#include "layers.h"
#include "screens.h"
#include "gfx/headphones.h"
#include "gfx/amazed.h"

#define OLED_IDLE_TIMEOUT 60000 // ms without input before both screens blank

static void render_slave(void) {
    if (get_highest_layer(layer_state | default_layer_state) == _GAME) {
        render_animation(&gfx_amazed_animation);
    } else {
        render_animation(&gfx_headphones_animation);
    }
}

// Master decides on/off from input activity; SPLIT_OLED syncs that to the slave.
static void update_idle_blanking(void) {
    if (last_input_activity_elapsed() < OLED_IDLE_TIMEOUT) {
        oled_on();
    } else {
        oled_off();
    }
}

bool oled_task_user(void) {
    if (is_keyboard_master()) {
        update_idle_blanking();
    }
    // Drawing turns a display back on, so a blanked screen must not draw.
    // Without this the slave fought the sync every scan and stayed lit.
    if (!is_oled_on()) {
        return false;
    }
    if (is_keyboard_master()) {
        screens_render();
    } else {
        render_slave();
    }
    return false;
}
