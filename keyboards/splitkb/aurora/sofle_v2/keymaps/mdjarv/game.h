// Dungeon mode: the game in dungeon/ takes the keys and the left OLED.
// The game runs on the USB half, which processes the keys; the other half
// only shows the right OLED's frame (game_hud_frame).
#pragma once

#include <stdbool.h>
#include <stdint.h>

bool game_active(void);
// Enters or leaves dungeon mode. A game left keeps its state for the next entry.
void game_toggle(void);
// A key pressed while dungeon mode is on (the resolved keycode).
void game_key(uint16_t keycode);
// Draws the game on the OLED; called from the OLED task while active.
void game_render(void);

// Registers the split link handler; both halves, at start-up.
void game_init(void);
// USB half: sends the right OLED's frame over the split link when it changes.
void game_task(void);
// The other half: the frame to show on its OLED, or NULL when not playing.
const uint8_t *game_hud_frame(void);
