"""
Entry point. Run from the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender -b -noaudio \
        --python tools/props/build_props.py

Pass filenames after `--` to rebuild only those:

    ... --python tools/props/build_props.py -- rig_brazier.glb
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import propkit                       # noqa: E402
import build_rig, build_stack, build_berk, build_sea   # noqa: E402,F401

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
propkit.build_all(only=set(argv) or None)
