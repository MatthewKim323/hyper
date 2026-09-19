"""Refine the saved atrium's physical materials and lighting in memory.

Call apply(bpy.context.scene) after architecture and landscape changes. This
module never loads, saves, exports, or renders a file. Units are meters.
"""
import math

import bpy
from mathutils import Vector


def _linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def _rgba(rgb):
    return tuple(_linear(v) for v in rgb) + (1,)


def _material(name, rgb, roughness):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = _rgba(rgb)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = _rgba(rgb)
    shader.inputs["Roughness"].default_value = roughness
    links.new(shader.outputs[0], output.inputs["Surface"])
    return material, shader, output


def _noise(material, scale, source=None, detail=3):
    node = material.node_tree.nodes.new("ShaderNodeTexNoise")
    node.inputs["Scale"].default_value = scale
    node.inputs["Detail"].default_value = detail
    node.inputs["Roughness"].default_value = 0.64
    if source:
        material.node_tree.links.new(source, node.inputs["Vector"])
    return node


def _range(material, source, start, end, low, high):
    node = material.node_tree.nodes.new("ShaderNodeMapRange")
    node.clamp = True
    node.interpolation_type = "SMOOTHERSTEP"
    for key, value in (("From Min", start), ("From Max", end), ("To Min", low), ("To Max", high)):
        node.inputs[key].default_value = value
    material.node_tree.links.new(source, node.inputs["Value"])
    return node.outputs["Result"]


def _math(material, operation, a, b):
    node = material.node_tree.nodes.new("ShaderNodeMath")
    node.operation = operation
    for index, value in enumerate((a, b)):
        if isinstance(value, (int, float)):
            node.inputs[index].default_value = value
        else:
            material.node_tree.links.new(value, node.inputs[index])
    return node.outputs[0]


def _ramp(material, source, colors, positions=(0.18, 0.82)):
    node = material.node_tree.nodes.new("ShaderNodeValToRGB")
    for element, rgb, position in zip(node.color_ramp.elements, colors, positions):
        element.color = _rgba(rgb)
        element.position = position
    material.node_tree.links.new(source, node.inputs["Fac"])
    return node.outputs["Color"]


def _coords(material, generated=False):
    nodes = material.node_tree.nodes
    coordinates = nodes.new("ShaderNodeTexCoord" if generated else "ShaderNodeNewGeometry")
    source = coordinates.outputs["Generated" if generated else "Position"]
    split = nodes.new("ShaderNodeSeparateXYZ")
    material.node_tree.links.new(source, split.inputs[0])
    return source, split


def _stone():
    material, shader, _ = _material("Hyper | blush ivory honed limestone", (0.875, 0.775, 0.735), 0.46)
    links, nodes = material.node_tree.links, material.node_tree.nodes
    position, _ = _coords(material)
    mineral = _noise(material, 0.9, position, 4)
    links.new(_ramp(material, mineral.outputs["Fac"], ((0.825, 0.70, 0.66), (0.925, 0.835, 0.79))), shader.inputs["Base Color"])
    pores = _noise(material, 165, position, 2)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = 0.0055
    links.new(pores.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(_range(material, pores.outputs["Fac"], 0.1, 0.9, 0.37, 0.53), shader.inputs["Roughness"])
    shader.inputs["Subsurface Weight"].default_value = 0.025
    shader.inputs["Subsurface Radius"].default_value = (0.085, 0.045, 0.025)
    shader.inputs["Coat Weight"].default_value = 0
    return material


def _pearl():
    material, shader, output = _material("Hero | graduated rose quartz and pearl", (0.97, 0.90, 0.865), 0.23)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    position, split = _coords(material, generated=True)
    height = split.outputs["Z"]
    cloud = _noise(material, 4.2, position, 4)
    links.new(_ramp(material, cloud.outputs["Fac"], ((0.87, 0.76, 0.73), (0.985, 0.935, 0.90)), (0.14, 0.88)), shader.inputs["Base Color"])
    links.new(_range(material, height, 0.08, 0.87, 0.70, 0.10), shader.inputs["Transmission Weight"])
    links.new(_range(material, height, 0.12, 0.78, 0.165, 0.285), shader.inputs["Roughness"])
    links.new(_range(material, height, 0.08, 0.82, 0.065, 0.24), shader.inputs["Subsurface Weight"])
    shader.inputs["Subsurface Radius"].default_value = (0.32, 0.20, 0.14)
    shader.inputs["Metallic"].default_value = 0
    shader.inputs["IOR"].default_value = 1.46
    shader.inputs["Coat Weight"].default_value = 0.22
    shader.inputs["Coat Roughness"].default_value = 0.17
    pores = _noise(material, 72, position, 2)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.065
    bump.inputs["Distance"].default_value = 0.003
    links.new(pores.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    # The solid sphere has actual scattering depth instead of a polished clear
    # lower shell that reproduces a rectangular studio light as a mirror image.
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Color"].default_value = _rgba((0.98, 0.87, 0.82))
    volume.inputs["Anisotropy"].default_value = 0.12
    links.new(_range(material, cloud.outputs["Fac"], 0.23, 0.78, 0.035, 0.20), volume.inputs["Density"])
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    return material


def _glass():
    material, shader, output = _material("Portals | optically clear rose crystal", (0.993, 0.974, 0.965), 0.035)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    _, split = _coords(material, generated=True)
    height = split.outputs["Z"]
    shader.inputs["IOR"].default_value = 1.46
    shader.inputs["Coat Weight"].default_value = 0.16
    shader.inputs["Coat Roughness"].default_value = 0.045
    links.new(_range(material, height, 0.0, 0.4, 0.83, 0.985), shader.inputs["Transmission Weight"])
    links.new(_range(material, height, 0.02, 0.42, 0.095, 0.028), shader.inputs["Roughness"])
    # Dilute pink absorption is visible along the edge and fades through the face.
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Color"].default_value = _rgba((0.99, 0.86, 0.82))
    volume.inputs["Anisotropy"].default_value = 0.15
    links.new(_range(material, height, 0.0, 0.5, 0.24, 0.025), volume.inputs["Density"])
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    edge, edge_shader, _ = _material("Portals | polished clear edge", (0.995, 0.98, 0.965), 0.043)
    edge_shader.inputs["Transmission Weight"].default_value = 1
    edge_shader.inputs["IOR"].default_value = 1.46
    edge_shader.inputs["Metallic"].default_value = 0
    edge_shader.inputs["Coat Weight"].default_value = 0.12
    return material, edge


def _light(scene, name, kind, location, energy, color, direction=None, size=1):
    obj = scene.objects.get(name)
    if obj is None:
        data = bpy.data.lights.new(name, kind)
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
    obj.data.type = kind
    obj.location = location
    obj.data.energy = energy
    obj.data.color = color
    if kind == "AREA":
        obj.data.shape = "DISK"
        obj.data.size = size
    elif kind == "POINT":
        obj.data.shadow_soft_size = size
    if direction is not None:
        obj.rotation_euler = Vector(direction).to_track_quat("-Z", "Y").to_euler()
    return obj


def _bounds(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (Vector(tuple(min(p[axis] for p in corners) for axis in range(3))),
            Vector(tuple(max(p[axis] for p in corners) for axis in range(3))))


def _room(scene):
    wall = scene.objects.get("Atrium | monolithic blush limestone")
    if wall:
        low, high = _bounds(wall)
        sx = (high.x - low.x) / 34
        sz = (high.z - low.z) / 16.5
        z_offset = low.z + 0.55 * sz
        center_x = (low.x + high.x) * 0.5
        rear = high.y
    else:
        sx, sz, center_x, rear, z_offset = 1, 1, 0, 8.5, 0
    front = scene.camera.location.y + 12 if scene.camera else -9
    return {"sx": sx, "sz": sz, "x": center_x, "z_offset": z_offset, "rear": rear,
            "front": front, "half_width": 17 * sx, "height": max(4, 14 * sz + z_offset)}


def _haze(scene, room):
    material = bpy.data.materials.get("Air | fine sunlit haze") or bpy.data.materials.new("Air | fine sunlit haze")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    position, split = _coords(material)
    depth = room["rear"] + 2 - room["front"]
    optical_scale = min(1.5, 19 / depth)
    density_noise = _noise(material, 0.32 / room["sx"], position, 2)
    density = _range(material, density_noise.outputs["Fac"], 0, 1, 0.006 * optical_scale, 0.011 * optical_scale)
    density = _math(material, "MULTIPLY", density, _range(material, split.outputs["Y"], room["front"], room["front"] + 8, 0, 1))
    density = _math(material, "MULTIPLY", density, _range(material, split.outputs["Y"], room["rear"], room["rear"] + 2, 1, 0))
    density = _math(material, "MULTIPLY", density, _range(material, split.outputs["Z"], 0.1, 1.2, 0, 1))
    density = _math(material, "MULTIPLY", density, _range(material, split.outputs["Z"], room["height"] - 1.5, room["height"], 1, 0))
    centered_x = _math(material, "SUBTRACT", split.outputs["X"], room["x"])
    absolute_x = _math(material, "ABSOLUTE", centered_x, 0)
    density = _math(material, "MULTIPLY", density, _range(material, absolute_x, room["half_width"] - 2, room["half_width"], 1, 0))
    volume = nodes.new("ShaderNodeVolumePrincipled")
    volume.inputs["Color"].default_value = (0.97, 0.93, 0.90, 1)
    volume.inputs["Anisotropy"].default_value = 0.52
    links.new(density, volume.inputs["Density"])
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(volume.outputs["Volume"], output.inputs["Volume"])
    box = scene.objects.get("Atmosphere | atrium air")
    if box is None:
        bpy.ops.mesh.primitive_cube_add(size=1)
        box = bpy.context.object
        box.name = "Atmosphere | atrium air"
    box.location = (room["x"], room["front"] + depth / 2, room["height"] / 2)
    box.dimensions = (room["half_width"] * 2, depth, room["height"])
    box.data.materials.clear()
    box.data.materials.append(material)


def apply(scene):
    """Apply material and light refinements without saving or rendering."""
    bpy.context.view_layer.update()
    room = _room(scene)
    _stone()
    _pearl()
    _glass()
    _haze(scene, room)
    # This path passes through the right arch onto the pearl and central pool.
    direction = Vector((-12, -25, -11.5)).normalized()
    sx, sz, rear, z_offset = room["sx"], room["sz"], room["rear"], room["z_offset"]
    window_power = ((rear + 5) / 13.5) ** 2
    sun = _light(scene, "Light | sun shadows", "SUN", (room["x"] + 12 * sx, rear + 10, 15 * sz + z_offset), 3.1, (1, 0.84, 0.75), direction)
    sun.data.angle = math.radians(0.85)
    _light(scene, "Light | warm diagonal sun", "AREA", (room["x"] + 7.5 * sx, rear + 1.5, 11 * sz + z_offset), 2200 * window_power, (1, 0.83, 0.74), direction, 1.4 * sx)
    _light(scene, "Light | broad ivory sky fill", "AREA", (0, -8, 10), 1400, (1, 0.61, 0.48), (0, 10, -8), 14)
    _light(scene, "Fidelity | warm side aperture", "AREA", (room["half_width"], -5, 18), 4500, (1, 0.71, 0.60), (-30, 28, -12), 5)
    # Discs give soft window illumination without rectangular highlights inside
    # the pearl. All sources remain behind the actual carved rear wall.
    for name, location, target, power, color, size in (
        ("Light | central window", (room["x"], rear + 0.7, 8.2 * sz + z_offset), (0, -4, 1), 850, (1, 0.92, 0.89), 4.3),
        ("Light | left lavender window", (room["x"] - 7.1 * sx, rear + 0.7, 6 * sz + z_offset), (-4, -3, 2), 560, (0.86, 0.89, 1), 2.8),
        ("Light | right pearl window", (room["x"] + 7.1 * sx, rear + 0.7, 6 * sz + z_offset), (4, -3, 2), 750, (1, 0.88, 0.83), 2.8),
    ):
        _light(scene, name, "AREA", location, power * window_power, color, Vector(target) - Vector(location), size * sx)
    pearl = scene.objects.get("Hyper | floating pearl marble sphere")
    if pearl:
        low, high = _bounds(pearl)
        center = (low + high) * 0.5
        inner_light = (center.x, center.y, low.z + (high.z - low.z) * 0.105)
    else:
        inner_light = (0, 1.5, 1.98)
    _light(scene, "Fidelity | pearl inner illumination", "POINT", inner_light, 24, (1, 0.87, 0.80), size=0.26)
    for obj in tuple(scene.objects):
        if obj.type != "MESH" or obj.hide_render or "solid clear arched crystal" not in obj.name:
            continue
        if obj.users_collection and all(collection.hide_render for collection in obj.users_collection):
            continue
        low, high = _bounds(obj)
        center = (low + high) * 0.5
        label = obj.name.split(" | ")[0]
        _light(scene, "Fidelity | portal uplight " + label, "AREA", (center.x, center.y, low.z + 0.012), 42, (1, 0.88, 0.80), (0, 0, 1), (high.x - low.x) * 0.66)
    glow = bpy.data.materials.get("Hyper | warm ivory seam light")
    if glow and glow.use_nodes:
        for node in glow.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                node.inputs["Emission Color"].default_value = (1, 0.83, 0.70, 1)
                node.inputs["Emission Strength"].default_value = 6.5
    if scene.world and scene.world.use_nodes:
        for node in scene.world.node_tree.nodes:
            if node.type == "TEX_SKY":
                node.sun_elevation = math.atan2(-direction.z, math.hypot(direction.x, direction.y))
                node.sun_rotation = math.atan2(-direction.y, -direction.x)
                node.sun_disc = False
            elif node.type == "BACKGROUND":
                # Preserve the existing procedural cloud environment and its
                # separate camera/reflection background, with calmer fill light.
                node.inputs["Strength"].default_value = 0.35 if node.inputs["Strength"].default_value < 1 else 3.2
    scene.cycles.volume_bounces = max(scene.cycles.volume_bounces, 3)
    scene.cycles.transmission_bounces = max(scene.cycles.transmission_bounces, 10)
    scene.view_settings.exposure = -0.9
    scene["hyper_material_fidelity"] = "2026-09-19: bounded sunlit air; dielectric cloudy pearl; physical base-lit rose glass"
    return {"materials": 4, "direction": tuple(direction), "room": room, "volume": "Atmosphere | atrium air"}
