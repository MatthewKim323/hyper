"""Angular, porous ground limestone for the loaded Hyper scene.

Call apply(scene) after the composition/material passes. This module never
loads, saves, exports, or renders a file and only changes the named ground rocks.
"""
import hashlib
import math
import random

import bmesh
import bpy
from mathutils import Vector, noise


PREFIX = "Ground | weathered marble"
MATERIAL = "Ground | porous warm limestone"
COLOR_ATTRIBUTE = "RockMinerals"
SOURCE_KEY = "hyper_rock_original_mesh"
REVISION = "fractured-limestone-1"


def _linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def _rgba(rgb):
    return tuple(_linear(max(0, min(1, channel))) for channel in rgb) + (1.0,)


def _material():
    material = bpy.data.materials.get(MATERIAL) or bpy.data.materials.new(MATERIAL)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (1, 1, 1, 1)
    shader.inputs["Roughness"].default_value = 0.78
    shader.inputs["Specular IOR Level"].default_value = 0.24
    shader.inputs["Subsurface Weight"].default_value = 0.012
    shader.inputs["Subsurface Radius"].default_value = (0.04, 0.022, 0.012)
    shader.inputs["Coat Weight"].default_value = 0
    mineral = nodes.new("ShaderNodeVertexColor")
    mineral.layer_name = COLOR_ATTRIBUTE
    # Direct vertex color survives glTF export even when procedural bump is
    # replaced by the live material shader.
    links.new(mineral.outputs["Color"], shader.inputs["Base Color"])
    coordinates = nodes.new("ShaderNodeTexCoord")
    grain = nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 45
    grain.inputs["Detail"].default_value = 4
    grain.inputs["Roughness"].default_value = 0.78
    links.new(coordinates.outputs["Object"], grain.inputs["Vector"])
    grain_bump = nodes.new("ShaderNodeBump")
    grain_bump.inputs["Strength"].default_value = 0.42
    grain_bump.inputs["Distance"].default_value = 0.011
    links.new(grain.outputs["Fac"], grain_bump.inputs["Height"])

    # F1 cells produce actual concave pore normals, rather than shiny speckles.
    pores = nodes.new("ShaderNodeTexVoronoi")
    pores.distance = "EUCLIDEAN"
    pores.feature = "F1"
    pores.inputs["Scale"].default_value = 92
    links.new(coordinates.outputs["Object"], pores.inputs["Vector"])
    pore_profile = nodes.new("ShaderNodeMapRange")
    pore_profile.clamp = True
    pore_profile.inputs["From Min"].default_value = 0.055
    pore_profile.inputs["From Max"].default_value = 0.24
    links.new(pores.outputs["Distance"], pore_profile.inputs["Value"])
    pore_bump = nodes.new("ShaderNodeBump")
    pore_bump.inputs["Strength"].default_value = 0.55
    pore_bump.inputs["Distance"].default_value = 0.0065
    links.new(pore_profile.outputs["Result"], pore_bump.inputs["Height"])
    links.new(grain_bump.outputs["Normal"], pore_bump.inputs["Normal"])
    links.new(pore_bump.outputs["Normal"], shader.inputs["Normal"])
    roughness = nodes.new("ShaderNodeMapRange")
    roughness.inputs["From Min"].default_value = 0.1
    roughness.inputs["From Max"].default_value = 0.9
    roughness.inputs["To Min"].default_value = 0.62
    roughness.inputs["To Max"].default_value = 0.9
    links.new(grain.outputs["Fac"], roughness.inputs["Value"])
    links.new(roughness.outputs["Result"], shader.inputs["Roughness"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    material.diffuse_color = _rgba((0.87, 0.82, 0.77))
    material["runtime_surface"] = "marble"
    material["vertex_color_attribute"] = COLOR_ATTRIBUTE
    return material


def _original_mesh(obj):
    previous_name = obj.get(SOURCE_KEY)
    source = bpy.data.meshes.get(previous_name) if previous_name else None
    if source is None:
        # Archive the small, unsmoothed control cage so repeated applications
        # never erode an already displaced result.
        source = obj.data.copy()
        source.name = obj.name + " original fracture cage"
        source.use_fake_user = True
        obj[SOURCE_KEY] = source.name
    return source


def _bounds(mesh):
    low = Vector(tuple(min(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)))
    high = Vector(tuple(max(vertex.co[axis] for vertex in mesh.vertices) for axis in range(3)))
    return low, high


def _fracture_mesh(obj, material):
    source = _original_mesh(obj)
    low, high = _bounds(source)
    center = (low + high) * 0.5
    radius = max((high - low).length / math.sqrt(12), 0.03)
    seed = int.from_bytes(hashlib.sha256(obj.name.encode()).digest()[:8], "little")
    rng = random.Random(seed)
    offset = Vector(tuple(rng.uniform(-18, 18) for _ in range(3)))
    cavity_sites = []
    for _ in range(26):
        face = rng.choice(source.polygons)
        points = [source.vertices[index].co for index in face.vertices]
        point = sum(points, Vector()) / len(points)
        cavity_sites.append((point.copy(), radius * rng.uniform(0.055, 0.105), radius * rng.uniform(0.018, 0.05)))

    bm = bmesh.new()
    bm.from_mesh(source)
    # SIMPLE subdivision retains the existing broad fracture planes. Catmull
    # Clark was the reason these rocks became smooth beige domes.
    cuts = 7 if len(bm.faces) <= 120 else 3 if len(bm.faces) <= 500 else 1 if len(bm.faces) <= 2000 else 0
    if cuts:
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=cuts, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.normal_update()
    for vertex in bm.verts:
        point = vertex.co.copy()
        normal = vertex.normal.copy()
        normalized = (point - center) / radius
        broad = noise.fractal(normalized * 4.7 + offset, 1.0, 2.0, 3)
        grain = noise.noise(normalized * 17.0 + offset)
        erosion = radius * (0.022 * broad + 0.008 * grain)
        for site, width, depth in cavity_sites:
            distance = (point - site).length / width
            if distance < 1:
                erosion -= depth * (1 - distance * distance) ** 2
        vertex.co += normal * erosion
    bm.normal_update()
    for face in bm.faces:
        face.smooth = True
    for edge in bm.edges:
        # Split only real fracture ridges, while pore-scale triangles blend.
        edge.smooth = not edge.is_manifold or edge.calc_face_angle(0) < math.radians(38)
    output = bpy.data.meshes.new(obj.name + " fractured limestone")
    bm.to_mesh(output)
    bm.free()
    output.update()

    # Keep the existing local bounds and object transform exactly. This avoids
    # moving a rock off its original pedestal or changing water contact.
    output_low, output_high = _bounds(output)
    span = high - low
    output_span = output_high - output_low
    for vertex in output.vertices:
        for axis in range(3):
            if output_span[axis] > 0.000001:
                vertex.co[axis] = low[axis] + (vertex.co[axis] - output_low[axis]) * span[axis] / output_span[axis]
    attribute = output.color_attributes.new(name=COLOR_ATTRIBUTE, type="FLOAT_COLOR", domain="POINT")
    values = []
    for vertex in output.vertices:
        point = (vertex.co - center) / radius
        mineral = noise.fractal(point * 3.8 + offset, 1.0, 2.0, 3)
        fleck = noise.noise(point * 29 + offset)
        stain = max(0.0, noise.noise(point * 9 + offset) - 0.28)
        tone = 0.97 + 0.07 * mineral + 0.035 * fleck - 0.10 * stain
        rgb = tuple(value * tone for value in (0.875, 0.824, 0.775))
        values.extend(_rgba(rgb))
    attribute.data.foreach_set("color", values)
    output.color_attributes.active_color_index = len(output.color_attributes) - 1
    output.color_attributes.render_color_index = len(output.color_attributes) - 1
    output.materials.append(material)
    output["hyper_generated_ground_rock"] = True

    previous = obj.data
    obj.data = output
    if previous.get("hyper_generated_ground_rock") and previous.users == 0:
        bpy.data.meshes.remove(previous)
    output.name = obj.name + " fractured limestone"
    for modifier in list(obj.modifiers):
        if modifier.type in {"SUBSURF", "DISPLACE", "BEVEL", "WEIGHTED_NORMAL"}:
            obj.modifiers.remove(modifier)
    edge = obj.modifiers.new("Small weathered fracture edges", "BEVEL")
    edge.limit_method = "ANGLE"
    edge.angle_limit = math.radians(38)
    edge.width = min(0.007, radius * 0.012)
    edge.segments = 2
    edge.use_clamp_overlap = True
    obj["hyper_rock_finish"] = REVISION
    output.update()
    output.calc_loop_triangles()
    return {"name": obj.name, "vertices": len(output.vertices), "triangles": len(output.loop_triangles)}


def apply(scene=None):
    """Refine only Ground | weathered marble objects in the current scene."""
    scene = scene or bpy.context.scene
    objects = sorted((obj for obj in scene.objects if obj.type == "MESH" and obj.name.startswith(PREFIX)), key=lambda obj: obj.name)
    if not objects:
        return {"objects": [], "material": None, "triangles": 0}
    material = _material()
    records = [_fracture_mesh(obj, material) for obj in objects]
    return {"objects": records, "material": material.name, "triangles": sum(record["triangles"] for record in records)}
