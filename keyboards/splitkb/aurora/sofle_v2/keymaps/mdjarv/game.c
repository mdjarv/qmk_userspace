// Runs dungeon/ in the firmware: maps keys to its buttons and shows its
// frames. tools/dungeon/keys.go maps the PC's keys the same way.
//
// The game runs on the USB half, which gets the keys and draws the left OLED.
// It also draws the right OLED's frame and sends it to the other half over
// the split link, in chunks, when it changes; the other half only shows it.
#include QMK_KEYBOARD_H
#include <string.h>
#include "transactions.h"
#include "game.h"
#include "dungeon/dungeon.h"

#define GAME_FRAME_MS 50 // 20 fps, the OLED's own refresh

static bool     active, started;
static bool     dirty, hud_dirty;
static uint16_t drawn_at;
static uint8_t  frame[DUNGEON_FRAME_SIZE];

bool game_active(void) { return active; }

void game_toggle(void) {
    active = !active;
    if (!active) return;
    // Whatever was held on entry would stay pressed on the computer, since
    // its release never reaches it.
    clear_keyboard();
    if (!started) {
        started = true;
        dungeon_start(timer_read32() ^ 0x9e3779b9u, timer_read32());
    }
    dirty = hud_dirty = true;
}

static int8_t button(uint16_t keycode) {
    if (IS_QK_MOD_TAP(keycode)) keycode = QK_MOD_TAP_GET_TAP_KEYCODE(keycode);
    switch (keycode) {
        case KC_W: case KC_UP: return DUNGEON_UP;
        case KC_S: case KC_DOWN: return DUNGEON_DOWN;
        case KC_A: case KC_LEFT: return DUNGEON_LEFT;
        case KC_D: case KC_RIGHT: return DUNGEON_RIGHT;
        case KC_Q: return DUNGEON_TURN_LEFT;
        case KC_E: return DUNGEON_TURN_RIGHT;
        case KC_SPC: case KC_ENT: case KC_F: return DUNGEON_ACT;
        case KC_ESC: case KC_BSPC: return DUNGEON_BACK;
        case KC_TAB: return DUNGEON_MENU;
    }
    return -1;
}

void game_key(uint16_t keycode) {
    int8_t b = button(keycode);
    if (b < 0) return;
    dungeon_press(b, timer_read32());
    dirty = hud_dirty = true;
}

void game_render(void) {
    if (dirty || timer_elapsed(drawn_at) >= GAME_FRAME_MS) {
        dungeon_render(frame, timer_read32());
        drawn_at = timer_read();
        dirty    = false;
    }
    oled_write_raw((const char *)frame, sizeof(frame)); // only changed bytes are sent
}

// ------------------------------------------------------------------ right OLED

// [0] chunk index, or HUD_OFF to say dungeon mode ended  [1..] the frame's bytes
#define HUD_CHUNK 62
#define HUD_CHUNKS ((DUNGEON_FRAME_SIZE + HUD_CHUNK - 1) / HUD_CHUNK)
#define HUD_OFF 0xFF
#define HUD_HEARTBEAT_MS 500 // a chunk is resent this often, so the other half knows the game is on
#define HUD_TIMEOUT_MS 2000  // without one this long, the other half shows its own screen again
_Static_assert(HUD_CHUNK + 1 <= RPC_M2S_BUFFER_SIZE, "a chunk must fit the split RPC buffer");
_Static_assert(HUD_CHUNKS <= 16, "pending chunks are a 16-bit mask");

// USB half: what was sent, and what is still to send.
static uint8_t  hud[DUNGEON_FRAME_SIZE], hud_sent[DUNGEON_FRAME_SIZE];
static uint16_t hud_pending;
static bool     hud_was_active, hud_off_pending;
static uint32_t hud_sent_at;

// The other half: the frame as received.
static uint8_t  hud_rx[DUNGEON_FRAME_SIZE];
static bool     hud_rx_on;
static uint32_t hud_rx_at;

static void hud_receive(uint8_t in_len, const void *in, uint8_t out_len, void *out) {
    const uint8_t *d = in;
    if (in_len < 1) return;
    if (d[0] == HUD_OFF) {
        hud_rx_on = false;
        return;
    }
    uint16_t off = d[0] * HUD_CHUNK;
    if (off >= DUNGEON_FRAME_SIZE) return;
    uint16_t n = MIN(MIN(HUD_CHUNK, DUNGEON_FRAME_SIZE - off), in_len - 1);
    memcpy(hud_rx + off, d + 1, n);
    hud_rx_on = true;
    hud_rx_at = timer_read32();
}

void game_init(void) {
    transaction_register_rpc(USER_SYNC_DUNGEON, hud_receive);
}

const uint8_t *game_hud_frame(void) {
    if (!hud_rx_on || timer_elapsed32(hud_rx_at) >= HUD_TIMEOUT_MS) return NULL;
    return hud_rx;
}

// One chunk per call, so the scan loop never waits on more than one transfer.
void game_task(void) {
    if (active != hud_was_active) {
        hud_was_active  = active;
        hud_pending     = active ? (1u << HUD_CHUNKS) - 1 : 0; // on entry the other half has nothing yet
        hud_off_pending = !active;
    }
    if (!active) {
        uint8_t off[1] = {HUD_OFF};
        if (hud_off_pending && transaction_rpc_send(USER_SYNC_DUNGEON, sizeof(off), off)) hud_off_pending = false;
        return;
    }
    if (hud_dirty) {
        hud_dirty = false;
        dungeon_render_hud(hud, timer_read32());
        for (uint8_t c = 0; c < HUD_CHUNKS; c++) {
            uint16_t off = c * HUD_CHUNK, n = MIN(HUD_CHUNK, DUNGEON_FRAME_SIZE - off);
            if (memcmp(hud + off, hud_sent + off, n)) hud_pending |= 1u << c;
        }
    }
    if (!hud_pending && timer_elapsed32(hud_sent_at) >= HUD_HEARTBEAT_MS) hud_pending = 1;
    if (!hud_pending) return;
    uint8_t c = 0;
    while (!(hud_pending >> c & 1)) c++;
    uint16_t off = c * HUD_CHUNK, n = MIN(HUD_CHUNK, DUNGEON_FRAME_SIZE - off);
    uint8_t  msg[HUD_CHUNK + 1];
    msg[0] = c;
    memcpy(msg + 1, hud + off, n);
    if (transaction_rpc_send(USER_SYNC_DUNGEON, n + 1, msg)) {
        memcpy(hud_sent + off, hud + off, n);
        hud_pending &= ~(1u << c);
        hud_sent_at = timer_read32();
    }
}
