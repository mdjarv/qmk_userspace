// The USB half's OLED: frames drawn by the host, or the cat when it is silent.
#pragma once

// Draws the current frame. Call from oled_task_user on the USB half.
void screens_render(void);
// The knob press: the host decides what it means.
void screens_next(void);
