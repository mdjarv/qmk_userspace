#pragma once

// QMK's own OLED timeout counts redraws as activity and the animations redraw
// constantly, so oled.c blanks the screens on input idle instead.
#define OLED_TIMEOUT 0
#define OLED_IDLE_TIMEOUT 60000

// The slave half shows a different animation on the game layer.
#define SPLIT_LAYER_STATE_ENABLE

// Typing heatmap, as last set in Vial
#define RGB_MATRIX_FRAMEBUFFER_EFFECTS
#define RGB_MATRIX_KEYPRESSES
#define ENABLE_RGB_MATRIX_TYPING_HEATMAP
#define RGB_MATRIX_DEFAULT_MODE RGB_MATRIX_TYPING_HEATMAP
#define RGB_MATRIX_DEFAULT_HUE 131
#define RGB_MATRIX_DEFAULT_SAT 204
#define RGB_MATRIX_DEFAULT_VAL 128
#define RGB_MATRIX_DEFAULT_SPD 137
