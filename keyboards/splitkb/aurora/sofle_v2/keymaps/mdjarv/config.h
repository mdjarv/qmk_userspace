#pragma once

// QMK's own OLED timeout counts redraws as activity and the animations redraw
// constantly, so oled.c blanks the screens on input idle instead.
#define OLED_TIMEOUT 0

// Dungeon mode sends the right OLED's frame to that half in chunks (game.c).
#define SPLIT_TRANSACTION_IDS_USER USER_SYNC_DUNGEON
#define RPC_M2S_BUFFER_SIZE 64
