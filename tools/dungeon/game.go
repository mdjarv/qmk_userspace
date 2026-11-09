package main

/*
#cgo CFLAGS: -DDUNGEON_SIM -Wall -Wextra
#include "dungeon.h"
*/
import "C"

import "unsafe"

// The core's files are symlinked in from the keymap rather
// than #included: Go's build cache only notices files in the package, so an
// included core would leave the simulator and tests on stale code. A new core
// file needs a link too (ln -s ../../keyboards/.../dungeon/<file> .).
//
// The core keeps one game in static state, as it does on the keyboard, so
// there is one game per process.

const (
	width     = C.DUNGEON_W
	height    = C.DUNGEON_H
	frameSize = C.DUNGEON_FRAME_SIZE
)

func start(seed, now uint32) { C.dungeon_start(C.uint32_t(seed), C.uint32_t(now)) }

func press(button int, now uint32) { C.dungeon_press(C.uint8_t(button), C.uint32_t(now)) }

// render returns a frame in OLED layout: byte x + (y/8)*32, bit y%8.
func render(now uint32) []byte {
	f := make([]byte, frameSize)
	C.dungeon_render((*C.uint8_t)(unsafe.Pointer(&f[0])), C.uint32_t(now))
	return f
}

// renderHUD returns the right screen's frame, drawn as the keyboard's other
// half draws it: from the packed state, not from the game.
func renderHUD(now uint32) []byte {
	st := make([]byte, C.DUNGEON_HUD_STATE)
	C.dungeon_hud_state((*C.uint8_t)(unsafe.Pointer(&st[0])))
	f := make([]byte, frameSize)
	C.dungeon_render_hud((*C.uint8_t)(unsafe.Pointer(&st[0])), (*C.uint8_t)(unsafe.Pointer(&f[0])))
	return f
}

// renderWhole draws the left screen's view in one pass, without the slicing
// the keyboard (and render) use: the reference the slices must add up to.
func renderWhole(now uint32) []byte {
	f := make([]byte, frameSize)
	C.dungeon_sim_render_whole((*C.uint8_t)(unsafe.Pointer(&f[0])), C.uint32_t(now))
	return f
}

func lit(f []byte, x, y int) bool { return f[x+(y/8)*width]>>(y%8)&1 == 1 }

// put places something f cells ahead (see dungeon_sim_put): r b k m, p s h, >.
func put(f int, what byte) { C.dungeon_sim_put(C.uint8_t(f), C.char(what)) }

func setHP(hp int) { C.dungeon_sim_hp(C.uint8_t(hp)) }
