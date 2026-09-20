"""Build and review garden changes outside the authoritative Blender source.

The camera, ridge vertices, and every non-garden object must remain unchanged.
Candidate settings are saved before the temporary small CPU render settings.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
AUTHORITATIVE = ROOT / "assets/blender/hyper-atrium/hyper-atrium.blend"
sys.path.insert(0, str(HERE))
from landscape import replace_landscape


def geometry_signature(obj):
    return [tuple(vertex.co) for vertex in obj.data.vertices]


parser = argparse.ArgumentParser()
parser.add_argument("--source", default=str(AUTHORITATIVE))
parser.add_argument("--output-directory", default="/tmp/hyper-floral-candidate")
parser.add_argument("--skip-render", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
source = Path(args.source).resolve()
output = Path(args.output_directory).resolve()
candidate = output / "hyper-atrium.blend"
assert candidate != source and candidate != AUTHORITATIVE.resolve()
output.mkdir(parents=True, exist_ok=True)
source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(source))
scene = bpy.context.scene
old_ground = scene.objects["Landscape | rolling rose garden ridges"]
original_terrain = geometry_signature(old_ground)
camera = scene.camera.matrix_world.copy()
other_objects = {obj.name: obj.matrix_world.copy() for obj in scene.objects
                 if not obj.name.startswith("Landscape | ")}
garden = replace_landscape(scene, wall_y=old_ground.get("wall_y", 27.0),
                           camera_y=scene.camera.location.y,
                           opening_scale=old_ground.get("opening_scale", 48 / 29),
                           height_scale=old_ground.get("height_scale", old_ground.get("ridge_height_m", 4.95) / 3.0))
bpy.context.view_layer.update()
assert geometry_signature(garden["ground"]) == original_terrain, "Terrain vertices changed"
assert scene.camera.matrix_world == camera, "Camera changed"
assert all(scene.objects[name].matrix_world == matrix for name, matrix in other_objects.items())
stats = {}
for obj in garden.values():
    obj.data.calc_loop_triangles()
    stats[obj.name] = {"triangles": len(obj.data.loop_triangles), "vertices": len(obj.data.vertices)}
stats["totalTriangles"] = sum(value["triangles"] for value in stats.values())
assert stats["totalTriangles"] <= 250000
stats["crowns"] = garden["canopies"]["botanical_crowns"]
stats["blossoms"] = garden["blossoms"]["blossoms"]
stats["petals"] = garden["blossoms"]["petals"]
stats["terrainUnchanged"] = True
stats["cameraUnchanged"] = True
stats["source"] = str(source)
stats["candidate"] = str(candidate)
(output / "stats.json").write_text(json.dumps(stats, indent=2) + "\n")
bpy.ops.wm.save_as_mainfile(filepath=str(candidate), compress=True)
assert hashlib.sha256(source.read_bytes()).hexdigest() == source_digest
print("GARDEN_CANDIDATE", json.dumps(stats), flush=True)
if not args.skip_render:
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
    scene.render.filepath = str(output / "review.png")
    scene.frame_set(1)
    bpy.ops.render.render(write_still=True)
