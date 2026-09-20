"""Update only shared marble and the approved measured key/fill lighting.

Use --preview for a 640px CPU check, or --save after visual verification.
No station geometry, camera, landscape, hero material, or water is rebuilt.
"""
import argparse
import json
from pathlib import Path
import runpy
import sys

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT / "assets/blender/hyper-atrium/hyper-atrium.blend"
sys.path.insert(0, str(HERE))
from refine_fidelity_materials import _stone, apply_lighting_balance
from side_light import apply as apply_side_key

parser = argparse.ArgumentParser()
parser.add_argument("--save", action="store_true")
parser.add_argument("--preview", action="store_true")
parser.add_argument("--output", default="/tmp/hyper-light-diagnostics/marble-candidate.png")
args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
original_camera = scene.camera.matrix_world.copy()
material = _stone()
apply_lighting_balance(scene)
description = apply_side_key(scene)
bpy.context.view_layer.update()
assert scene.camera.matrix_world == original_camera
assert material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].is_linked
print("MARBLE_LIGHTING",json.dumps({"material":material.name,"nodes":len(material.node_tree.nodes),"sidePower":description["power"],"targets":description["apertures"]}),flush=True)
if args.save:
    runpy.run_path(str(HERE / "verify.py"))
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
if args.preview:
    output = Path(args.output)
    output.parent.mkdir(parents=True,exist_ok=True)
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    scene.cycles.device = "CPU"
    scene.cycles.samples = 32
    scene.cycles.adaptive_threshold = 0.04
    scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    scene.render.filepath = str(output)
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)
