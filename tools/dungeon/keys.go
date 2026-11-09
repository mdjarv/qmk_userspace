package main

/*
#include "dungeon.h"
*/
import "C"

// buttons maps keys (Bubble Tea's names, also the words of -keys) onto the
// game's buttons, as the keymap's game.c does on the keyboard. Keep the two
// in step.
var buttons = map[string]int{
	"w": C.DUNGEON_UP, "up": C.DUNGEON_UP,
	"s": C.DUNGEON_DOWN, "down": C.DUNGEON_DOWN,
	"a": C.DUNGEON_LEFT, "left": C.DUNGEON_LEFT,
	"d": C.DUNGEON_RIGHT, "right": C.DUNGEON_RIGHT,
	"q":     C.DUNGEON_TURN_LEFT,
	"e":     C.DUNGEON_TURN_RIGHT,
	"space": C.DUNGEON_ACT, "enter": C.DUNGEON_ACT, "f": C.DUNGEON_ACT,
	"esc": C.DUNGEON_BACK, "backspace": C.DUNGEON_BACK,
	"tab": C.DUNGEON_MENU,
}
