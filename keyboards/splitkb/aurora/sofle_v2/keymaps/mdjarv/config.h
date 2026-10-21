#pragma once

// QMK's own OLED timeout counts redraws as activity and the animations redraw
// constantly, so oled.c blanks the screens on input idle instead.
#define OLED_TIMEOUT 0
