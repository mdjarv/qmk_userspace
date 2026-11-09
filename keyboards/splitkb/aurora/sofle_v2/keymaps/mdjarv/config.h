#pragma once

// QMK's own OLED timeout counts redraws as activity and the animations redraw
// constantly, so oled.c blanks the screens on input idle instead.
#define OLED_TIMEOUT 0

// The OLEDs take 400 kHz (SSD1306 fast mode); QMK's default is 100 kHz, too
// slow for dungeon mode, which changes most of the frame at once.
#define I2C1_CLOCK_SPEED 400000

// Dungeon mode sends the right OLED's frame to that half in chunks (game.c).
#define SPLIT_TRANSACTION_IDS_USER USER_SYNC_DUNGEON
#define RPC_M2S_BUFFER_SIZE 64
