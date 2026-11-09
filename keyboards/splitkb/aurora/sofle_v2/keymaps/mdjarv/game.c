// Runs dungeon/ in the firmware: maps keys to its buttons and shows its frames
// on the left OLED. tools/dungeon/keys.go maps the PC's keys the same way.
#include QMK_KEYBOARD_H
#include "game.h"
#include "dungeon/dungeon.h"

#define GAME_FRAME_MS 50 // 20 fps, the OLED's own refresh

static bool     active, started;
static bool     dirty;
static uint16_t drawn_at;
static uint8_t  frame[DUNGEON_FRAME_SIZE];

bool game_active(void) { return active; }

void game_toggle(void) {
    active = !active;
    if (!active) return;
    // Whatever was held on entry would stay pressed on the computer, since
    // its release never reaches it.
    clear_keyboard();
    if (!started) {
        started = true;
        dungeon_start(timer_read32() ^ 0x9e3779b9u, timer_read32());
    }
    dirty = true;
}

static int8_t button(uint16_t keycode) {
    if (IS_QK_MOD_TAP(keycode)) keycode = QK_MOD_TAP_GET_TAP_KEYCODE(keycode);
    switch (keycode) {
        case KC_W: case KC_K: case KC_UP: return DUNGEON_UP;
        case KC_S: case KC_J: case KC_DOWN: return DUNGEON_DOWN;
        case KC_A: case KC_H: case KC_LEFT: return DUNGEON_LEFT;
        case KC_D: case KC_L: case KC_RIGHT: return DUNGEON_RIGHT;
        case KC_Q: return DUNGEON_TURN_LEFT;
        case KC_E: return DUNGEON_TURN_RIGHT;
        case KC_SPC: case KC_ENT: case KC_F: return DUNGEON_ACT;
        case KC_ESC: case KC_BSPC: case KC_TAB: return DUNGEON_BACK;
    }
    return -1;
}

void game_key(uint16_t keycode) {
    int8_t b = button(keycode);
    if (b < 0) return;
    dungeon_press(b, timer_read32());
    dirty = true;
}

void game_render(void) {
    if (dirty || timer_elapsed(drawn_at) >= GAME_FRAME_MS) {
        dungeon_render(frame, timer_read32());
        drawn_at = timer_read();
        dirty    = false;
    }
    oled_write_raw((const char *)frame, sizeof(frame)); // only changed bytes are sent
}
