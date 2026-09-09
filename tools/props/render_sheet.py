"""
Render every exported prop from a 3/4 view into assets/models/props/_preview/.
Numbers passing is not the same as a model reading correctly, so look at these.

    /Applications/Blender.app/Contents/MacOS/Blender -b -noaudio \
        --python tools/props/render_sheet.py -- [file.glb ...]
"""
import bpy
import math
import os
import sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PROPS = os.path.join(ROOT, "assets", "models", "props")
OUT = os.path.join(PROPS, "_preview")


VIEWS = {                      # camera direction, in Blender space
    "iso":   (0.75, -1.0, 0.55),
    "side":  (1.0, -0.02, 0.06),   # looking along -X, i.e. across the model
    "front": (0.02, -1.0, 0.06),   # looking along game -Z, at the front face
    "top":   (0.01, -0.01, 1.0),
}


def render(path, out_png, view="iso"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    # The glTF importer already multiplies COLOR_0 into base colour, so the
    # baked occlusion shows up here without any help.
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    ctr = (lo + hi) / 2
    rad = max((hi - lo).length / 2, 0.5)

    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x = sc.render.resolution_y = 480
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    # Enough ambient that an unlit facet is grey, not black -- otherwise every
    # preview looks like it has holes in it.
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (.22, .24, .27, 1)

    cam_d = bpy.data.cameras.new("c")
    cam = bpy.data.objects.new("c", cam_d)
    sc.collection.objects.link(cam)
    dirv = Vector(VIEWS[view]).normalized()
    cam.location = ctr + dirv * (rad * 3.1)
    cam_d.lens = 55
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (-dirv).to_track_quat("-Z", "Y")
    sc.camera = cam

    for vec, energy in (((0.6, -0.7, 1.0), 4.0), ((-0.9, 0.4, 0.3), 1.2)):
        ld = bpy.data.lights.new("l", "SUN")
        ld.energy = energy
        lo_ = bpy.data.objects.new("l", ld)
        sc.collection.objects.link(lo_)
        lo_.rotation_mode = "QUATERNION"
        lo_.rotation_quaternion = (-Vector(vec)).to_track_quat("-Z", "Y")

    # A ground plane, so it is obvious whether the model sits on it -- but not
    # for hanging props, which live entirely below it.
    if hi.z > 0.02:
        bpy.ops.mesh.primitive_plane_add(size=rad * 12, location=(ctr.x, ctr.y, 0))
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
os.makedirs(OUT, exist_ok=True)
view = os.environ.get("VIEW", "iso")
files = argv or sorted(f for f in os.listdir(PROPS) if f.endswith(".glb"))
for f in files:
    suffix = "" if view == "iso" else "_" + view
    render(os.path.join(PROPS, f), os.path.join(OUT, f[:-4] + suffix + ".png"), view)
    print("rendered", f, view)
