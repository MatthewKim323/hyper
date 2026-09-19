"""Lower the two tall side arch caps without rebuilding unrelated scene data."""
from pathlib import Path
import math

import bpy

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets/blender/hyper-atrium/hyper-atrium.blend"
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
if bpy.context.scene.get('reference_composition_v2'):
    raise RuntimeError('This patch targets the original shallow room. Rebuild the current measured composition with build.py.')
name = "Atrium | monolithic blush limestone"
original = bpy.data.objects[name]
material = original.data.materials[0]
bpy.data.objects.remove(original, do_unlink=True)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 8, 7.7))
wall = bpy.context.object
wall.name = name
wall.dimensions = (34, 1.0, 16.5)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
wall.data.materials.append(material)
for x, width, top in ((-13.1, 2.0, 7.5), (-7.1, 2.9, 10.7), (0, 6.0, 13.3), (7.1, 2.9, 10.7), (13.1, 2.0, 7.5)):
    radius = width / 2
    spring = top - radius
    outline = [(-radius, -1), (radius, -1), (radius, spring)]
    outline.extend((radius * math.cos(i * math.pi / 80), spring + radius * math.sin(i * math.pi / 80)) for i in range(1, 81))
    count = len(outline)
    vertices = [(x + px, y, z) for y in (6, 10) for px, z in outline]
    faces = [tuple(range(count)), tuple(range(2 * count - 1, count - 1, -1))]
    faces.extend((i + count, (i + 1) % count + count, (i + 1) % count, i) for i in range(count))
    data = bpy.data.meshes.new("Arch opening construction")
    data.from_pydata(vertices, [], faces)
    data.update()
    cutter = bpy.data.objects.new("Arch opening construction", data)
    bpy.context.scene.collection.objects.link(cutter)
    modifier = wall.modifiers.new("Carved arch", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.solver = "EXACT"
    modifier.object = cutter
    bpy.context.view_layer.objects.active = wall
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
edge = wall.modifiers.new("Worn architectural edges", "BEVEL")
edge.width = 0.07
edge.segments = 3
wall.modifiers.new("Architectural normals", "WEIGHTED_NORMAL")
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
print("ARCHITECTURE_UPDATED", len(wall.data.polygons), "side arch caps", 10.7)
