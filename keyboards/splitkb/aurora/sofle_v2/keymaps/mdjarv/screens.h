// The USB half's OLED: host data screens, or the cat when the host is silent.
#pragma once

// Draws the current screen. Call from oled_task_user on the USB half.
void screens_render(void);
// The knob press: show the next screen until the context changes.
void screens_next(void);
