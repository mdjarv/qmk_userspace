#!/usr/bin/env python3
"""Save the live Vial layout to a .vil file, using vial-gui's own serializer.

Output is the same as Vial's File > Save current layout. Re-runs itself under
uv with vial-gui's dependencies, and clones vial-gui at a pinned commit into
~/.cache/kbflash on first use. Only useful while the keyboard runs Vial.

  vial_dump.py OUT.vil
"""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

VIAL_GUI_REPO = "https://github.com/vial-kb/vial-gui.git"
VIAL_GUI_COMMIT = "aef8222a2d0429a183b2ed692d5f9efcfd383f08"
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "kbflash"
VIAL_GUI = CACHE / "vial-gui"
DEPS = ["hidapi", "PyQt5", "simpleeval"]


def ensure_vial_gui():
    if (VIAL_GUI / ".git").exists():
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "-q", VIAL_GUI_REPO, str(VIAL_GUI)], check=True)
    subprocess.run(["git", "-C", str(VIAL_GUI), "checkout", "-q", VIAL_GUI_COMMIT], check=True)


def reexec_under_uv():
    cmd = ["uv", "run", "-q", "--no-project", "--python", "3.12"]
    for dep in DEPS:
        cmd += ["--with", dep]
    # vial-gui's keymap tables trip SyntaxWarning on current Python
    cmd += ["python", "-I", "-W", "ignore::SyntaxWarning", str(Path(__file__).resolve()), *sys.argv[1:]]
    env = dict(os.environ, KBFLASH_VIAL_UV="1", QT_QPA_PLATFORM="offscreen")
    os.execvpe(cmd[0], cmd, env)


def dump(out):
    src = VIAL_GUI / "src/main/python"
    sys.path.insert(0, str(src))
    from editor.qmk_settings import QmkSettings
    from util import find_vial_devices

    class Ctx:
        def get_resource(self, name):
            return str(VIAL_GUI / "src/main/resources/base" / name)

    QmkSettings.initialize(Ctx())
    devices = [d for d in find_vial_devices({"definitions": {}}, quiet=True)
               if type(d).__name__ == "VialKeyboard"]
    if len(devices) != 1:
        sys.exit(f"vial_dump: expected one Vial keyboard, found {len(devices)}")
    dev = devices[0]
    dev.open()
    data = dev.keyboard.save_layout()
    dev.close()
    Path(out).write_bytes(data)
    layout = json.loads(data)
    print(f"{dev.title()}: {len(layout['layout'])} layers, sha256 {hashlib.sha256(data).hexdigest()[:12]} -> {out}")


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    if not os.environ.get("KBFLASH_VIAL_UV"):
        ensure_vial_gui()
        reexec_under_uv()
    dump(sys.argv[1])


if __name__ == "__main__":
    main()
