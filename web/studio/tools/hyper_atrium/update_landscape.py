"""Patch the authored Blender source without rebuilding or losing its library."""
from pathlib import Path
import json
import sys

import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from landscape import build_landscape, refine_arch_lighting

SOURCE = HERE.parents[1] / "assets/blender/hyper-atrium/hyper-atrium.blend"
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
templates_before = sorted(obj.get("station_template") for obj in bpy.data.objects if obj.get("station_template"))
stations_before = sorted(obj.name for obj in bpy.data.objects if obj.get("station"))
removed = []
for obj in list(bpy.data.objects):
    if obj.name.startswith("Landscape | "):
        removed.append(obj.name)
        bpy.data.objects.remove(obj, do_unlink=True)
garden = build_landscape()
refine_arch_lighting(bpy.context.scene)
templates_after = sorted(obj.get("station_template") for obj in bpy.data.objects if obj.get("station_template"))
stations_after = sorted(obj.name for obj in bpy.data.objects if obj.get("station"))
assert templates_before == templates_after, "The crystal template library changed"
assert stations_before == stations_after, "The live station objects changed"
assert len(templates_after) == 10, "The unified scene must retain all ten crystal templates"
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
print("LANDSCAPE_UPDATED", json.dumps({"removed": removed, "objects": [{"name": obj.name, "vertices": len(obj.data.vertices), "polygons": len(obj.data.polygons)} for obj in garden.values()], "templates": len(templates_after), "stations": len(stations_after)}))
