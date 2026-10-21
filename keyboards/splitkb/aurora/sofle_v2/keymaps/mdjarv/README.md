# mdjarv: Aurora Sofle v2 with a Liatris

![layers](keymap.svg)

| File | Holds |
|---|---|
| `keymap.json` | Layers, encoders, the Liatris converter and every standard setting (features, tap-hold, debounce, split sync). Layers are numbered here; `layers.h` names them for C. Run `make draw` after changing it to redraw `keymap.svg`. |
| `keymap.c` | Behaviour: hold-to-toggle game mode, Liatris LED off |
| `oled.c`, `gfx/` | OLED screens and their animations |
| `config.h`, `rules.mk` | Only what `keymap.json` cannot express |

Behaviour worth knowing:

- **Game mode** (default layer 1) toggles after holding the outer right thumb key for 0.5 s, so a brushing palm does not switch it. The right OLED shows a different animation while it is on.
- **Esc / Right Shift** is one mod-tap key. Permissive hold makes pressing and releasing another key while it is down count as Shift.
- **Knobs**: left is volume, right is scroll; both do nothing on Lower.
- **Debounce** is `asym_eager_defer_pk` at 10 ms: presses register at once, releases wait 10 ms of stable contact, which swallows switch chatter.
- **OLEDs** blank after 60 s without input. RGB is off.

The layout came from the Vial backup in `archive/vial-2026-10-21.vil`.
