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
    DUNGEON_MENU, // the inventory on the right screen, and back
    DUNGEON_BUTTONS,
};

// Starts a new game. now_ms is a free-running millisecond clock; it may wrap.
void dungeon_start(uint32_t seed, uint32_t now_ms);
void dungeon_press(uint8_t button, uint32_t now_ms);
// The left screen. The 3D view is worked out a slice at a time, so a caller
// with other work (the keyboard's main loop) is never held up for long:
// dungeon_render_step does one slice and says when a new view is finished;
// dungeon_compose draws the screen from the latest view, with the hands,
// effects and bars on top (cheap; call it for every frame shown).
// dungeon_render does both at once, for callers that can wait.
bool dungeon_render_step(uint32_t now_ms);
void dungeon_compose(uint8_t frame[DUNGEON_FRAME_SIZE], uint32_t now_ms);
void dungeon_render(uint8_t frame[DUNGEON_FRAME_SIZE], uint32_t now_ms);

// The right screen is drawn from a small state, so the half that shows it
// need not run the game: dungeon_hud_state packs it (where the game runs),
// dungeon_render_hud draws it (on either half).
#define DUNGEON_HUD_STATE 57
void dungeon_hud_state(uint8_t state[DUNGEON_HUD_STATE]);
void dungeon_render_hud(const uint8_t state[DUNGEON_HUD_STATE], uint8_t frame[DUNGEON_FRAME_SIZE]);

#ifdef DUNGEON_SIM
void dungeon_sim_put(uint8_t f, char what);
void dungeon_sim_hp(uint8_t hp);
void dungeon_sim_render_whole(uint8_t frame[DUNGEON_FRAME_SIZE], uint32_t now_ms);
#endif
