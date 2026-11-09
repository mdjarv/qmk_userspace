// Behaviour for the layout in keymap.json, which the build compiles together
// with this file (GAME_TOGGLE and SCREEN_NEXT are declared there).
#include QMK_KEYBOARD_H
#include "layers.h"
#include "screens.h"
#include "game.h"

// Game mode is the default layer _GAME. Its key sits under the palm, so it
// only toggles after being held this long.
#define GAME_TOGGLE_HOLD_MS 500
// Two taps of the same key enter or leave dungeon mode (game.c): a tap is
// shorter than TAP_MS, the second within DOUBLE_MS of the first's release.
#define GAME_TOGGLE_TAP_MS 200
#define GAME_TOGGLE_DOUBLE_MS 300

static bool     game_toggle_held, game_toggle_tapped;
static uint16_t game_toggle_timer, game_toggle_tapped_at;

static bool game_toggle_key(bool pressed) {
    if (pressed) {
        if (game_toggle_tapped && timer_elapsed(game_toggle_tapped_at) < GAME_TOGGLE_DOUBLE_MS) {
            game_toggle_tapped = false;
            game_toggle_held   = false; // this press is used up; holding it does not switch game mode
            game_toggle();
            return false;
        }
        game_toggle_held  = true;
        game_toggle_timer = timer_read();
        return false;
    }
    game_toggle_tapped = game_toggle_held && timer_elapsed(game_toggle_timer) < GAME_TOGGLE_TAP_MS;
    if (game_toggle_tapped) game_toggle_tapped_at = timer_read();
    game_toggle_held = false;
    return false;
}

// Before tap-hold sees them: in dungeon mode the game takes every key but its
// own toggle, the knobs (volume, scroll) and the right knob's press.
bool pre_process_record_user(uint16_t keycode, keyrecord_t *record) {
    if (!game_active() || keycode == GAME_TOGGLE || keycode == SCREEN_NEXT || IS_ENCODEREVENT(record->event)) return true;
    if (record->event.pressed) game_key(keycode);
    return false;
}

bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    if (keycode == GAME_TOGGLE) return game_toggle_key(record->event.pressed);
    if (keycode == SCREEN_NEXT) {
        screens_knob(record->event.pressed);
        return false;
    }
    return true;
}

void keyboard_post_init_user(void) {
    game_init();
}

void housekeeping_task_user(void) {
    if (is_keyboard_master()) {
        screens_task();
        game_task();
    }
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
