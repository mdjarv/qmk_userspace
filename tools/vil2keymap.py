#!/usr/bin/env python3
"""Print the keymaps[] and encoder_map[] blocks for keymap.c from a Vial .vil backup.

One-off migration helper for the Sofle v2 (60-key LAYOUT). Renames keycodes
Vial saved under pre-2022 QMK names, and maps the one tap dance in use to the
equivalent mod-tap.

  vil2keymap.py BACKUP.vil KEYBOARD_JSON
"""

import json
import sys

RENAME = {
    "KC_TRNS": "_______", "KC_NO": "XXXXXXX",
    "KC_BSLASH": "KC_BSLS", "KC_BSPACE": "KC_BSPC", "KC_LBRACKET": "KC_LBRC", "KC_RBRACKET": "KC_RBRC",
    "KC_LCTRL": "KC_LCTL", "KC_LSHIFT": "KC_LSFT", "KC_RSHIFT": "KC_RSFT", "KC_PGDOWN": "KC_PGDN",
    "KC_SCOLON": "KC_SCLN", "KC_ESCAPE": "KC_ESC", "KC_ENTER": "KC_ENT", "KC_SPACE": "KC_SPC",
    "KC_DELETE": "KC_DEL", "KC_INSERT": "KC_INS", "KC_GRAVE": "KC_GRV", "KC_QUOTE": "KC_QUOT",
    "KC_COMMA": "KC_COMM", "KC_SLASH": "KC_SLSH", "KC_MINUS": "KC_MINS", "KC_EQUAL": "KC_EQL",
    "KC_WH_U": "MS_WHLU", "KC_WH_D": "MS_WHLD",
    # shifted US symbols, same keycode values as LSFT(...)
    "LSFT(KC_1)": "KC_EXLM", "LSFT(KC_2)": "KC_AT", "LSFT(KC_3)": "KC_HASH", "LSFT(KC_4)": "KC_DLR",
    "LSFT(KC_5)": "KC_PERC", "LSFT(KC_6)": "KC_CIRC", "LSFT(KC_7)": "KC_AMPR", "LSFT(KC_8)": "KC_ASTR",
    "LSFT(KC_9)": "KC_LPRN", "LSFT(KC_0)": "KC_RPRN", "LSFT(KC_MINUS)": "KC_UNDS", "LSFT(KC_EQUAL)": "KC_PLUS",
    "LSFT(KC_LBRACKET)": "KC_LCBR", "LSFT(KC_RBRACKET)": "KC_RCBR", "LSFT(KC_BSLASH)": "KC_PIPE",
    "LSFT(KC_GRAVE)": "KC_TILD",
    # Vial tap dance 8: tap Esc, hold Right Shift, 200 ms
    "TD(8)": "RSFT_T(KC_ESC)",
    "MO(2)": "MO(_LOWER)", "MO(3)": "MO(_RAISE)", "MO(4)": "MO(_ADJUST)",
    "DF(0)": "DF(_DEFAULT)", "DF(1)": "DF(_GAME)",
}
LAYER_NAMES = ["_DEFAULT", "_GAME", "_LOWER", "_RAISE", "_ADJUST"]
# LAYOUT argument rows as 14 display columns (6 left, 2 encoder presses, 6 right); None is a gap
HALF = [0, 1, 2, 3, 4, 5]
ROWS = [
    HALF + [None, None] + HALF,
    HALF + [None, None] + HALF,
    HALF + [None, None] + HALF,
    list(range(14)),
    [None] + [0, 1, 2, 3, 4] + [None, None] + [0, 1, 2, 3, 4] + [None],
]


def name(code):
    if code in RENAME:
        return RENAME[code]
    if "(" in code or "TD" in code:
        sys.exit(f"vil2keymap: no mapping for {code}")
    return code


def main():
    vil = json.load(open(sys.argv[1]))
    keys = json.load(open(sys.argv[2]))["layouts"]["LAYOUT"]["layout"]
    layers = [[name(vil["layout"][n][k["matrix"][0]][k["matrix"][1]]) for k in keys]
              for n in range(len(LAYER_NAMES))]
    width = max(len(c) for codes in layers for c in codes)
    print("const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {")
    for layer_name, codes in zip(LAYER_NAMES, layers):
        print(f"    [{layer_name}] = LAYOUT(")
        i = 0
        for slots in ROWS:
            cells = []
            for slot in slots:
                if slot is None:
                    cells.append(" " * (width + 2))
                else:
                    cells.append(f"{codes[i] + ',':<{width + 2}}")
                    i += 1
            line = "".join(cells).rstrip()
            if i == len(codes):
                line = line.rstrip(",")
            print(f"        {line}")
        print("    ),")
    print("};\n")
    print("const uint16_t PROGMEM encoder_map[][NUM_ENCODERS][NUM_DIRECTIONS] = {")
    for n, layer_name in enumerate(LAYER_NAMES):
        encs = ", ".join(f"ENCODER_CCW_CW({name(ccw)}, {name(cw)})" for ccw, cw in vil["encoder_layout"][n])
        print(f"    [{layer_name}] = {{ {encs} }},")
    print("};")


if __name__ == "__main__":
    main()
