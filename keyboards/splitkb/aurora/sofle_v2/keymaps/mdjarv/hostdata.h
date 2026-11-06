// Data the host daemon (tools/kbscreen) sends over Raw HID for the left OLED.
// Every report is 32 bytes; byte 0 is the type. Multi-byte numbers are little
// endian. Text is ASCII. tools/kbscreen/protocol.go is the other side of this.
#pragma once

#include <stdbool.h>
#include <stdint.h>

enum host_msg {
    // Once a second: [1] cpu %  [2] gpu %  [3..4] RAM used, tenths of GiB
    // [5] RAM GiB  [6..7] VRAM used (with GTT spill), tenths of GiB
    // [8] VRAM GiB  [9] battery %  [10] battery state (host_battery)
    // [11] hour  [12] minute (local time)
    HOST_SYS = 0x01,
    // [1] flags (bit 0 playing)  [2..3] position s  [4..5] length s
    // [6] volume % (255 unknown)  [7] muted
    HOST_MEDIA = 0x02,
    // [1] field (0 title, 1 artist)  [2] total length  [3] offset  [4..31] text
    HOST_TEXT = 0x03,
    // [1] chunk 0..4  [2..29] art bytes at chunk * 28; 128 bytes in all, laid
    // out like the OLED buffer: 4 pages of 32 columns, bit 0 the top row
    HOST_ART = 0x04,
    // [1..10] spectrum bands 0..255, low to high
    HOST_SPECTRUM = 0x05,
    // [1] rows in all (<= 6)  [2] first row in this report  [3] rows here (<= 3)
    // [4] running  [5] waiting (every live session)  [6] waiting, older than
    // an hour  [7] idle or finished, older than an hour  [8] the oldest of
    // those questions' age (minutes 0..59, 60+hours, 84+days)
    // [9] flags (bit 0: a session started waiting in the last 10 minutes)
    // [10..] rows of 6 bytes: 5 name chars (space padded) and a state.
    // Rows are sessions updated in the last hour, newest first.
    HOST_AGENTS = 0x06,
};

enum host_metric { METRIC_CPU, METRIC_GPU };

enum host_battery { BATTERY_HIDDEN, BATTERY_DISCHARGING, BATTERY_CHARGING };

enum agent_state { AGENT_IDLE, AGENT_WORKING, AGENT_WAITING, AGENT_DONE };

#define HOST_TEXT_MAX 64
#define HOST_ART_SIZE 128
#define HOST_BANDS 10
#define HOST_HISTORY 32 // SYS samples kept for the graphs, one per pixel column
#define HOST_AGENT_ROWS 6

typedef struct {
    char    name[6];
    uint8_t state;
} agent_row_t;

typedef struct {
    uint32_t last_any; // timer_read32() of the newest report of any type
    uint32_t last_sys, last_media, last_spectrum, last_agents;

    // Newest SYS sample, and the last HOST_HISTORY of each, oldest first.
    uint8_t  cpu, gpu;                 // percent
    uint16_t ram_used, vram_used;      // tenths of GiB
    uint8_t  ram_total, vram_total;    // GiB
    uint8_t  battery, battery_state;   // percent, host_battery
    uint8_t  hour, minute;
    uint8_t  history[2][HOST_HISTORY]; // CPU and GPU load, indexed by host_metric
    uint8_t  history_len;

    bool     playing, muted;
    uint16_t position, length;
    uint8_t  volume;
    uint32_t volume_changed; // when volume or mute last changed
    char     title[HOST_TEXT_MAX + 1], artist[HOST_TEXT_MAX + 1];
    uint8_t  art[HOST_ART_SIZE];
    uint8_t  bands[HOST_BANDS];

    uint8_t     agent_count, agents_running, agents_waiting;
    uint8_t     later_waiting, later_idle, oldest_wait; // oldest_wait: age code, see HOST_AGENTS
    bool        new_question;
    agent_row_t agents[HOST_AGENT_ROWS];
} host_state_t;

extern host_state_t host;

// Whether a report of that kind arrived within ms.
bool host_fresh(uint32_t last, uint32_t ms);
