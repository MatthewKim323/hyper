"""Apply the measured composition and botanical/material passes to the source."""
import json
from pathlib import Path
import sys
import bpy
from bpy_extras.object_utils import world_to_camera_view

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from composition import apply as compose, REFERENCE_BOUNDS, STATIONS
from landscape import replace_landscape
from refine_fidelity_materials import apply as refine_materials
from rocks import apply as refine_rocks
from side_light import apply as add_side_light

OUT = HERE.parents[1] / "assets/blender/hyper-atrium"
bpy.ops.wm.open_mainfile(filepath=str(OUT / "hyper-atrium.blend"))
scene = bpy.context.scene
compose(scene)
replace_landscape(wall_y=27, camera_y=-21, opening_scale=48/29, height_scale=1.65)
refine_materials(scene)
refine_rocks(scene)
add_side_light(scene)
bpy.context.view_layer.update()
graph = bpy.context.evaluated_depsgraph_get()
measurements = []
portals = []
for key, name, x, y, width, height, label, icon in STATIONS:
    obj = bpy.data.objects[name + " | solid clear arched crystal"].evaluated_get(graph)
    mesh = obj.to_mesh()
    projected = [world_to_camera_view(scene, scene.camera, obj.matrix_world @ vertex.co) for vertex in mesh.vertices]
    left, top = min(point.x for point in projected), 1-max(point.y for point in projected)
    right, bottom = max(point.x for point in projected), 1-min(point.y for point in projected)
    actual = [left*1672, top*941, right*1672, bottom*941]
    target = REFERENCE_BOUNDS[key]
    measurements.append({"station": key, "targetPixels": target, "actualPixels": [round(value, 2) for value in actual], "maxBoundaryErrorPixels": round(max(abs(a-b) for a,b in zip(actual,target)), 2)})
    portals.append({"name": name, "left": left, "top": top, "width": right-left, "height": bottom-top})
    obj.to_mesh_clear()
record = {"referenceSize": [1672,941], "measurement": "Manually identified visible glass aperture bounds, excluding pedestals. This measures composition only, not photographic fidelity.", "camera": {"position": list(scene.camera.location), "target": list(scene["camera_target"])}, "stations": measurements}
(OUT / "composition-verification.json").write_text(json.dumps(record, indent=2)+"\n")
(OUT / "hotspots.json").write_text(json.dumps({"width":2560,"height":1441,"portals":portals},indent=2)+"\n")
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "hyper-atrium.blend"), compress=True)
print("REFERENCE_COMPOSITION", json.dumps(measurements), flush=True)
