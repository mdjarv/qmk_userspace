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
};

// Keyboard to host: [0] HOST_EVENT  [1] host_event_kind
#define HOST_EVENT 0x80
enum host_event_kind { HOST_EVENT_KNOB = 1 };

#define HOST_FRAME_SIZE 512
#define HOST_CHUNK 28

// The newest frame, or NULL when none arrived within timeout_ms.
const uint8_t *host_frame(uint32_t timeout_ms);
void           host_send_event(uint8_t kind);
