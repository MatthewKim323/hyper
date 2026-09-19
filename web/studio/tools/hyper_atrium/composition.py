"""Reference-space composition, calibrated from the supplied 1672 by 941 image.

The circular basin determines the camera elevation. Station aperture bounds then
determine their world positions and dimensions, rather than compensating in CSS.
"""
import json
import math
import bpy
from mathutils import Matrix, Vector
import props

CAMERA_POSITION = (0, -21, 3.05232384)
CAMERA_TARGET = (0, 2, 2.79158934)
STATIONS = [
    ("accounts-payable", "Accounts Payable", -7.8627, -1.6559, 2.6333, 3.3897, "Accounts\nPayable", "invoice"),
    ("wallet-identity", "Wallet Identity", -8.3371, 18.5455, 3.4144, 5.0959, "Wallet Identity", "ethereum"),
    ("audit-evidence", "Audit and Evidence", 7.4286, 20.0948, 3.3990, 4.9432, "Audit & Evidence", "audit"),
    ("training-arena", "Training Arena", 7.5748, 3.3900, 2.5510, 3.1112, "Training Arena", "cubes"),
    ("approvals", "Approvals", 7.3740, -3.6480, 1.9455, 2.9870, "Approvals", "rings"),
]
REFERENCE_BOUNDS = {
    "accounts-payable": [61, 383, 284, 669],
    "wallet-identity": [422, 348, 563, 558],
    "audit-evidence": [1063, 358, 1198, 554],
    "training-arena": [1257, 416, 1428, 624],
    "approvals": [1438, 413, 1622, 694],
}


def remap_architecture_point(point):
    """Keep the carved apertures framed while giving rear stations actual depth."""
    old_eye = Vector((0, -21, 3.9))
    old_forward = (Vector((0, 2, 2.4)) - old_eye).normalized()
    right = Vector((1, 0, 0))
    old_up = right.cross(old_forward)
    new_eye = Vector(CAMERA_POSITION)
    new_forward = (Vector(CAMERA_TARGET) - new_eye).normalized()
    new_up = right.cross(new_forward)
    relative = Vector(point) - old_eye
    depth = relative.dot(old_forward)
    ray = new_forward + right * (relative.x / depth) + new_up * (relative.dot(old_up) / depth)
    rear_y = 27 + (point[1] - 8) * (48 / 29)
    return new_eye + ray * ((rear_y - new_eye.y) / ray.y)


def material_map():
    names = {
        "stone": "Hyper | blush ivory honed limestone",
        "pearl": "Hyper | luminous ivory pearl",
        "metal": "Hyper | pale champagne satin metal",
        "text": "Hyper | warm graphite lettering",
        "glow": "Hyper | warm ivory seam light",
        "portal_glass": "Portals | optically clear rose crystal",
        "edge": "Portals | polished clear edge",
        "paper": "Icons | milky lilac opal glass",
        "white": "Icons | white enamel lettering",
    }
    return {key: bpy.data.materials[name] for key, name in names.items()}


def apply(scene):
    if not scene.get("reference_composition_v2"):
        for obj in list(scene.objects):
            if not obj.name.startswith("Atrium |") or obj.type != "MESH":
                continue
            world = obj.matrix_world.copy()
            positions = [remap_architecture_point(world @ vertex.co) for vertex in obj.data.vertices]
            obj.matrix_world = Matrix.Identity(4)
            for vertex, point in zip(obj.data.vertices, positions):
                vertex.co = point
            obj.data.update()
        apertures = []
        for x, width, apex in [(-13.1, 2, 7.5), (-7.1, 2.9, 10.7), (0, 6, 13.3), (7.1, 2.9, 10.7), (13.1, 2, 7.5)]:
            height = apex - width * .3
            left = remap_architecture_point((x-width*.45, 7.45, height))
            right = remap_architecture_point((x+width*.45, 7.45, height))
            apertures.append({"position": list((left+right)*.5), "width": right.x-left.x})
        scene["atrium_window_apertures"] = json.dumps(apertures)
        scene["reference_composition_v2"] = True
    source_names = {"Station | " + entry[1] for entry in STATIONS}
    for obj in list(scene.objects):
        if obj.name in source_names:
            for child in list(obj.children_recursive):
                bpy.data.objects.remove(child, do_unlink=True)
            bpy.data.objects.remove(obj, do_unlink=True)
    materials = material_map()
    for key, name, x, y, width, height, label, icon in STATIONS:
        props._portal(name, x, y, width, height, label, icon, materials)
        bpy.data.objects["Station | " + name]["reference_id"] = key
    pearl = bpy.data.objects.get("Hyper | floating pearl marble sphere")
    if pearl:
        pearl.location.z = 3.16
        pearl.scale = (1.535/1.45,) * 3
    scene.camera.location = CAMERA_POSITION
    scene.camera.rotation_euler = (Vector(CAMERA_TARGET) - scene.camera.location).to_track_quat("-Z", "Y").to_euler()
    scene["camera_target"] = list(CAMERA_TARGET)
    scene["reference_station_bounds"] = json.dumps(REFERENCE_BOUNDS)
    bpy.context.view_layer.update()
