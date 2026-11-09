#pragma once

// Layer order in keymap.json, which can only refer to layers by number.
// _DUNGEON is not in keymap.json: it has no keys (a layer past the keymap's
// is all transparent). Dungeon mode turns it on so the other half, which
// gets the layer state through QMK's split sync, knows to show the game.
enum layers { _DEFAULT, _GAME, _LOWER, _RAISE, _DUNGEON };
