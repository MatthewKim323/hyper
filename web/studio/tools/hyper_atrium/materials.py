"""Physically shaded ivory, glass, and shallow water for the Hyper atrium.

Water is an editable superposition of small, dispersive gravity waves. Geometry
Nodes evaluates the surface at scene time, and an evaluated mesh can be exported
to glTF. This is a calm water model rather than a baked liquid simulation.
"""

import json
import math

import bpy


def _linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def _color(rgb):
    return tuple(_linear(v) for v in rgb[:3]) + (rgb[3] if len(rgb) > 3 else 1.0,)


def _principled(name, color, roughness=0.3, metallic=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = _color(color)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    material.diffuse_color = _color(color)
    return material, shader


def _set(shader, key, value):
    socket = shader.inputs.get(key)
    if socket is not None:
        socket.default_value = value


def _noise(material, scale, detail=2.0, roughness=0.55):
    nodes = material.node_tree.nodes
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    noise.inputs["Roughness"].default_value = roughness
    coordinates = nodes.get("Surface coordinates")
    if coordinates is None:
        coordinates = nodes.new("ShaderNodeTexCoord")
        coordinates.name = "Surface coordinates"
    material.node_tree.links.new(coordinates.outputs["Object"], noise.inputs["Vector"])
    return noise


def _ramp(material, source, colors, positions=(0.2, 0.8)):
    ramp = material.node_tree.nodes.new("ShaderNodeValToRGB")
    for element, color, position in zip(ramp.color_ramp.elements, colors, positions):
        element.color = _color(color)
        element.position = position
    material.node_tree.links.new(source, ramp.inputs["Fac"])
    return ramp


def build_materials():
    """Create Cycles materials. Colors are specified as familiar sRGB swatches."""
    materials = {}

    stone, shader = _principled("Hyper | blush ivory honed limestone", (0.89, 0.79, 0.77), 0.34)
    _set(shader, "Subsurface Weight", 0.045)
    _set(shader, "Subsurface Radius", (0.3, 0.15, 0.075))
    broad = _noise(stone, 1.75, 3.5)
    broad.label = "Very subtle mineral clouding"
    color_ramp = _ramp(stone, broad.outputs["Fac"], ((0.84, 0.72, 0.70), (0.94, 0.86, 0.84)))
    stone.node_tree.links.new(color_ramp.outputs["Color"], shader.inputs["Base Color"])
    pores = _noise(stone, 165, 2)
    pores.label = "Fine pores, millimeter scale"
    bump = stone.node_tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.20
    bump.inputs["Distance"].default_value = 0.007
    stone.node_tree.links.new(pores.outputs["Fac"], bump.inputs["Height"])
    stone.node_tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    materials["stone"] = stone

    glass, shader = _principled("Hyper | clear rose optical glass", (0.995, 0.98, 0.972), 0.027)
    _set(shader, "Transmission Weight", 1.0)
    _set(shader, "IOR", 1.46)
    _set(shader, "Coat Weight", 0.12)
    _set(shader, "Coat Roughness", 0.045)
    glass["recommended_thickness_m"] = 0.055
    # A dilute absorption volume produces a gentle warm edge in thick sections.
    absorb = glass.node_tree.nodes.new("ShaderNodeVolumeAbsorption")
    absorb.inputs["Color"].default_value = _color((0.96, 0.82, 0.76))
    absorb.inputs["Density"].default_value = 0.018
    glass.node_tree.links.new(absorb.outputs["Volume"], glass.node_tree.nodes.get("Material Output").inputs["Volume"])
    materials["glass"] = glass

    pearl, shader = _principled("Hyper | luminous ivory pearl", (0.95, 0.90, 0.87), 0.20, 0.075)
    _set(shader, "Transmission Weight", 0.20)
    _set(shader, "IOR", 1.46)
    _set(shader, "Subsurface Weight", 0.14)
    _set(shader, "Subsurface Radius", (0.28, 0.19, 0.11))
    _set(shader, "Coat Weight", 0.48)
    _set(shader, "Coat Roughness", 0.09)
    _set(shader, "Thin Film Thickness", 330.0)
    _set(shader, "Thin Film IOR", 1.28)
    mineral = _noise(pearl, 3.5, 4.0)
    pearl_ramp = _ramp(pearl, mineral.outputs["Fac"], ((0.87, 0.82, 0.81), (0.97, 0.935, 0.91)), (0.12, 0.85))
    pearl.node_tree.links.new(pearl_ramp.outputs["Color"], shader.inputs["Base Color"])
    fleck = _noise(pearl, 65.0, 2)
    fleck_bump = pearl.node_tree.nodes.new("ShaderNodeBump")
    fleck_bump.inputs["Strength"].default_value = 0.095
    fleck_bump.inputs["Distance"].default_value = 0.004
    pearl.node_tree.links.new(fleck.outputs["Fac"], fleck_bump.inputs["Height"])
    pearl.node_tree.links.new(fleck_bump.outputs["Normal"], shader.inputs["Normal"])
    materials["pearl"] = pearl

    metal, shader = _principled("Hyper | pale champagne satin metal", (0.79, 0.73, 0.66), 0.19, 0.73)
    _set(shader, "Coat Weight", 0.3)
    materials["metal"] = metal

    text, shader = _principled("Hyper | warm graphite lettering", (0.34, 0.32, 0.305), 0.40)
    materials["text"] = text

    glow, shader = _principled("Hyper | warm ivory seam light", (1.0, 0.86, 0.72), 0.3)
    _set(shader, "Emission Color", _color((1.0, 0.87, 0.76)))
    _set(shader, "Emission Strength", 3.5)
    materials["glow"] = glow

    water, shader = _principled("Hyper | shallow clear reflective water", (0.965, 0.985, 1.0), 0.045)
    _set(shader, "Transmission Weight", 1.0)
    _set(shader, "IOR", 1.333)
    # Real geometry carries the broad waves. This normal only supplies the fine
    # capillary detail between them, so reflection silhouettes remain coherent.
    capillary = _noise(water, 9.0, 2.0, 0.45)
    micro = water.node_tree.nodes.new("ShaderNodeBump")
    micro.inputs["Strength"].default_value = 0.13
    micro.inputs["Distance"].default_value = 0.008
    water.node_tree.links.new(capillary.outputs["Fac"], micro.inputs["Height"])
    water.node_tree.links.new(micro.outputs["Normal"], shader.inputs["Normal"])
    water["ior"] = 1.333
    materials["water"] = water

    floor, shader = _principled("Hyper | submerged pale lavender limestone", (0.77, 0.75, 0.76), 0.4)
    floor_noise = _noise(floor, 1.7, 3.5)
    floor_ramp = _ramp(floor, floor_noise.outputs["Fac"], ((0.72, 0.70, 0.73), (0.86, 0.82, 0.82)))
    floor.node_tree.links.new(floor_ramp.outputs["Color"], shader.inputs["Base Color"])
    materials["pool_floor"] = floor

    opal, shader = _principled("Hyper | softly luminous document opal", (0.965, 0.91, 0.955), 0.18)
    _set(shader, "Transmission Weight", 0.30)
    _set(shader, "Subsurface Weight", 0.08)
    _set(shader, "Coat Weight", 0.4)
    _set(shader, "Emission Color", _color((0.93, 0.81, 0.94)))
    _set(shader, "Emission Strength", 0.12)
    materials["opal"] = opal
    return materials


# Amplitude, wavelength, propagation angle, phase. All scene distances are meters.
WAVES = (
    (0.0060, 3.80, 0.22, 0.50),
    (0.0050, 2.35, 1.12, 1.80),
    (0.0040, 1.55, -0.64, 3.25),
    (0.0045, 1.10, 0.55, 4.40),
    (0.0040, 0.79, 1.94, 0.85),
    (0.0040, 0.63, -1.36, 2.60),
    (0.0030, 0.51, 2.80, 4.00),
    (0.0024, 0.43, 0.14, 5.10),
)


def _wave_height(x, y, seconds=0.0, depth=0.42, amplitude_scale=1.0):
    height = 0.0
    for amplitude, wavelength, angle, phase in WAVES:
        k = 2 * math.pi / wavelength
        omega = math.sqrt(9.81 * k * math.tanh(k * depth))
        height += amplitude * math.sin(k * (math.cos(angle) * x + math.sin(angle) * y) - omega * seconds + phase)
    return height * amplitude_scale


def _mesh(name, vertices, faces, material, collection):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    for polygon in data.polygons:
        polygon.use_smooth = True
    return obj


def _math_node(nodes, links, operation, first, second=None):
    node = nodes.new("ShaderNodeMath")
    node.operation = operation
    for index, value in enumerate((first, second)):
        if value is None:
            continue
        if isinstance(value, (int, float)):
            node.inputs[index].default_value = value
        else:
            links.new(value, node.inputs[index])
    return node.outputs[0]


def _animate_waves(obj, depth, amplitude_scale):
    """Evaluate the same analytical wave spectrum over Blender's scene time."""
    group = bpy.data.node_groups.new(obj.name + " | dispersive wave motion", "GeometryNodeTree")
    group.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nodes, links = group.nodes, group.links
    source = nodes.new("NodeGroupInput")
    target = nodes.new("NodeGroupOutput")
    source.location = (-1100, 0)
    target.location = (1000, 0)
    position = nodes.new("GeometryNodeInputPosition")
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(position.outputs["Position"], split.inputs[0])
    clock = nodes.new("GeometryNodeInputSceneTime")
    total = 0.0
    for amplitude, wavelength, angle, phase in WAVES:
        k = 2 * math.pi / wavelength
        omega = math.sqrt(9.81 * k * math.tanh(k * depth))
        xx = _math_node(nodes, links, "MULTIPLY", split.outputs["X"], k * math.cos(angle))
        yy = _math_node(nodes, links, "MULTIPLY", split.outputs["Y"], k * math.sin(angle))
        distance = _math_node(nodes, links, "ADD", xx, yy)
        travel = _math_node(nodes, links, "MULTIPLY", clock.outputs["Seconds"], -omega)
        phase_value = _math_node(nodes, links, "ADD", _math_node(nodes, links, "ADD", distance, travel), phase)
        wave = _math_node(nodes, links, "MULTIPLY", _math_node(nodes, links, "SINE", phase_value), amplitude * amplitude_scale)
        total = _math_node(nodes, links, "ADD", total, wave)
    combined = nodes.new("ShaderNodeCombineXYZ")
    links.new(split.outputs["X"], combined.inputs["X"])
    links.new(split.outputs["Y"], combined.inputs["Y"])
    links.new(total, combined.inputs["Z"])
    set_position = nodes.new("GeometryNodeSetPosition")
    set_position.location = (760, 0)
    links.new(source.outputs["Geometry"], set_position.inputs["Geometry"])
    links.new(combined.outputs["Vector"], set_position.inputs["Position"])
    links.new(set_position.outputs["Geometry"], target.inputs["Geometry"])
    modifier = obj.modifiers.new("Calm shallow water | animated wave spectrum", "NODES")
    modifier.node_group = group
    obj["wave_model"] = "linear gravity waves; omega^2 = g*k*tanh(k*depth)"
    obj["water_depth_m"] = depth
    obj["wave_amplitude_scale"] = amplitude_scale
    obj["wave_spectrum_json"] = json.dumps(WAVES)
    obj["glb_export"] = "Export evaluated geometry; regenerate this spectrum in the runtime water shader."


def build_water(materials):
    """Build animated reflective floor water and the inset central basin surface.

    Returns the named objects for easy render visibility and later GLB export.
    No changes to the camera, render engine, world, or scene frame are made.
    """
    collection = bpy.data.collections.new("Hyper | shallow water")
    bpy.context.scene.collection.children.link(collection)
    nx, ny = 320, 404
    vertices = []
    for row in range(ny + 1):
        y = -28 + 63 * row / ny
        for column in range(nx + 1):
            x = -25 + 50 * column / nx
            vertices.append((x, y, _wave_height(x, y)))
    faces = []
    for row in range(ny):
        for column in range(nx):
            a = row * (nx + 1) + column
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    surface = _mesh("Water | flooded atrium", vertices, faces, materials["water"], collection)
    _animate_waves(surface, 0.42, 1.0)

    floor = _mesh("Water | submerged limestone floor", [(-25, -28, -0.42), (25, -28, -0.42), (25, 35, -0.42), (-25, 35, -0.42)], [(0, 1, 2, 3)], materials["pool_floor"], collection)

    radius, rings, segments = 4.36, 56, 192
    pool_vertices = [(0, 0, _wave_height(0, 0, depth=0.30, amplitude_scale=0.68))]
    pool_faces = []
    for ring in range(1, rings + 1):
        r = radius * ring / rings
        for segment in range(segments):
            angle = 2 * math.pi * segment / segments
            x, y = r * math.cos(angle), r * math.sin(angle)
            pool_vertices.append((x, y, _wave_height(x, y, depth=0.30, amplitude_scale=0.68)))
    for segment in range(segments):
        pool_faces.append((0, 1 + segment, 1 + (segment + 1) % segments))
    for ring in range(rings - 1):
        a = 1 + ring * segments
        b = a + segments
        for segment in range(segments):
            nxt = (segment + 1) % segments
            pool_faces.append((a + segment, b + segment, b + nxt, a + nxt))
    basin = _mesh("Water | central reflecting basin", pool_vertices, pool_faces, materials["water"], collection)
    basin.location.z = 0.61
    _animate_waves(basin, 0.30, 0.68)

    floor_vertices = [(radius * math.cos(2 * math.pi * i / segments), radius * math.sin(2 * math.pi * i / segments), 0.30) for i in range(segments)]
    basin_floor = _mesh("Water | central basin floor", floor_vertices, [tuple(range(segments))], materials["pool_floor"], collection)
    return {"surface": surface, "floor": floor, "basin": basin, "basin_floor": basin_floor}
