# qmk_userspace (mdjarv)

External QMK userspace for one keyboard: splitkb Aurora Sofle v2 with Liatris (RP2040) controllers. Builds against an untouched `~/git/keyboard/qmk_firmware` (`qmk config` points `qmk_home` and `overlay_dir` at the two repos). Never fork or edit qmk_firmware for this.

## Layout

- `keyboards/splitkb/aurora/sofle_v2/keymaps/mdjarv/`: the keymap; its README lists what each file holds.
  - `keymap.json`: layers, encoders, converter and all data-driven settings. Layers are numbered; `layers.h` names them for C and must stay in the same order.
  - `keymap.c`: behaviour only (hold-to-toggle game mode, the right knob's `SCREEN_NEXT`, Liatris LED off). The build includes it into the code generated from keymap.json.
  - `oled.c`, `gfx/`: OLED entry point and animations. A blanked OLED must not draw: drawing turns it back on and fights the split OLED sync.
  - `screens.c`, `hostdata.[ch]`: the left (USB) OLED only shows frames from `tools/kbscreen` (the cat when it is silent for 3 s). It sends back the right knob's single/double/long presses and layer + mods, and takes brightness and keep-awake commands. `hostdata.h` is that protocol; `tools/kbscreen/frame.go` must match it. Don't name a keymap header after a QMK one (`host.h` shadowed QMK's and broke `sofle_v2.c`).
  - `game.c`, `dungeon/`: dungeon mode (double tap of the game toggle). `dungeon/` is the game in plain C, no QMK headers, so `tools/dungeon` builds the same files; `game.c` maps keycodes to its buttons and draws it on the left OLED.
  - `config.h`, `rules.mk`: only what keymap.json cannot express.
- `tools/kbflash/`: Go (Bubble Tea) tool behind `make flash|backup|restore|drill`. Halves are recognised by RP2040 flash ID from `kbflash.json`; picotool `--ser` matches the flash ID, not the USB serial. Tests: `got --report .` in that directory (a fake picotool and fake sysfs drive the real flow).
- `tools/kbscreen/`: Go daemon that draws the left OLED (systemd user unit `kbscreen`). It gathers the data (/proc, amdgpu sysfs, battery, clock, playerctl + wpctl/pactl, parec spectrum, Agentique's read API with `url` and read `token` in `~/.config/kbscreen/config.toml`) and runs the pages, which are JavaScript in `js/` (goja). Its README is the scripting reference; `DESIGN.md` holds the design verdicts. Tests: `got --report .` in that directory.
- `tools/dungeon/`: Go (cgo, Bubble Tea) simulator for `dungeon/`: `make dungeon` plays it in the terminal, `ARGS="-keys 'w a' -png f.png"` writes a frame. The core's files are symlinked into it (Go's build cache ignores `#include`d files outside the package, so an include would run stale code); a new core file needs a link. Its key map (`keys.go`) mirrors `game.c`. Tests: `make dungeon-test` (AddressSanitizer, needs clang); they check the contract, not pixels.
- `archive/vial-2026-10-21.vil`: the Vial layout this keymap came from.

## Left OLED pages

New pages and changes to them never need a flash: they are JavaScript in `tools/kbscreen/js/`, one file per page in `pages/`, with drawing helpers in `lib.js` and the page switching in `main.js`.

- Read `tools/kbscreen/DESIGN.md` first, then the README's scripting section (what `render(d, t)`, `knob(kind)`, `display` and every field of `d` are).
- Loop: edit and save; the running service reloads within a second; look at the keyboard or http://localhost:8077 (`/frame.png` for a screenshot to put in a design round, `/error` for the last script error). A broken save keeps the last good version drawing; `journalctl --user -u kbscreen -f` has the log.
- A page is a new file `pages/NN-name.js` registering one draw function with `page('name', ...)`, its own helpers kept inside the file's wrapping function (the files share one global scope). The number sets the knob order. `main.js` only needs a change if the page should come up by itself (`context`).
- New data needs Go: a source (like `sys.go`), a field in `Sys`/`Media` (`types.go`), its mapping into `jsData`/`toJS` (`render.go`), a line in the README's table, and a test of the source against fake files. Rebuild with `make screen-install`.
- The Go tests check the contract (frames, reload, new page files, runaway scripts, every built-in page draws), not pixels, so restyling a page does not break them. Run them after changing the scripts anyway: they catch a page that throws.
- Still firmware (needs a flash): anything about the right OLED, the cat fallback and its 3 s timeout, the 60 s idle blanking, the knob timings, frame rates above 20 fps, and new kinds of keyboard input. Keystrokes are not sent to the host on purpose; typing-driven pages should read the keyboard's input device on the computer.

## Workflow

1. Edit `keymap.json` (or the C files); `make build` to compile. qmk cannot build from a path with a space in it (Agentique worktrees live under `QMK Userspace/`): "Could not find keymap". Build from a copy at a space-free path.
2. After layer changes, `make draw` to redraw `keymap.svg`.
3. `make flash` (builds, then guides through both halves; both must run the same firmware). `ERASE=1` clears stored settings.
4. If it goes wrong: `make restore BACKUP=~/git/keyboard/backups/<dir>`; the newest QMK-era backup is `20261021-104152`, the Vial-era one `20261021-083326-drill`.
5. Push to GitHub: Actions builds the firmware and publishes it as the "Latest QMK Firmware" release.

## Open threads

- Double taps (2026-10-21): debounce changed to `asym_eager_defer_pk` 10 ms without measuring. If they persist, measure first: log same-key re-presses within 50 ms of release from this keyboard's input device.
- Volume sometimes jumps to max (2026-10-21): not investigated; seen on the old Vial firmware. Same logger idea: count volume-up bursts from this keyboard to tell the encoder from the host. The left OLED now shows the volume for 1.5 s after every change, which may show when it happens.
- OLED idle blanking (60 s, both halves) not explicitly confirmed on hardware; since 2026-11-06 kbscreen can also hold both screens on (keep-awake while music plays).
