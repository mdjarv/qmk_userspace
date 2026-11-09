// Dungeon mode: the game in dungeon/ takes the keys and the left OLED.
// Only the USB half calls these; it is the one that processes keys.
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
