# kbscreen

Feeds the Sofle's left OLED over Raw HID. The keyboard decides what to show; this sends the data once a second (the spectrum 30 times a second while music plays), and resends everything every 5 s so a replugged keyboard catches up.

| Screen | Source |
|---|---|
| Perf | `/proc/stat`, `/proc/meminfo`, hwmon `k10temp` and `amdgpu`, `gpu_busy_percent`; the keyboard keeps the history |
| Music | `playerctl` (MPRIS) for track and art, `wpctl`/`pactl` for volume, `parec` on the default monitor for the spectrum |
| Agents | Agentique's read API: `url` in kbscreen's config, or the local server from `~/.config/agentique/config.toml` |

The report layout is in `keyboards/splitkb/aurora/sofle_v2/keymaps/mdjarv/hostdata.h`; `protocol.go` must match it.

## Setup

1. Keyboard access (once): `sudo install -m644 70-kbscreen.rules /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger`
2. Agent board (optional): mint a read token on the machine running Agentique, `agentique tokens add kbscreen --perm read --expires 365d`, and put it in `~/.config/kbscreen/config.toml` (mode 600):
   ```toml
   [agentique]
   url = "https://host.tailnet.ts.net:19201"  # leave out for this machine's own server
   token = "aqt_..."
   ```
   Without a token the agent screen stays off.
3. `make screen-install` from the repo root: installs `~/.local/bin/kbscreen` and the `kbscreen` systemd user unit.

`make screen DRY=1` prints what would be sent instead of sending it. Logs: `journalctl --user -u kbscreen`.
