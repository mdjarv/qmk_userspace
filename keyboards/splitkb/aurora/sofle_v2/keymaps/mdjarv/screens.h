// The USB half's OLED: frames drawn by the host, or the cat when it is silent.
#pragma once

// Draws the current frame. Call from oled_task_user on the USB half.
void screens_render(void);
// The right knob's switch, pressed or released: sent to the host as a single,
// double or long press. The host decides what they mean.
void screens_knob(bool pressed);
// Call often on the USB half: finishes knob presses and reports layer and mods.
void screens_task(void);
