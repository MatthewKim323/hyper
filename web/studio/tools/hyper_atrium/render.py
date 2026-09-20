"""Render the unified authored scene without changing the saved composition."""
import argparse
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from props import is_station_cover, hide_station_covers

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets/blender/hyper-atrium"
parser = argparse.ArgumentParser()
parser.add_argument("--preview", action="store_true")
parser.add_argument("--cpu", action="store_true", help="Render on CPU if the local Metal shader compiler is unavailable")
parser.add_argument("--save-composition", action="store_true", help="Save station visibility and remove obsolete mask outputs before temporary render settings")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
bpy.ops.wm.open_mainfile(filepath=str(OUT / "hyper-atrium.blend"))
scene = bpy.context.scene

library = bpy.data.collections.get("Crystal library | reusable onboarding stations")
if library:
    library.hide_render = True
for obj in bpy.data.objects:
    if obj.get("station") and not obj.get("station_template"):
        obj.hide_render = False
        for child in obj.children_recursive:
            child.hide_render = is_station_cover(child)
    if obj.get("station_template"):
        obj.hide_render = True
        for child in obj.children_recursive:
            child.hide_render = True
hide_station_covers(scene)

# The web now renders true geometry and does not consume masks or backplates.
if scene.use_nodes:
    for node in list(scene.node_tree.nodes):
        if node.type in {"OUTPUT_FILE", "ID_MASK"}:
            scene.node_tree.nodes.remove(node)
scene.view_layers[0].use_pass_object_index = False
if args.save_composition:
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "hyper-atrium.blend"), compress=True)
scene.render.resolution_x = 1280 if args.preview else 2560
scene.render.resolution_y = 720 if args.preview else 1441
scene.render.resolution_percentage = 100
scene.cycles.samples = 32 if args.preview else 96
scene.cycles.adaptive_threshold = 0.04 if args.preview else 0.025
scene.cycles.use_denoising = True
scene.cycles.use_auto_tile = True
scene.cycles.tile_size = 512
scene.render.filepath = str(OUT / ("review.png" if args.preview else "hyper-atrium.png"))
try:
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    # Generic kernels avoid a macOS Metal pipeline-cache crash during repeated
    # background previews after changing the scene's shader feature set.
    preferences.kernel_optimization_level = "OFF"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = device.type == "METAL"
    scene.cycles.device = "CPU" if args.cpu else "GPU"
except Exception:
    scene.cycles.device = "CPU"
scene.frame_set(1)
print("RENDER_SOURCE", bpy.data.filepath, flush=True)
print("RENDER_OUTPUT", scene.render.filepath, flush=True)
print("RENDER_SETTINGS", scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples, scene.cycles.device, flush=True)
bpy.ops.render.render(write_still=True)
