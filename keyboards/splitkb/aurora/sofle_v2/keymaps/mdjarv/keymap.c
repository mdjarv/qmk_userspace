// Behaviour for the layout in keymap.json, which the build compiles together
// with this file (GAME_TOGGLE is declared there).
#include QMK_KEYBOARD_H
#include "layers.h"

// Game mode is the default layer _GAME. Its key sits under the palm, so it
// only toggles after being held this long.
#define GAME_TOGGLE_HOLD_MS 500

static bool     game_toggle_held;
static uint16_t game_toggle_timer;

bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    if (keycode == GAME_TOGGLE) {
        game_toggle_held  = record->event.pressed;
        game_toggle_timer = timer_read();
        return false;
    }
    return true;
}

void housekeeping_task_user(void) {
    if (game_toggle_held && timer_elapsed(game_toggle_timer) >= GAME_TOGGLE_HOLD_MS) {
        game_toggle_held = false;
        uint8_t layer    = get_highest_layer(default_layer_state) == _GAME ? _DEFAULT : _GAME;
        default_layer_set((layer_state_t)1 << layer);
    }
}

#ifdef CONVERT_TO_LIATRIS
// The Liatris LED on GPIO 24 is lit by default; it is active low. splitkb's
// Vial builds turned it off the same way. The converter's pin table has no
// GPxx names, only Pro Micro ones, so the GPIO number is used directly.
#    define LIATRIS_LED_PIN 24U

void keyboard_pre_init_user(void) {
    gpio_set_pin_output(LIATRIS_LED_PIN);
    gpio_write_pin_high(LIATRIS_LED_PIN);
}
#endif
