# kbscreen

Draws the Sofle's left OLED and sends it over Raw HID. The keyboard only shows the frames (and the cat when kbscreen is silent for 3 s); everything on that screen is JavaScript in `js/`, reloaded when you save. `DESIGN.md` has the design verdicts the current screens follow.

| Data | Source |
|---|---|
| Perf | `/proc/stat`, `/proc/meminfo`, amdgpu `gpu_busy_percent` and `mem_info_vram_used` + `mem_info_gtt_used`, `power_supply/BAT*`, local time |
| Music | `playerctl` (MPRIS) for track and art, `wpctl`/`pactl` for volume, `parec` on the default monitor for the spectrum |
| Agents | Agentique's read API: `url` in kbscreen's config, or the local server from `~/.config/agentique/config.toml` |

## Editing the screens

The service runs the repo's `js/` (`make screen-install` points it there) and serves a preview at http://localhost:8077, so: edit a page in `js/pages/`, save, look at the keyboard or the preview (`/frame.png` is the current frame, `/error` the last script error). New files are picked up too. A script that does not load, or a frame that throws or takes over 200 ms, is logged (`journalctl --user -u kbscreen -f`) and shown on the preview page, and the last good version keeps drawing.

Files load in this order, into one global scope:

- `lib.js`: `Frame` (a 512-byte buffer in OLED layout with `px`, `fill`, `rect`, `dotted`, `text`/`glyph` in the keyboard's 6x8 font, `tiny`/`tinyRight` in a 3x5 font, `sprite` from `'#'` rows, `pages` for raw bytes), `W` = 32, `H` = 128, and what pages share: `f` (the frame they draw into, cleared before each page), `page(name, draw)`, `robot(x, y, state, t, i)` (the 9x9 agent avatar), `asking(d)`, and `display`.
- `pages/*.js` in name order, one page each. A page registers a `draw(d, t)` that draws into `f`; the file name's number sets the knob order. Keep a page's helpers inside its wrapping function so pages cannot clash:
  ```js
  'use strict';
  page('zoo', (function () {
    const CAGE = ['#####', '#...#', '#####'];   // private to this page
    return function zoo(d, t) {
      f.sprite(CAGE, 0, 0);
    };
  })());
  ```
- `main.js`: `render(d, t)` (picks the page, sets `display`, draws the volume readout over any page, returns `f.buf`) and `knob(kind)`, called with `"press"`, `"double"` (twice within 250 ms) or `"long"` (held 500 ms). A single press arrives 250 ms late, once the keyboard knows it was not a double. `context(d)` there decides which page comes up by itself.
- `save`: an object the pages keep game state in (counters, crops). kbscreen hands it to every fresh runtime on reload and writes it to `~/.local/state/kbscreen/save.json` (`-save`) every 10 s and on exit; a file that is not JSON is moved to `save.json.bad`. Keep it plain JSON and small.
- `display`: set `display.brightness` (0..255, the left OLED) and `display.keepAwake` (both OLEDs stay on past the 60 s idle blanking while true); kbscreen sends them on.

`t` is milliseconds since kbscreen started. Globals survive between frames, not across reloads.

`d` (see `jsData` in `render.go`):

| Field | |
|---|---|
| `d.sys` | `cpu`, `gpu` (percent), `cpuHistory`, `gpuHistory` (last 32 s, oldest first), `ramUsed`, `ramTotal`, `vramUsed`, `vramTotal` (GiB; VRAM includes GTT spill), `battery` (percent), `batteryState` (`charging`, `discharging`, `hidden`), `clock` (`14:53`) |
| `d.media` | `playing`, `title`, `artist` (ASCII), `position`, `length` (s), `volume` (percent, -1 unknown), `muted`, `volumeChangedAgo` (ms, -1 never), `art` (128 bytes, 32x32 in OLED layout), `bands` (10 spectrum bands 0..255) |
| `d.keyboard` | `null` until the keyboard reports; else `layer` (`base`, `game`, `lower`, `raise`), `ctrl`, `shift`, `alt`, `gui` |
| `d.agents` | `null` without Agentique; else `rows` (`{id, name, state}`, state `working`, `waiting`, `done`, `idle`; sessions updated in the last hour, newest first), `running`, `waiting`, `laterWaiting`, `laterIdle`, `oldestWait` (`3D`), `newQuestion` (a question in the last 10 minutes), `sessions` (`{id, name, state, turns, merged}` for every live and parked session and those archived in the last day; state is a row's or `parked`, `archived`), `totals` (`sessions`, `turns`, `archived`, `merged`, `models` over everything Agentique lists) |

`make screen` runs kbscreen in the foreground with the same scripts and preview (stop the service first); `DRY=1` also leaves the keyboard alone and logs the data once a second.

## Files

| File | Holds |
|---|---|
| `js/lib.js`, `js/pages/*.js`, `js/main.js` | The pages (also built into the binary, used without `-scripts`) |
| `render.go` | goja runtime, reload, the `d` object (`jsData`) |
| `frame.go`, `device.go` | Frame chunks, commands and keyboard events over hidraw |
| `sys.go`, `media.go`, `art.go`, `spectrum.go`, `agents.go` | The data sources |
| `types.go`, `main.go`, `preview.go` | State, the render loop, the browser preview |
| `font.go` | The keyboard's OLED font, generated from qmk_firmware's `glcdfont.c` |

## Setup

1. Keyboard access (once): `sudo install -m644 70-kbscreen.rules /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger`
2. Agent board (optional): mint a read token on the machine running Agentique, `agentique tokens add kbscreen --perm read --expires 365d`, and put it in `~/.config/kbscreen/config.toml` (mode 600):
   ```toml
   [agentique]
   url = "https://host.tailnet.ts.net:19201"  # leave out for this machine's own server
   token = "aqt_..."
   ```
   Without a token the agent screen says NO LINK.
3. `make screen-install` from the repo root: installs `~/.local/bin/kbscreen` and the `kbscreen` systemd user unit.

The frame protocol is in `keyboards/splitkb/aurora/sofle_v2/keymaps/mdjarv/hostdata.h`; `frame.go` is the other side.
