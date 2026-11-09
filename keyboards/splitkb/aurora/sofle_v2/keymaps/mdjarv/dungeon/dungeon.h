// The dungeon game. Plain C with no QMK in it, so the same code runs in the
// firmware (game.c drives it on the left OLED) and in the PC simulator
// (tools/dungeon), where it is played and tested without a flash.
#pragma once

#include <stdbool.h>
#include <stdint.h>

// The left OLED: 32x128 portrait. A frame is laid out like the OLED buffer:
// byte x + (y / 8) * 32, bit y % 8 (the same layout kbscreen sends).
#define DUNGEON_W 32
#define DUNGEON_H 128
#define DUNGEON_FRAME_SIZE (DUNGEON_W * DUNGEON_H / 8)

// What the player can press. The firmware (game.c) and the simulator
// (tools/dungeon/keys.go) map keys onto these; keep the two in step.
enum dungeon_button {
    DUNGEON_UP,
    DUNGEON_DOWN,
    DUNGEON_LEFT,
    DUNGEON_RIGHT,
    DUNGEON_TURN_LEFT,
    DUNGEON_TURN_RIGHT,
    DUNGEON_ACT,
    DUNGEON_BACK,
    DUNGEON_BUTTONS,
};

// Starts a new game. now_ms is a free-running millisecond clock; it may wrap.
void dungeon_start(uint32_t seed, uint32_t now_ms);
void dungeon_press(uint8_t button, uint32_t now_ms);
// Draws the left screen: the view, the hands, health. Call it up to 20 times a
// second; the 3D view is only worked out again when something changes.
void dungeon_render(uint8_t frame[DUNGEON_FRAME_SIZE], uint32_t now_ms);
// Draws the right screen: the map and what the hero carries.
void dungeon_render_hud(uint8_t frame[DUNGEON_FRAME_SIZE], uint32_t now_ms);

#ifdef DUNGEON_SIM
void dungeon_sim_put(uint8_t f, char what);
void dungeon_sim_hp(uint8_t hp);
#endif
