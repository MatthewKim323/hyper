"""Physical off-camera clerestory key for the reference atrium.

Run apply(scene) after the material/lighting pass. This module creates geometry
and a focused light in memory; it does not load, save, export, or render files.
Coordinates use Blender's Z-up convention and scene units are meters.
"""
import json
import math

import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

COLLECTION = "Lighting | right clerestory"
LIGHT = "Fidelity | warm side aperture"


def _bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return tuple(Vector(tuple(fn(p[axis] for p in points) for axis in range(3))) for fn in (min, max))


def _frame(scene, collection, x, apertures, material):
    """One watertight stone mesh with three real rectangular openings."""
    y_limits, z_limits = (-20.0, 18.0), (-1.0, 34.0)
    ys = sorted({*y_limits, *(edge for a in apertures for edge in (a["position"][1] - a["width"] / 2, a["position"][1] + a["width"] / 2))})
    zs = sorted({*z_limits, *(edge for a in apertures for edge in (a["position"][2] - a["height"] / 2, a["position"][2] + a["height"] / 2))})
    depth = 0.48
    vertices = [(side, y, z) for side in (x - depth / 2, x + depth / 2) for y in ys for z in zs]
    layer = len(ys) * len(zs)
    solid = {}
    for i in range(len(ys) - 1):
        for j in range(len(zs) - 1):
            y, z = (ys[i] + ys[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            solid[i, j] = not any(abs(y - a["position"][1]) < a["width"] / 2 and abs(z - a["position"][2]) < a["height"] / 2 for a in apertures)
    faces = []
    for (i, j), occupied in solid.items():
        if not occupied:
            continue
        a, b = i * len(zs) + j, (i + 1) * len(zs) + j
        c, d = b + 1, a + 1
        faces.extend(((a, d, c, b), (a + layer, b + layer, c + layer, d + layer)))
        for neighbor, first, last in (((i - 1, j), a, d), ((i, j + 1), d, c), ((i + 1, j), c, b), ((i, j - 1), b, a)):
            if not solid.get(neighbor, False):
                faces.append((last, first, first + layer, last + layer))
    data = bpy.data.meshes.new("Right clerestory | carved stone mesh")
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new("Right clerestory | three carved light apertures", data)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    obj["hyper_side_light"] = True
    if scene.camera:
        projected = [world_to_camera_view(scene, scene.camera, Vector(point)) for point in vertices]
        if any(point.z > 0 and 0 <= point.x <= 1 and 0 <= point.y <= 1 for point in projected):
            raise ValueError("The side-aperture baffle entered the reference camera view")
    return obj


def apply(scene):
    """Replace the broad right fill with aperture-shaped warm illumination."""
    bpy.context.view_layer.update()
    wall = scene.objects.get("Atrium | monolithic blush limestone")
    if wall is None:
        raise ValueError("The atrium rear wall is required before applying the side key")
    low, high = _bounds(wall)
    windows = json.loads(scene.get("atrium_window_apertures", "[]"))
    window_top = max((entry["position"][2] for entry in windows), default=high.z * .7)
    side_x = high.x + 1.5
    source = Vector((side_x + 15, -15, max(18, window_top + 7.5)))
    pearl = scene.objects.get("Hyper | floating pearl marble sphere")
    pearl_center = sum(_bounds(pearl), Vector()) * .5 if pearl else Vector((0, 1.5, 3.16))
    target_points = [
        ("pearl", pearl_center, 2.4, 1.65),
        ("left wall", Vector((-high.x * .25, low.y - .3, 9.4)), 1.7, 1.8),
        ("right wall", Vector((high.x * .52, low.y - .3, window_top - .7)), 4.0, 2.2),
    ]
    apertures = []
    for name, target, width, height in target_points:
        fraction = (side_x - source.x) / (target.x - source.x)
        center = source.lerp(target, fraction)
        apertures.append({"name": name, "position": list(center), "width": width, "height": height, "target": list(target)})

    collection = bpy.data.collections.get(COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION)
        scene.collection.children.link(collection)
    for obj in tuple(collection.objects):
        if obj.get("hyper_side_light"):
            data = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0:
                bpy.data.meshes.remove(data)
    material = bpy.data.materials.get("Hyper | blush ivory honed limestone")
    if material is None:
        raise ValueError("Apply the limestone material pass before the side key")
    frame = _frame(scene, collection, side_x, apertures, material)

    lamp = scene.objects.get(LIGHT)
    if lamp is None:
        lamp = bpy.data.objects.new(LIGHT, bpy.data.lights.new(LIGHT, "SPOT"))
        scene.collection.objects.link(lamp)
    lamp.data.type = "SPOT"
    lamp.location = source
    target = Vector((0, low.y * .45, 8))
    direction = (target - source).normalized()
    lamp.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    lamp.data.energy = 240000
    lamp.data.color = (1.0, .79, .65)
    lamp.data.spot_size = math.radians(56)
    lamp.data.spot_blend = .18
    lamp.data.shadow_soft_size = .38
    lamp.data.use_shadow = True
    # A spot has no glowing card for the pearl to reproduce as a rectangle.
    # The opening edges and finite source radius produce the physical penumbra.
    bpy.context.view_layer.update()
    description = {
        "position": list(source), "target": list(target), "direction": list(direction),
        "color": list(lamp.data.color), "power": lamp.data.energy,
        "coneAngle": lamp.data.spot_size, "coneBlend": lamp.data.spot_blend,
        "sourceRadius": lamp.data.shadow_soft_size,
        "apertureNormal": [-1, 0, 0], "apertures": apertures,
        "occluder": {"name": frame.name, "x": side_x, "depth": .48, "y": [-20, 18], "z": [-1, 34]},
    }
    scene["atrium_side_light"] = json.dumps(description)
    return description
