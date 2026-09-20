"""Editable hero, uncovered relic stations, and stone basin for the Hyper atrium.

The build entry point adds objects to the active scene without changing the camera,
world, render settings, water, or existing architecture. All dimensions are meters.
"""

import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


COLLECTION_NAME = "Hyper | Hero and glass portals"
FONT = None


def is_station_cover(obj):
    return bool(obj.get("station_cover_reference")) or any(
        part in obj.name for part in (" | solid clear arched crystal", " | front polished rim")
    )


def hide_station_covers(scene):
    """Retain aperture measurement guides without showing or exporting covers."""
    covers = [obj for obj in scene.objects if is_station_cover(obj)]
    for obj in covers:
        obj["station_cover_reference"] = True
        obj.hide_render = True
        obj.hide_viewport = True
    scene["station_display"] = "Uncovered relics and plinths; glass aperture guides are hidden."
    return len(covers)


def illuminate_relic_materials(materials):
    """Give icon-only opal and lettering a restrained inner illumination."""
    for key, strength in (("paper", 0.22), ("white", 0.10)):
        material = materials[key]
        if not material.use_nodes:
            continue
        for shader in material.node_tree.nodes:
            if shader.type == "BSDF_PRINCIPLED":
                shader.inputs["Emission Color"].default_value = (0.98, 0.84, 0.72, 1)
                shader.inputs["Emission Strength"].default_value = strength


def _collection():
    collection = bpy.data.collections.get(COLLECTION_NAME)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION_NAME)
        bpy.context.scene.collection.children.link(collection)
    return collection


def _own(obj, material=None):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    _collection().objects.link(obj)
    if material is not None:
        obj.data.materials.append(material)
    return obj


def _mesh(name, vertices, faces, material):
    data = bpy.data.meshes.new(name + " geometry")
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    _collection().objects.link(obj)
    obj.data.materials.append(material)
    return obj


def _bevel(obj, width=0.035, segments=3):
    modifier = obj.modifiers.new("Soft manufactured edges", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    return modifier


def _smooth(obj):
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def _box(name, location, dimensions, material, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = _own(bpy.context.object, material)
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        _bevel(obj, bevel, 4)
    return obj


def _cylinder(name, location, radius, depth, material, bevel=0.03):
    bpy.ops.mesh.primitive_cylinder_add(vertices=160, radius=radius, depth=depth, location=location)
    obj = _own(bpy.context.object, material)
    obj.name = name
    _bevel(obj, bevel, 3)
    for polygon in obj.data.polygons:
        polygon.use_smooth = len(polygon.vertices) == 4
    return obj


def _curve(name, points, material, thickness=0.012, closed=False):
    data = bpy.data.curves.new(name + " path", "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 2
    data.bevel_depth = thickness
    data.bevel_resolution = 3
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coordinate in zip(spline.points, points):
        point.co = (*coordinate, 1)
    spline.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, data)
    _collection().objects.link(obj)
    data.materials.append(material)
    return obj


def _font():
    global FONT
    if FONT is None:
        for candidate in ["/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
            if Path(candidate).exists():
                FONT = bpy.data.fonts.load(candidate, check_existing=True)
                break
    return FONT


def _text(name, body, location, size, material, spacing=1.0):
    data = bpy.data.curves.new(name + " lettering", "FONT")
    data.body = body
    data.align_x = "CENTER"
    data.align_y = "CENTER"
    data.size = size
    data.space_character = spacing
    data.space_line = 0.96
    data.extrude = 0.0008
    data.resolution_u = 8
    font = _font()
    if font:
        data.font = font
    obj = bpy.data.objects.new(name, data)
    _collection().objects.link(obj)
    obj.location = location
    obj.rotation_euler = (math.pi / 2, 0, 0)
    data.materials.append(material)
    return obj


def _principled(name, color, roughness=0.25, transmission=0, metallic=0, ior=1.45):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["IOR"].default_value = ior
    shader.inputs["Transmission Weight"].default_value = transmission
    shader.inputs["Coat Weight"].default_value = 0.3
    return material


def _gradient_pearl():
    material = _principled("Hero | graduated rose quartz and pearl", (0.93, 0.83, 0.78), 0.19, 0.42, 0.04)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get("Principled BSDF")
    shader.inputs["Coat Roughness"].default_value = 0.15
    tex = nodes.new("ShaderNodeTexCoord")
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(tex.outputs["Generated"], split.inputs[0])
    transmit = nodes.new("ShaderNodeMapRange")
    transmit.inputs["From Min"].default_value = 0.15
    transmit.inputs["From Max"].default_value = 0.65
    transmit.inputs["To Min"].default_value = 0.90
    transmit.inputs["To Max"].default_value = 0.22
    transmit.clamp = True
    links.new(split.outputs["Z"], transmit.inputs["Value"])
    links.new(transmit.outputs["Result"], shader.inputs["Transmission Weight"])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 8.5
    noise.inputs["Detail"].default_value = 5
    noise.inputs["Roughness"].default_value = 0.75
    links.new(tex.outputs["Generated"], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.22
    ramp.color_ramp.elements[0].color = (0.62, 0.48, 0.43, 1)
    ramp.color_ramp.elements[1].position = 0.76
    ramp.color_ramp.elements[1].color = (0.98, 0.88, 0.83, 1)
    links.new(noise.outputs["Fac"], ramp.inputs[0])
    links.new(ramp.outputs[0], shader.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.10
    bump.inputs["Distance"].default_value = 0.007
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs[0], shader.inputs["Normal"])
    return material


def _portal_material():
    material = _principled("Portals | optically clear rose crystal", (0.985, 0.947, 0.934), 0.055, 1.0, 0.0, 1.43)
    return material


def _arch(name, x, y, base, width, height, depth, material):
    radius = width / 2
    shoulder = height - radius
    outline = [(-radius, 0), (radius, 0), (radius, shoulder)]
    outline += [(radius * math.cos(math.pi * i / 64), shoulder + radius * math.sin(math.pi * i / 64)) for i in range(1, 65)]
    count = len(outline)
    vertices = [(x + px, y + sy * depth / 2, base + pz) for sy in (-1, 1) for px, pz in outline]
    faces = [tuple(range(count)), tuple(reversed(range(count, count * 2)))]
    faces += [(i + count, (i + 1) % count + count, (i + 1) % count, i) for i in range(count)]
    obj = _mesh(name, vertices, faces, material)
    _bevel(obj, 0.045, 5)
    return obj


def _arch_edge(name, x, y, base, width, height, material):
    radius = width / 2
    shoulder = height - radius
    points = [(x - radius, y, base), (x - radius, y, base + shoulder)]
    points += [(x + radius * math.cos(math.pi - math.pi * i / 96), y, base + shoulder + radius * math.sin(math.pi - math.pi * i / 96)) for i in range(1, 97)]
    points += [(x + radius, y, base)]
    return _curve(name, points, material, thickness=0.012)


def _annulus(name, center, outer, inner, height, material, bevel=0.025):
    count = 256
    x, y, z = center
    vertices = []
    for zz, radius in [(z - height / 2, outer), (z + height / 2, outer), (z + height / 2, inner), (z - height / 2, inner)]:
        vertices += [(x + radius * math.cos(i * math.tau / count), y + radius * math.sin(i * math.tau / count), zz) for i in range(count)]
    faces = []
    for side in range(4):
        next_side = (side + 1) % 4
        for i in range(count):
            nxt = (i + 1) % count
            faces.append((side * count + i, side * count + nxt, next_side * count + nxt, next_side * count + i))
    obj = _mesh(name, vertices, faces, material)
    _bevel(obj, bevel, 3)
    for polygon in obj.data.polygons:
        # Only the cylindrical inner and outer walls have smooth normals.
        polygon.use_smooth = polygon.index // count in (0, 2)
    return obj


def refine_station_light_seams(scene):
    """Replace exposed light plates with narrow crown inlays, without saving."""
    changed = []
    for obj in tuple(scene.objects):
        if obj.type != "MESH" or not obj.name.endswith(" | concealed warm light seam"):
            continue
        if obj.get("station_light_geometry") == "annular-inlay-v1":
            continue
        crown = scene.objects.get(obj.name.replace(" | concealed warm light seam", " | upper porcelain plinth"))
        if crown is None or not obj.data.materials:
            continue
        radius = max(math.hypot(vertex.co.x, vertex.co.y) for vertex in crown.data.vertices)
        outer = radius * 0.97
        ring = _annulus(obj.name + " replacement", (0, 0, 0), outer, outer - 0.020,
                        0.015, obj.data.materials[0], bevel=0.002)
        original = obj.data
        obj.data = ring.data
        bpy.data.objects.remove(ring, do_unlink=True)
        if original.users == 0:
            bpy.data.meshes.remove(original)
        for modifier in tuple(obj.modifiers):
            if modifier.type == "BEVEL":
                obj.modifiers.remove(modifier)
        _bevel(obj, 0.002, 3)
        # The diffuser is seated into the crown; only its upper 5 mm are exposed.
        obj.location.z = crown.location.z + max(vertex.co.z for vertex in crown.data.vertices) - 0.0025
        obj["station_light_geometry"] = "annular-inlay-v1"
        obj["station_light_width_m"] = 0.020
        changed.append(obj.name)
    pole = scene.objects.get("Hyper | floating pearl light at lower pole")
    if pole:
        pole.hide_render = True
        pole.hide_viewport = True
        pole.visible_glossy = False
        pole["lighting_reference_only"] = True
    return {"station_inlays": changed, "pearl_disc_hidden": pole is not None}


def soften_pearl_inner_light(scene):
    """Keep a broad, quiet inner glow without a bright source at the lower pole."""
    pearl = scene.objects.get("Hyper | floating pearl marble sphere")
    light = scene.objects.get("Fidelity | pearl inner illumination")
    if pearl is None or light is None or light.type != "LIGHT" or light.data.type != "POINT":
        return {"changed": False, "reason": "Pearl or existing inner point light is missing"}
    bpy.context.view_layer.update()
    corners = [pearl.matrix_world @ Vector(corner) for corner in pearl.bound_box]
    low = Vector(tuple(min(point[axis] for point in corners) for axis in range(3)))
    high = Vector(tuple(max(point[axis] for point in corners) for axis in range(3)))
    position = (low + high) * 0.5
    position.z = low.z + (high.z - low.z) * 0.23
    previous = {"watts": light.data.energy, "radius": light.data.shadow_soft_size,
                "position": list(light.matrix_world.translation)}
    changed = (abs(light.data.energy - 6.0) > 1e-6 or
               abs(light.data.shadow_soft_size - 0.5) > 1e-6 or
               (light.matrix_world.translation - position).length > 1e-6)
    matrix = light.matrix_world.copy()
    matrix.translation = position
    light.matrix_world = matrix
    light.data.energy = 6.0
    light.data.shadow_soft_size = 0.5
    return {"changed": changed, "previous": previous,
            "watts": 6.0, "radius": 0.5, "position": list(position), "height_fraction": 0.23}


def _arrow(name, x, y, z, material, radius=0.14):
    points = [(x + radius * math.cos(i * math.tau / 64), y, z + radius * math.sin(i * math.tau / 64)) for i in range(64)]
    _curve(name + " circle", points, material, 0.005, True)
    _curve(name + " arrow", [(x - radius * 0.37, y - 0.001, z), (x + radius * 0.36, y - 0.001, z)], material, 0.006)
    _curve(name + " arrowhead", [(x + radius * 0.06, y - 0.001, z + radius * 0.26), (x + radius * 0.37, y - 0.001, z), (x + radius * 0.06, y - 0.001, z - radius * 0.26)], material, 0.006)


def _document_icon(x, y, z, materials, invoice=False):
    paper = materials["paper"]
    if invoice:
        for i in range(3):
            _box("Accounts payable | glass card " + str(i + 1), (x - i * 0.10, y + i * 0.06, z + i * 0.055), (1.28, 0.048, 1.0), paper, 0.055)
        widths = (0.80, 0.74, 0.81, 0.35)
        for i, width in enumerate(widths):
            _box("Accounts payable | document line " + str(i), (x - 0.39 + width / 2, y - 0.036, z + 0.12 - i * 0.13), (width, 0.009, 0.023), materials["white"], 0.004)
    else:
        for i in range(3):
            xx, yy, zz = x - 0.15 + i * 0.105, y - i * 0.06, z - i * 0.05
            _box("Audit | translucent sheet " + str(i + 1), (xx, yy, zz), (0.62, 0.037, 0.95), paper, 0.025)
            if i == 2:
                for j in range(4):
                    _box("Audit | fine document ruling " + str(j), (xx - 0.025, yy - 0.026, zz + 0.21 - j * 0.135), (0.37, 0.009, 0.013), materials["white"], 0.003)


def _ethereum_icon(x, y, z, material):
    # Two faceted, separated solids keep the characteristic Ethereum silhouette.
    ring = [(-0.35, 0, -0.04), (0, -0.20, -0.17), (0.35, 0, -0.04), (0, 0.20, -0.17)]
    vertices = [(x + xx, y + yy, z + zz) for xx, yy, zz in [(0, 0, 0.62)] + ring + [(0, 0, -0.29)]]
    faces = [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 1), (5, 2, 1), (5, 3, 2), (5, 4, 3), (5, 1, 4)]
    _mesh("Wallet | faceted Ethereum upper crystal", vertices, faces, material)
    vertices = [(x + xx, y + yy, z + zz) for xx, yy, zz in [(-0.35, 0, -0.16), (0, -0.20, -0.39), (0.35, 0, -0.16), (0, 0.20, -0.39), (0, 0, -0.76)]]
    _mesh("Wallet | faceted Ethereum lower crystal", vertices, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (0, 3, 2, 1)], material)


def _cube_icon(x, y, z, material):
    size = 0.31
    for tier in range(3):
        count = 3 - tier
        for col in range(count):
            xx = x + (col - (count - 1) / 2) * 0.39
            zz = z + (tier - 1) * 0.29
            obj = _box("Training | crystal block %s.%s" % (tier, col), (xx, y + tier * 0.045, zz), (size, size, size), material, 0.008)
            obj.rotation_euler[2] = math.radians(32)
        if tier == 0:
            obj = _box("Training | rear crystal block", (x + 0.19, y + 0.29, z - 0.16), (size, size, size), material, 0.008)
            obj.rotation_euler[2] = math.radians(32)


def _rings_icon(x, y, z, materials):
    for i, (dx, dy, material) in enumerate([(-0.21, 0.045, materials["metal"]), (0.22, -0.05, materials["pearl"])]):
        bpy.ops.mesh.primitive_torus_add(major_segments=96, minor_segments=16, location=(x + dx, y + dy, z), major_radius=0.42, minor_radius=0.075)
        obj = _smooth(_own(bpy.context.object, material))
        obj.name = "Approvals | interlocking ring " + str(i + 1)
        obj.rotation_euler = (math.pi / 2, math.radians(18 if i else -18), math.radians(8))


def _quartz_shard(name, x, y, z, radius, height, material, tilt=0):
    sides = 6
    vertices = [
        (radius * math.cos(i * math.tau / sides), radius * math.sin(i * math.tau / sides), shoulder * height)
        for shoulder in (-0.29, 0.25) for i in range(sides)
    ]
    vertices += [(0.018, 0.012, -height * 0.5), (-0.025, -0.008, height * 0.5)]
    faces = []
    for i in range(sides):
        following = (i + 1) % sides
        faces.extend(((i, following, following + sides, i + sides), (12, following, i), (13, i + sides, following + sides)))
    obj = _mesh(name, vertices, faces, material)
    obj.location = (x, y, z)
    obj.rotation_euler = (0.07, tilt, 0.24)
    _bevel(obj, 0.008, 2)
    return obj


def _generic_relic(x, y, z, variant, material):
    if variant == "quartz-tall":
        _quartz_shard("Generic relic | tall faceted quartz", x, y, z, 0.26, 1.48, material, -0.12)
    elif variant == "quartz-cluster":
        for index, (dx, dy, dz, height, tilt) in enumerate(((-0.32, 0.04, -0.10, 1.00, -0.24), (0, -0.07, 0.10, 1.30, 0.035), (0.34, 0.06, -0.09, 0.96, 0.25))):
            _quartz_shard("Generic relic | quartz cluster %d" % (index + 1), x + dx, y + dy, z + dz, 0.22, height, material, tilt)
    elif variant == "quartz-octahedron":
        vertices = [(0.48, 0, 0), (0, 0.33, 0), (-0.48, 0, 0), (0, -0.33, 0), (0, 0, 0.67), (0, 0, -0.59)]
        faces = [(i, (i + 1) % 4, 4) for i in range(4)] + [((i + 1) % 4, i, 5) for i in range(4)]
        obj = _mesh("Generic relic | suspended opal octahedron", vertices, faces, material)
        obj.location = (x, y, z)
        obj.rotation_euler = (0.09, -0.12, 0.16)
        _bevel(obj, 0.012, 3)


def _portal(name, x, y, width, height, label, icon, materials):
    existing = set(bpy.data.objects)
    radius = width * 0.59
    _cylinder(name + " | lower travertine plinth", (x, y, 0.20), radius + 0.20, 0.26, materials["stone"], 0.035)
    _cylinder(name + " | upper porcelain plinth", (x, y, 0.38), radius, 0.13, materials["stone"], 0.022)
    seam = _annulus(name + " | concealed warm light seam", (x, y, 0.4425),
                    radius * 0.97, radius * 0.97 - 0.020, 0.015, materials["glow"], 0.002)
    seam["station_light_geometry"] = "annular-inlay-v1"
    seam["station_light_width_m"] = 0.020
    base = 0.48
    cover = _arch(name + " | solid clear arched crystal", x, y, base, width, height, 0.16, materials["portal_glass"])
    rim = _arch_edge(name + " | front polished rim", x, y - 0.073, base + 0.025, width - 0.025, height - 0.018, materials["edge"])
    for guide in (cover, rim):
        guide["station_cover_reference"] = True
        guide.hide_render = True
        guide.hide_viewport = True
    # Preserve the established label and relic positions above each open plinth.
    front = y - 0.095
    nominal_width = {"invoice": 2.7, "ethereum": 2.0, "audit": 2.0, "cubes": 2.2, "rings": 2.5}.get(icon, 2.2)
    detail_scale = width / nominal_width
    label_z = base + height * 0.275
    _text(name + " | title", label, (x, front - 0.014, label_z), (0.255 if "\n" in label else 0.230) * detail_scale, materials["text"])
    _arrow(name + " | enter", x, front - 0.02, base + height * .14, materials["text"], radius=0.175 * detail_scale)
    icon_z = base + height * 0.60
    before_icon = set(bpy.data.objects)
    if icon == "invoice":
        _document_icon(x, front - 0.10, icon_z, materials, invoice=True)
    elif icon == "ethereum":
        _ethereum_icon(x, front - 0.04, icon_z + 0.055, materials["metal"])
    elif icon == "audit":
        _document_icon(x, front - 0.10, icon_z, materials)
    elif icon == "cubes":
        _cube_icon(x, front - 0.05, icon_z, materials["paper"])
    elif icon == "rings":
        _rings_icon(x, front - 0.05, icon_z, materials)
    elif icon in {"quartz-tall", "quartz-cluster", "quartz-octahedron"}:
        _generic_relic(x, front - 0.05, icon_z, icon, materials["paper"])
    pivot = Vector((x, front, icon_z))
    for obj in set(bpy.data.objects) - before_icon:
        obj["station_relic"] = True
        obj.location = pivot + (obj.location - pivot) * detail_scale
        obj.scale *= detail_scale
    parent = bpy.data.objects.new("Station | " + name, None)
    _collection().objects.link(parent)
    parent["station"] = True
    for child in set(bpy.data.objects) - existing - {parent}:
        child.parent = parent
    return {"name": name, "center": (x, y, base + height / 2), "width": width, "height": height}


def _pool(materials):
    _annulus("Hero pool | pale stone annular wall", (0, 0, 0.52), 4.9, 4.42, 0.57, materials["stone"], 0.045)
    _annulus("Hero pool | illuminated lower reveal", (0, 0, 0.216), 4.90, 4.72, 0.026, materials["glow"], 0.005)
    _annulus("Hero pool | underwater footing", (0, 0, 0.14), 5.02, 4.38, 0.12, materials["stone"], 0.025)
    # Each letter follows the cylindrical front face rather than floating on a plane.
    caption = "P E O P L E   +   A I   +   F I N A N C E"
    step = 0.071
    for index, character in enumerate(caption):
        if character == " ":
            continue
        angle = (index - (len(caption) - 1) / 2) * step / 4.907
        x = 4.907 * math.sin(angle)
        y = -4.907 * math.cos(angle)
        obj = _text("Hero pool | engraved caption %02d" % index, character, (x, y, 0.57), 0.091, materials["text"])
        obj.rotation_euler[2] = angle
    _curve("Hero pool | fine centered rule", [(-0.12, -4.911, 0.36), (0.12, -4.911, 0.36)], materials["text"], 0.002)


def _pebble(name, location, radius, material, rng):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=location)
    obj = _own(bpy.context.object, material)
    obj.name = name
    for vertex in obj.data.vertices:
        vertex.co *= rng.uniform(0.82, 1.18)
    obj.scale = (rng.uniform(0.7, 1.15), rng.uniform(0.6, 1.05), rng.uniform(0.7, 1.1))
    obj.rotation_euler = (rng.random() * 3, rng.random() * 3, rng.random() * 3)
    if name.startswith("Ground | weathered marble"):
        finish_ground_stone(obj)
        return obj
    bevel = obj.modifiers.new("Weathered crystal facets", "BEVEL")
    bevel.width = radius * 0.07
    bevel.segments = 2
    return obj


def finish_ground_stone(obj):
    """Retain the six grounding stones' silhouettes with rounded erosion."""
    _smooth(obj)
    for modifier in list(obj.modifiers):
        if modifier.type == "BEVEL":
            obj.modifiers.remove(modifier)
    subdivision = obj.modifiers.get("Rounded weathered surface") or obj.modifiers.new("Rounded weathered surface", "SUBSURF")
    subdivision.levels = 2
    subdivision.render_levels = 2
    texture_name = obj.name + " erosion"
    texture = bpy.data.textures.get(texture_name) or bpy.data.textures.new(texture_name, type="CLOUDS")
    texture.noise_scale = 0.14
    texture.noise_depth = 2
    texture.noise_basis = "IMPROVED_PERLIN"
    erosion = obj.modifiers.get("Gentle mineral erosion") or obj.modifiers.new("Gentle mineral erosion", "DISPLACE")
    erosion.texture = texture
    erosion.texture_coords = "GLOBAL"
    erosion.strength = 0.045
    erosion.mid_level = 0.5


def _hero(materials):
    center = (0, 1.5, 3.10)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=1.45, location=center)
    sphere = _smooth(_own(bpy.context.object, _gradient_pearl()))
    sphere.name = "Hyper | floating pearl marble sphere"
    _text("Hyper | hero wordmark", "hyper.", (0, -0.005, 3.16), 0.455, materials["text"], spacing=0.90)
    points = [(2.45 * math.cos(t), 1.5 + 0.57 * math.sin(t), 3.07 + 0.39 * math.sin(t) - 0.10 * math.cos(t)) for t in (i * math.tau / 320 for i in range(320))]
    _curve("Hyper | delicate orbital ring", points, materials["metal"], 0.012, True)
    # Retain the old lighting guide, but let the inner point and pearl volume glow.
    pole = _cylinder("Hyper | floating pearl light at lower pole", (0, 1.5, 1.67), 0.25, 0.025, materials["glow"], 0.01)
    pole.hide_render = True
    pole.hide_viewport = True
    pole.visible_glossy = False
    pole["lighting_reference_only"] = True
    rng = random.Random(323)
    for index in range(42):
        angle = rng.uniform(0, math.tau)
        radius = rng.uniform(1.70, 2.27)
        location = (radius * math.cos(angle), 1.5 + rng.uniform(-0.65, 0.7), 3.1 + radius * math.sin(angle) * 0.83)
        _pebble("Hyper | suspended satellite %02d" % index, location, rng.uniform(0.020, 0.066), materials["pearl"] if index % 3 else materials["portal_glass"], rng)
    for index, location in enumerate([(-7.8, 3.8, 5.6), (-7.3, 2.3, 4.1), (-6.2, 4.0, 3.5), (-4.1, 4.5, 5.0), (-3.3, 2.7, 5.5), (-2.0, 5.0, 5.0), (1.7, 4.0, 5.3), (4.8, 4.0, 5.7), (6.8, 4.0, 5.0), (8.0, 4.2, 3.7), (6.2, 5.2, 7.3)]):
        _pebble("Atmosphere | floating mineral %02d" % index, location, rng.uniform(0.10, 0.22), materials["stone"], rng)
    # Grounding stones match the small pale islands around the reference plinths.
    for index, (location, radius) in enumerate([((-9.0, -2.5, 0.28), 0.63), ((-8.6, -2.4, 0.35), 0.47), ((-4.9, 2.6, 0.48), 0.36), ((3.8, 2.8, 0.20), 0.62), ((5.9, 1.0, 0.24), 0.30), ((-6.6, 4.4, 0.27), 0.52)]):
        _pebble("Ground | weathered marble %02d" % index, location, radius, materials["stone"], rng)
    return sphere


def build_props(materials):
    """Build the reference props using supplied stone/glass/pearl/metal/text/glow materials."""
    mats = dict(materials)
    mats["portal_glass"] = _portal_material()
    mats["paper"] = _principled("Icons | milky lilac opal glass", (0.90, 0.85, 0.96), 0.16, 0.48, 0.03)
    mats["white"] = _principled("Icons | white enamel lettering", (0.98, 0.97, 0.95), 0.28)
    illuminate_relic_materials(mats)
    mats["edge"] = _principled("Portals | polished clear edge", (0.99, 0.97, 0.96), 0.07, 0.65, 0.12)
    _pool(mats)
    hero = _hero(mats)
    portals = [
        _portal("Accounts Payable", -8.0, -2.0, 2.70, 3.70, "Accounts\nPayable", "invoice", mats),
        _portal("Wallet Identity", -4.7, 2.5, 2.00, 3.40, "Wallet Identity", "ethereum", mats),
        _portal("Audit and Evidence", 4.7, 2.5, 2.00, 3.40, "Audit & Evidence", "audit", mats),
        _portal("Training Arena", 6.7, -0.1, 2.20, 3.40, "Training Arena", "cubes", mats),
        _portal("Approvals", 8.1, -2.0, 2.50, 3.45, "Approvals", "rings", mats),
    ]
    return {"collection": _collection().name, "hero": hero.name, "portals": portals}
