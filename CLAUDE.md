# qmk_userspace (mdjarv)

External QMK userspace for one keyboard: splitkb Aurora Sofle v2 with Liatris (RP2040) controllers. Builds against an untouched `~/git/keyboard/qmk_firmware` (`qmk config` points `qmk_home` and `overlay_dir` at the two repos). Never fork or edit qmk_firmware for this.

## Layout

- `keyboards/splitkb/aurora/sofle_v2/keymaps/mdjarv/`: the keymap; its README lists what each file holds.
  - `keymap.json`: layers, encoders, converter and all data-driven settings. Layers are numbered; `layers.h` names them for C and must stay in the same order.
  - `keymap.c`: behaviour only (hold-to-toggle game mode, `SCREEN_NEXT`, Liatris LED off). The build includes it into the code generated from keymap.json.
  - `oled.c`, `gfx/`: OLED entry point and animations. A blanked OLED must not draw: drawing turns it back on and fights the split OLED sync.
  - `screens.c`, `fb.c`, `hostdata.[ch]`: the left (USB) OLED's host-data screens. `hostdata.h` is the Raw HID protocol; `tools/kbscreen/protocol.go` must match it. Don't name a keymap header after a QMK one (`host.h` shadowed QMK's and broke `sofle_v2.c`).
  - `config.h`, `rules.mk`: only what keymap.json cannot express.
- `tools/kbflash/`: Go (Bubble Tea) tool behind `make flash|backup|restore|drill`. Halves are recognised by RP2040 flash ID from `kbflash.json`; picotool `--ser` matches the flash ID, not the USB serial. Tests: `got --report .` in that directory (a fake picotool and fake sysfs drive the real flow).
- `tools/kbscreen/`: Go daemon feeding the left OLED over Raw HID: /proc and hwmon, playerctl + wpctl/pactl, parec spectrum, Agentique's read API (`url` and read `token` in `~/.config/kbscreen/config.toml`). `make screen` runs it (`DRY=1` prints instead of sending), `make screen-install` installs the systemd user unit; the udev rule `70-kbscreen.rules` must be installed by hand with sudo. Tests: `got --report .` in that directory.
- `archive/vial-2026-10-21.vil`: the Vial layout this keymap came from.

## Workflow

1. Edit `keymap.json` (or the C files); `make build` to compile. qmk cannot build from a path with a space in it (Agentique worktrees live under `QMK Userspace/`): "Could not find keymap". Build from a copy at a space-free path.
2. After layer changes, `make draw` to redraw `keymap.svg`.
3. `make flash` (builds, then guides through both halves; both must run the same firmware). `ERASE=1` clears stored settings.
4. If it goes wrong: `make restore BACKUP=~/git/keyboard/backups/<dir>`; the newest QMK-era backup is `20261021-104152`, the Vial-era one `20261021-083326-drill`.
5. Push to GitHub: Actions builds the firmware and publishes it as the "Latest QMK Firmware" release.

## Open threads (2026-10-21)

- Double taps: debounce changed to `asym_eager_defer_pk` 10 ms without measuring. If they persist, measure first: log same-key re-presses within 50 ms of release from this keyboard's input device.
- Volume sometimes jumps to max: not investigated; seen on the old Vial firmware. Same logger idea: count volume-up bursts from this keyboard to tell the encoder from the host.
- OLED idle blanking (60 s, both halves) not yet confirmed on hardware.
