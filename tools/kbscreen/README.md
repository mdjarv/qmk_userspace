# kbscreen

Feeds the Sofle's left OLED over Raw HID. The keyboard decides what to show; this sends the data once a second (the spectrum 30 times a second while music plays), and resends everything every 5 s so a replugged keyboard catches up.

| Screen | Source |
|---|---|
| Core grid | `/proc/stat`, `/proc/meminfo`, hwmon `k10temp` and `amdgpu`, `gpu_busy_percent` |
| Music | `playerctl` (MPRIS) for track and art, `wpctl`/`pactl` for volume, `parec` on the default monitor for the spectrum |
| Agents | Agentique's read API, address from `~/.config/agentique/config.toml` |

The report layout is in `keyboards/splitkb/aurora/sofle_v2/keymaps/mdjarv/hostdata.h`; `protocol.go` must match it.

## Setup

1. Keyboard access (once): `sudo install -m644 70-kbscreen.rules /etc/udev/rules.d/ && sudo udevadm control --reload && sudo udevadm trigger`
2. Agent board (optional): mint a read token and keep it private:
   `agentique tokens add kbscreen --perm read --expires 365d`, then put the printed token in `~/.config/kbscreen/agentique-token` with mode 600. Without it the agent screen stays off.
3. `make screen-install` from the repo root: installs `~/.local/bin/kbscreen` and the `kbscreen` systemd user unit.

`make screen DRY=1` prints what would be sent instead of sending it. Logs: `journalctl --user -u kbscreen`.
