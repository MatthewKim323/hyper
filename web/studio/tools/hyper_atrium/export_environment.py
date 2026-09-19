"""Export the authored atrium geometry for a fully live Three.js environment.

Run with the full Blender application binary. Export-time simplification only
changes the loaded copy. --clean-source-text saves the explicitly requested
removal of decorative text before any export-only optimization is applied.
"""
from pathlib import Path
import argparse
import json
import math
import struct
import sys

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = ROOT / 'assets/blender/hyper-atrium/hyper-atrium.blend'
OUTPUT = ROOT / 'public/assets/hyper-atrium'
parser = argparse.ArgumentParser()
parser.add_argument('--clean-source-text', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
if Path(bpy.data.filepath) != SOURCE:
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
OUTPUT.mkdir(parents=True, exist_ok=True)


def station_object(obj):
    current = obj
    while current:
        if current.get('station') or current.get('station_template') or current.name.startswith('Station | '):
            return True
        current = current.parent
    return any('Crystal library' in collection.name for collection in obj.users_collection)


removed_text = []
for obj in list(bpy.data.objects):
    decorative = obj.type == 'FONT' or obj.name == 'Hero pool | fine centered rule'
    if decorative and not station_object(obj):
        removed_text.append(obj.name)
        bpy.data.objects.remove(obj, do_unlink=True)
if args.clean_source_text:
    # Preserve all original topology, materials, stations, and template library.
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)

excluded_surfaces = {'Water | flooded atrium', 'Water | central reflecting basin', 'Atmosphere | atrium air'}
objects = [obj for obj in scene.objects if obj.type in {'MESH', 'CURVE'} and not station_object(obj) and obj.name not in excluded_surfaces and obj.type != 'FONT']

# Keep a representative third of the existing disconnected outcrop islands.
# Their spacing and silhouette remain irregular, with no runtime duplication.
foliage = next((obj for obj in objects if obj.name == 'Landscape | fine mineral outcrops'), None)
if foliage:
    original = foliage.data
    vertices, faces = [], []
    remap = {}
    for face in original.polygons:
        if (face.vertices[0] // 12) % 3:
            continue
        new_face = []
        for index in face.vertices:
            if index not in remap:
                remap[index] = len(vertices)
                vertices.append(tuple(original.vertices[index].co))
            new_face.append(remap[index])
        faces.append(tuple(new_face))
    optimized = bpy.data.meshes.new('Landscape | optimized distant mineral outcrops')
    optimized.from_pydata(vertices, [], faces)
    optimized.update()
    for material in original.materials:
        optimized.materials.append(material)
    for face in optimized.polygons:
        face.use_smooth = True
    foliage.data = optimized

for obj in objects:
    if obj.type == 'CURVE':
        obj.data.resolution_u = min(obj.data.resolution_u, 2)
        obj.data.bevel_resolution = min(obj.data.bevel_resolution, 2)
    for modifier in obj.modifiers:
        if modifier.type == 'BEVEL':
            modifier.segments = min(modifier.segments, 2)
        if modifier.type == 'SUBSURF':
            limit = 2 if obj.name.startswith('Ground | weathered marble') else 1
            modifier.levels = min(modifier.levels, limit)
            modifier.render_levels = min(modifier.render_levels, limit)
    obj.hide_set(False)
    obj.hide_render = False
    obj.hide_viewport = False

# glTF cannot carry Cycles noise/bump/volume node graphs. Export explicit physical
# constants with the original material names, then let runtime GLSL shade them.
materials = {material for obj in objects for material in obj.data.materials if material}
material_records = []
for material in sorted(materials, key=lambda item: item.name):
    shader = next((node for node in material.node_tree.nodes if node.type == 'BSDF_PRINCIPLED'), None) if material.use_nodes else None
    if not shader:
        continue
    values = {}
    for key in ['Base Color', 'Roughness', 'Metallic', 'Transmission Weight', 'IOR', 'Coat Weight', 'Coat Roughness', 'Emission Color', 'Emission Strength']:
        socket = shader.inputs.get(key)
        if socket:
            value = socket.default_value
            values[key] = list(value) if hasattr(value, '__len__') else float(value)
    for link in list(material.node_tree.links):
        # Keep COLOR_0 exports. These are portable geometry attributes, unlike
        # Cycles noise, volume, and bump graphs, and hold the garden's pink color.
        vertex_color = link.to_node == shader and link.to_socket.name == 'Base Color' and link.from_node.type == 'VERTEX_COLOR'
        if (link.to_node == shader and not vertex_color) or (link.to_node.type == 'OUTPUT_MATERIAL' and link.to_socket.name == 'Volume'):
            material.node_tree.links.remove(link)
    material_records.append({'name': material.name, 'principled': values, 'runtimeSurface': 'foliage' if material.get('runtime_surface') == 'foliage' else 'pearl' if 'pearl' in material.name or 'quartz' in material.name else 'marble' if 'limestone' in material.name else 'metal' if 'metal' in material.name else 'emissive' if 'seam light' in material.name else 'glass', 'vertexColorAttribute': material.get('vertex_color_attribute')})

camera = scene.camera
lighting = []
for obj in scene.objects:
    if obj.type != 'LIGHT':
        continue
    direction = obj.rotation_euler.to_quaternion() @ Vector((0, 0, -1))
    lighting.append({'name': obj.name, 'type': obj.data.type.lower(), 'position': list(obj.location), 'direction': list(direction), 'colorLinear': list(obj.data.color), 'blenderEnergy': obj.data.energy, 'size': getattr(obj.data, 'size', None)})

bpy.ops.object.select_all(action='DESELECT')
for obj in objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.context.view_layer.update()
result = bpy.ops.export_scene.gltf(filepath=str(OUTPUT / 'environment.glb'), export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_cameras=False, export_lights=False, export_animations=False, export_extras=True)
if result != {'FINISHED'}:
    raise RuntimeError('Environment GLB export failed')

# Read the exported glTF names/counts, not assumptions about modifier output.
with (OUTPUT / 'environment.glb').open('rb') as stream:
    stream.read(12)
    length, kind = struct.unpack('<II', stream.read(8))
    if kind != 0x4E4F534A:
        raise RuntimeError('Missing glTF JSON chunk')
    exported = json.loads(stream.read(length).rstrip(b' \x00'))
accessors = exported.get('accessors', [])
triangle_count = sum(accessors[primitive['indices']]['count'] // 3 for mesh in exported.get('meshes', []) for primitive in mesh['primitives'] if 'indices' in primitive)
vertex_count = sum(accessors[primitive['attributes']['POSITION']]['count'] for mesh in exported.get('meshes', []) for primitive in mesh['primitives'])
record = {
    'url': '/assets/hyper-atrium/environment.glb',
    'source': 'assets/blender/hyper-atrium/hyper-atrium.blend',
    'coordinates': {'source': 'Blender Z-up meters', 'glb': 'glTF Y-up meters', 'conversion': '[x, z, -y]', 'scale': 1},
    'camera': {'position': list(camera.location), 'target': [0, 2, 2.4], 'lens': camera.data.lens, 'sensorWidth': camera.data.sensor_width, 'near': 0.1, 'far': 300},
    'width': scene.render.resolution_x,
    'height': scene.render.resolution_y,
    'lighting': lighting,
    'sky': {'runtime': 'procedural sky dome and PMREM', 'horizonSRGB': [0.90, 0.85, 0.90], 'zenithSRGB': [0.57, 0.68, 0.88], 'sunElevationDegrees': 28, 'sunAzimuthDegrees': 130},
    'water': [
        {'id': 'atrium', 'sourceName': 'Water | flooded atrium', 'center': [0, 3.5, 0], 'size': [50, 63], 'depth': 0.42, 'amplitudeScale': 1, 'threeCenter': [0, 0, -3.5]},
        {'id': 'basin', 'sourceName': 'Water | central reflecting basin', 'center': [0, 0, 0.61], 'radius': 4.36, 'depth': 0.30, 'amplitudeScale': 0.68, 'threeCenter': [0, 0.61, 0]},
    ],
    'anchors': {'heroSphere': {'name': 'Hyper | floating pearl marble sphere', 'center': [0, 1.5, 3.1], 'radius': 1.45}, 'orbit': {'name': 'Hyper | delicate orbital ring', 'center': [0, 1.5, 3.07]}, 'basin': {'name': 'Hero pool | pale stone annular wall', 'center': [0, 0, 0.52], 'outerRadius': 4.9, 'innerRadius': 4.42, 'height': 0.57}},
    'materials': material_records,
    'objects': [{'name': obj.name, 'sourceType': obj.type, 'materials': [material.name for material in obj.data.materials if material]} for obj in objects],
    'excluded': {'stationRoots': [obj.name for obj in scene.objects if obj.name.startswith('Station | ') and obj.parent is None], 'surfaces': sorted(excluded_surfaces), 'decorativeTextRemoved': removed_text, 'typography': 'All non-station FONT objects and decorative rules are excluded. Station labels and icons are preserved in the original source/library.'},
    'stats': {'objects': len(exported.get('nodes', [])), 'meshes': len(exported.get('meshes', [])), 'primitives': sum(len(mesh['primitives']) for mesh in exported.get('meshes', [])), 'vertices': vertex_count, 'triangles': triangle_count, 'bytes': (OUTPUT / 'environment.glb').stat().st_size},
    'glbObjectNames': [node.get('name') for node in exported.get('nodes', [])],
}
(OUTPUT / 'environment.json').write_text(json.dumps(record, indent=2) + '\n')
print('ENVIRONMENT_EXPORT', json.dumps(record['stats']))
print('SOURCE_TEXT_REMOVED', len(removed_text))
print('SOURCE_TEMPLATE_ROOTS', len([obj for obj in scene.objects if obj.get('station_template')]))
