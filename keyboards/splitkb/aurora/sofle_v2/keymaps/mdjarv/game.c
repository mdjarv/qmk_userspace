// Runs dungeon/ in the firmware: maps keys to its buttons and shows its
// frames. tools/dungeon/keys.go maps the PC's keys the same way.
//
// The game runs on the USB half, which gets the keys. Its logic runs at once
// on each key; drawing is kept apart from it: the 3D view is worked out a
// slice per main loop pass (game_task), so the keyboard never waits on it for
// long, and the OLED task only puts the latest view together with the hands
// and bars (game_render).
//
// The right OLED is drawn by the other half itself, from a small state this
// half sends over the split link when it changes (dungeon_hud_state). That
// half knows the game is on from the _DUNGEON layer, which QMK's own split
// sync carries, so a transfer that fails only delays the map, never takes
// the game off that screen.
#include QMK_KEYBOARD_H
#include <string.h>
#include "transactions.h"
#include "game.h"
#include "hostdata.h"
#include "dungeon/dungeon.h"
#include "layers.h"
#ifdef CONVERT_TO_LIATRIS
// The RP2040's free-running 1 MHz timer, low word (TIMERAWL, datasheet 4.6.5).
#    define now_us() (*(volatile uint32_t *)0x40054028)
#else
#    define now_us() (timer_read32() * 1000)
#endif

// What it costs, sent to kbscreen once a second while playing (it logs them;
// HOST_EVENT_DUNGEON in hostdata.h).
static struct {
    uint32_t step_max, step_sum, compose_max, fail_max;
    uint16_t steps, views, loops, rpc_ok, rpc_fail;
    uint8_t  slave_rx, slave_have;
    uint32_t sent_at;
} diag;

static bool    active, started, hud_dirty;
static uint8_t frame[DUNGEON_FRAME_SIZE];

bool game_active(void) { return active; }

void game_toggle(void) {
    active = !active;
    if (!active) {
        layer_off(_DUNGEON);
        return;
    }
    layer_on(_DUNGEON);
    // Whatever was held on entry would stay pressed on the computer, since
    // its release never reaches it.
    clear_keyboard();
    if (!started) {
        started = true;
        dungeon_start(timer_read32() ^ 0x9e3779b9u, timer_read32());
    }
    hud_dirty = true;
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
    hud_dirty = true;
}

// Every OLED task (20 times a second): the latest view, with what moves on top.
void game_render(void) {
    uint32_t t0 = now_us();
    dungeon_compose(frame, timer_read32());
    uint32_t us = now_us() - t0;
    if (us > diag.compose_max) diag.compose_max = us;
    oled_write_raw((const char *)frame, sizeof(frame)); // only changed bytes are sent
}

// ------------------------------------------------------------------ right OLED

// The state goes over in chunks: [0] chunk index  [1..] its bytes. The other
// half answers with the chunks it holds, and missing ones are sent again.
#define HUD_CHUNK 29
#define HUD_CHUNKS ((DUNGEON_HUD_STATE + HUD_CHUNK - 1) / HUD_CHUNK)
#define HUD_ALL ((1u << HUD_CHUNKS) - 1)
// A failed transfer costs the split link's timeout (20 ms) of the main loop,
// so transfers are spaced out, and more so after a failure: a link that fails
// must not slow the keyboard down.
#define HUD_GAP_MS 5
#define HUD_RETRY_MS 100
_Static_assert(HUD_CHUNK + 1 <= RPC_M2S_BUFFER_SIZE, "a chunk must fit the split RPC buffer");
_Static_assert(HUD_CHUNKS <= 8, "chunk sets are 8-bit masks");

// This half: the state, what the other half has of it, what is still to send.
static uint8_t  hud[DUNGEON_HUD_STATE], hud_sent[DUNGEON_HUD_STATE];
static uint8_t  hud_pending;
static bool     hud_was_active;
static uint32_t hud_tried_at, hud_wait;

// The other half: the state as received (and which chunks of it since the
// game came on), and the frame drawn from it.
static uint8_t hud_rx[DUNGEON_HUD_STATE], hud_frame[DUNGEON_FRAME_SIZE];
static uint8_t hud_rx_have, hud_rx_count;
static bool    hud_rx_new, hud_rx_shown;

// Runs on the other half, in the split link's thread: only copies, so the
// answer goes back quickly; the drawing happens in its OLED task. Answers
// [0] messages received (mod 256)  [1] the chunks it holds.
static void hud_receive(uint8_t in_len, const void *in, uint8_t out_len, void *out) {
    const uint8_t *d = in;
    if (in_len >= 1 && d[0] < HUD_CHUNKS) {
        uint16_t off = d[0] * HUD_CHUNK;
        memcpy(hud_rx + off, d + 1, MIN(MIN(HUD_CHUNK, DUNGEON_HUD_STATE - off), in_len - 1));
        hud_rx_have |= 1u << d[0];
        hud_rx_new = true;
    }
    hud_rx_count++;
    if (out_len >= 2) {
        ((uint8_t *)out)[0] = hud_rx_count;
        ((uint8_t *)out)[1] = hud_rx_have;
    }
}

void game_init(void) {
    transaction_register_rpc(USER_SYNC_DUNGEON, hud_receive);
}

const uint8_t *game_hud_frame(void) {
    if (!layer_state_is(_DUNGEON)) {
        if (hud_rx_shown) hud_rx_have = 0; // the game ended: forget its state
        hud_rx_shown = false;
        return NULL;
    }
    if (!hud_rx_shown || hud_rx_new) {
        hud_rx_shown = true;
        hud_rx_new   = false;
        // until the first state arrives this draws an empty map and pack
        dungeon_render_hud(hud_rx, hud_frame);
    }
    return hud_frame;
}

static void hud_task(void) {
    if (active != hud_was_active) {
        hud_was_active = active;
        hud_pending    = active ? HUD_ALL : 0; // on entry the other half has nothing yet
        hud_dirty      = active;
    }
    if (!active || timer_elapsed32(hud_tried_at) < hud_wait) return;
    if (hud_dirty) {
        hud_dirty = false;
        dungeon_hud_state(hud);
        for (uint8_t c = 0; c < HUD_CHUNKS; c++) {
            uint16_t off = c * HUD_CHUNK, n = MIN(HUD_CHUNK, DUNGEON_HUD_STATE - off);
            if (memcmp(hud + off, hud_sent + off, n)) hud_pending |= 1u << c;
        }
    }
    if (!hud_pending) return;
    uint8_t c = 0;
    while (!(hud_pending >> c & 1)) c++;
    uint16_t off = c * HUD_CHUNK, n = MIN(HUD_CHUNK, DUNGEON_HUD_STATE - off);
    uint8_t  msg[HUD_CHUNK + 1], reply[2] = {0};
    msg[0] = c;
    memcpy(msg + 1, hud + off, n);
    uint32_t t0  = now_us();
    hud_tried_at = timer_read32();
    if (transaction_rpc_exec(USER_SYNC_DUNGEON, n + 1, msg, sizeof(reply), reply)) {
        memcpy(hud_sent + off, hud + off, n);
        hud_pending &= ~(1u << c);
        hud_pending |= HUD_ALL & ~reply[1]; // whatever it lost (a restart), again
        hud_wait = HUD_GAP_MS;
        diag.rpc_ok++;
        diag.slave_rx   = reply[0];
        diag.slave_have = reply[1];
    } else {
        uint32_t us = now_us() - t0;
        if (us > diag.fail_max) diag.fail_max = us;
        hud_wait = HUD_RETRY_MS;
        diag.rpc_fail++;
    }
}

// ------------------------------------------------------------------ main loop

static void report(void) {
    diag.loops++;
    if (!active || timer_elapsed32(diag.sent_at) < 1000) return;
    diag.sent_at = timer_read32();
    uint32_t mean = diag.steps ? diag.step_sum / diag.steps : 0;
#define U16(v) (uint8_t)((v) > 0xFFFF ? 0xFF : (v)&0xFF), (uint8_t)((v) > 0xFFFF ? 0xFF : (v) >> 8)
    uint8_t d[19] = {U16(diag.step_max), U16(mean),      (uint8_t)MIN(diag.views, 255), U16(diag.loops), U16(diag.rpc_ok), U16(diag.rpc_fail),
                     diag.slave_rx,      diag.slave_have, U16(diag.fail_max),             U16(diag.compose_max)};
#undef U16
    host_send_report(HOST_EVENT_DUNGEON, d, sizeof(d));
    uint32_t sent_at = diag.sent_at;
    memset(&diag, 0, sizeof(diag));
    diag.sent_at = sent_at;
}

void game_task(void) {
    report();
    if (active) {
        uint32_t t0   = now_us();
        bool     done = dungeon_render_step(timer_read32());
        uint32_t us   = now_us() - t0;
        diag.step_sum += us;
        diag.steps++;
        if (us > diag.step_max) diag.step_max = us;
        if (done) diag.views++;
    }
    hud_task();
}
