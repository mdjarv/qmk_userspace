// Frames from the host (tools/kbscreen) for the left OLED, and the events the
// keyboard sends back. Every report is 32 bytes; byte 0 is the type.
// tools/kbscreen/frame.go is the other side of this.
#pragma once

#include <stdbool.h>
#include <stdint.h>

enum host_msg {
    // [1] chunk 0..18  [2..29] frame bytes at chunk * 28 into the back buffer.
    // A frame is 512 bytes laid out like the OLED buffer: byte x + (y / 8) * 32,
    // bit y % 8. The host sends only the chunks that changed.
    HOST_FRAME = 0x10,
    // Shows the back buffer.
    HOST_PRESENT = 0x11,
    // [1] left OLED brightness 0..255
    HOST_BRIGHTNESS = 0x12,
    // [1] seconds: keep both OLEDs on this long whatever the input idle time.
    // The host repeats it while it wants them on, so a dead host lets go.
    HOST_KEEP_AWAKE = 0x13,
};

// Keyboard to host: [0] HOST_EVENT  [1] host_event_kind  [2..] its data
#define HOST_EVENT 0x80
enum host_event_kind {
    HOST_EVENT_KNOB        = 1, // the right knob pressed once
    HOST_EVENT_STATE       = 2, // [2] highest layer  [3] mods (QMK's 8 mod bits); on change and once a second
    HOST_EVENT_KNOB_LONG   = 3, // held for KNOB_LONG_MS
    HOST_EVENT_KNOB_DOUBLE = 4, // pressed twice within KNOB_DOUBLE_MS
};

#define HOST_FRAME_SIZE 512
#define HOST_CHUNK 28

// The newest frame, or NULL when none arrived within timeout_ms.
const uint8_t *host_frame(uint32_t timeout_ms);
void           host_send_event(uint8_t kind, uint8_t a, uint8_t b);
// Whether the host currently asks for the OLEDs to stay on.
bool host_keep_awake(void);
