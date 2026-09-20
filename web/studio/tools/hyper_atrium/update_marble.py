"""Refresh only the shared marble material. Leave composition and light intact."""
import argparse
import json
import os
from pathlib import Path
import sys

os.environ.setdefault("CYCLES_METAL_DISABLE_BINARY_ARCHIVES", "1")
import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT / "assets/blender/hyper-atrium/hyper-atrium.blend"
sys.path.insert(0, str(HERE))
from refine_fidelity_materials import _stone

parser = argparse.ArgumentParser()
parser.add_argument("--save", action="store_true")
parser.add_argument("--preview", type=Path, help="Optional 640px material-check output")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene


def scene_state():
    return {
        "camera": tuple(value for row in scene.camera.matrix_world for value in row),
        "lens": scene.camera.data.lens,
        "exposure": scene.view_settings.exposure,
        "objects": [(obj.name, tuple(value for row in obj.matrix_world for value in row), obj.hide_render) for obj in scene.objects],
        "lights": [(obj.name, obj.data.energy, tuple(obj.data.color)) for obj in scene.objects if obj.type == "LIGHT"],
        "meshes": [(mesh.name, len(mesh.vertices), len(mesh.polygons)) for mesh in bpy.data.meshes],
    }


before = scene_state()
material = _stone()
assert before == scene_state(), "Marble refresh changed scene geometry or lighting"
images = [node.image for node in material.node_tree.nodes if node.type == "TEX_IMAGE"]
assert len(images) == 3 and len({image.name for image in images}) == 1
assert images[0].packed_file and tuple(images[0].size) == (1254, 1254)
shader = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
assert all(shader.inputs[channel].is_linked for channel in ("Base Color", "Roughness", "Normal"))
print("MARBLE_VERIFIED", json.dumps({"material": material.name, "image": images[0].name, "nodes": len(material.node_tree.nodes), "packed": True, "sceneUnchanged": True}), flush=True)
if args.save:
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
if args.preview:
    preferences = bpy.context.preferences.addons["cycles"].preferences
    preferences.compute_device_type = "METAL"
    preferences.kernel_optimization_level = "OFF"
    preferences.get_devices()
    for device in preferences.devices:
        device.use = device.type == "METAL"
    scene.cycles.device = "GPU"
    scene.cycles.samples = 24
    scene.cycles.adaptive_threshold = 0.04
    scene.cycles.use_denoising = True
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    scene.render.resolution_x, scene.render.resolution_y = 640, 360
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    args.preview.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(args.preview)
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)
