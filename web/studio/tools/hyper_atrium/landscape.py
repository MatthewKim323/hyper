"""Rolling rose gardens outside the atrium's real architectural openings.

The entire landscape is three merged meshes. Linear vertex colors preserve the
rose, lilac, and blush variation in both Cycles and the live glTF scene.
"""
import math
import random

import bpy
from mathutils import Vector, noise


COLOR_ATTRIBUTE = "PetalColor"
MATERIAL_NAMES = (
    "Garden | rose earth with vertex colors",
    "Garden | lilac flowering canopies with vertex colors",
    "Garden | blush petals with vertex colors",
)


def linear(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def color(rgb, variation=1.0):
    return tuple(linear(min(1.0, max(0.0, value * variation))) * 0.85 for value in rgb) + (1.0,)


def height_at(x, y):
    """Two soft shoulder ridges frame a lower opening behind the hero sphere."""
    shoulders = 3.0 * math.exp(-((abs(x) - 13.0) / 9.0) ** 2)
    depth = 0.30 + 0.72 * math.sin(y * 0.095 + 0.3) ** 2
    folds = 0.24 * math.sin(x * 0.30 + y * 0.14) + 0.15 * math.cos(x * 0.18 - y * 0.22)
    detail = 0.10 * noise.fractal(Vector((x * 0.18, y * 0.18, 8.3)), 1.0, 2.0, 3)
    shore = min(1.0, max(0.0, (y - 10.0) / 18.0))
    shore = shore * shore * (3.0 - 2.0 * shore)
    return -0.42 + shore * (shoulders + depth + folds + detail)


def material(name, roughness, subsurface=0.0):
    result = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    result.use_nodes = True
    nodes = result.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = (1, 1, 1, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = 0
    shader.inputs["Specular IOR Level"].default_value = 0.22
    shader.inputs["Subsurface Weight"].default_value = subsurface
    shader.inputs["Subsurface Radius"].default_value = (0.075, 0.04, 0.025)
    vertex = nodes.new("ShaderNodeVertexColor")
    vertex.layer_name = COLOR_ATTRIBUTE
    result.node_tree.links.new(vertex.outputs["Color"], shader.inputs["Base Color"])
    if "earth" in name or "canopies" in name:
        coordinates = nodes.new("ShaderNodeTexCoord")
        grain = nodes.new("ShaderNodeTexNoise")
        grain.inputs["Scale"].default_value = 30 if "earth" in name else 90
        grain.inputs["Detail"].default_value = 3
        grain.inputs["Roughness"].default_value = 0.7
        result.node_tree.links.new(coordinates.outputs["Object"], grain.inputs["Vector"])
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.35 if "earth" in name else 0.2
        bump.inputs["Distance"].default_value = 0.016 if "earth" in name else 0.0013
        result.node_tree.links.new(grain.outputs["Fac"], bump.inputs["Height"])
        result.node_tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    result.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    if "petals" in name or "canopies" in name:
        translucent = nodes.new("ShaderNodeBsdfTranslucent")
        result.node_tree.links.new(vertex.outputs["Color"], translucent.inputs["Color"])
        mix = nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = .35 if "petals" in name else .20
        result.node_tree.links.new(shader.outputs[0], mix.inputs[1])
        result.node_tree.links.new(translucent.outputs[0], mix.inputs[2])
        result.node_tree.links.new(mix.outputs[0], output.inputs["Surface"])
    result["runtime_surface"] = "foliage"
    result["vertex_color_attribute"] = COLOR_ATTRIBUTE
    result.diffuse_color = color((0.85, 0.56, 0.68))
    return result


def mesh(name, vertices, faces, colors, surface):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    attribute = data.color_attributes.new(name=COLOR_ATTRIBUTE, type="FLOAT_COLOR", domain="POINT")
    attribute.data.foreach_set("color", [channel for rgba in colors for channel in rgba])
    data.color_attributes.active_color_index = 0
    data.color_attributes.render_color_index = 0
    for polygon in data.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    data.materials.append(surface)
    obj["landscape"] = True
    obj["runtime_surface"] = "foliage"
    return obj


def _patch_tint(x, y, rng, leaf=False):
    """Low-frequency color families avoid random candy-colored confetti."""
    mix = 0.5 + 0.5 * noise.noise(Vector((x * 0.12, y * 0.10, 3.7)))
    rose = (0.91, 0.72, 0.78) if not leaf else (0.59, 0.46, 0.51)
    lilac = (0.78, 0.69, 0.84) if not leaf else (0.54, 0.48, 0.60)
    tint = tuple(a * (1 - mix) + b * mix for a, b in zip(rose, lilac))
    depth = min(0.62, max(0.0, (y - 23.0) / 75.0))
    horizon = (0.87, 0.80, 0.85) if not leaf else (0.73, 0.66, 0.73)
    tint = tuple(a * (1 - depth) + b * depth for a, b in zip(tint, horizon))
    variation = rng.uniform(0.94, 1.055)
    return tuple(min(1.0, channel * variation) for channel in tint)


def _plant_positions(count, near, far, rng, wall_y, camera_y, opening_scale, surface_height):
    """Sample the true five-window sight lines instead of wasting distant detail.

    The vertical distribution is stratified and the transverse sequence is
    low-discrepancy, avoiding both visible rows and random bare patches.
    """
    apertures = ((-13.1, 2.0), (-7.1, 2.9), (0, 6.0), (7.1, 2.9), (13.1, 2.0))
    apertures = tuple((x * opening_scale, width * opening_scale) for x, width in apertures)
    total_width = sum(width for _, width in apertures)
    golden = 0.6180339887498949
    shift = rng.random()
    for index in range(count):
        # A stratified permutation breaks the horizon into overlapping depths.
        fraction = (index + rng.random()) / count
        y = math.sqrt((near - camera_y) ** 2 + fraction * ((far - camera_y) ** 2 - (near - camera_y) ** 2)) + camera_y
        transverse = ((index * golden + shift + rng.uniform(-0.005, 0.005)) % 1) * total_width
        for arch_x, arch_width in apertures:
            if transverse <= arch_width:
                x = (arch_x + (transverse / arch_width - 0.5) * arch_width * 1.16) * (y - camera_y) / (wall_y - camera_y)
                break
            transverse -= arch_width
        z = surface_height(x, y)
        # Move the few plants on the central water inlet up its riverbank.
        if z < 0.035:
            for _ in range(12):
                y += 0.6
                z = surface_height(x, y)
                if z >= 0.035:
                    break
        yield Vector((x, y, z - 0.012))


def build_landscape(seed=20260919, wall_y=8.0, camera_y=-21.0, opening_scale=1.0, height_scale=1.0):
    """Build 43,000 botanical sprigs as three merged, vertex-colored meshes.

    Near silhouettes contain cupped petals, crossed stems, and pointed leaves.
    Far silhouettes simplify those same floral parts. No spheres or rock-like
    canopy islands are used. The landscape totals 500,000 triangles.
    """
    rng = random.Random(seed)
    depth_offset = wall_y - 8.0
    def surface_height(x, y):
        return height_at(x / opening_scale, y - depth_offset) * height_scale
    earth = material(MATERIAL_NAMES[0], 0.94)
    canopy = material(MATERIAL_NAMES[1], 0.85, 0.055)
    petal = material(MATERIAL_NAMES[2], 0.77, 0.12)
    petal_shader = petal.node_tree.nodes.get("Principled BSDF")
    if petal_shader:
        petal_shader.inputs["Subsurface Radius"].default_value = (0.025, 0.016, 0.01)
        petal_shader.inputs["Transmission Weight"].default_value = 0.06
        petal_shader.inputs["IOR"].default_value = 1.35

    vertices, faces, colors = [], [], []
    nx, ny = 100, 40
    for j in range(ny + 1):
        y = depth_offset + 9.0 + 65.0 * j / ny
        for i in range(nx + 1):
            x = (-50 + 100 * i / nx) * opening_scale
            vertices.append((x, y, surface_height(x, y)))
            wash = 0.5 + 0.5 * noise.noise(Vector((x * 0.32, y * 0.27, 4.1)))
            # A muted understory rather than bare pink soil between flower heads.
            tint = (0.68 + wash * 0.10, 0.54 + wash * 0.12, 0.62 + wash * 0.11)
            depth = min(0.50, max(0.0, (y - 25) / 90))
            colors.append(color(tuple(c * (1 - depth) + h * depth for c, h in zip(tint, (0.80, 0.72, 0.81)))))
    for j in range(ny):
        for i in range(nx):
            index = j * (nx + 1) + i
            faces.append((index, index + 1, index + nx + 2, index + nx + 1))
    ground = mesh("Landscape | rolling rose garden ridges", vertices, faces, colors, earth)

    plant_v, plant_f, plant_c = [], [], []
    petal_v, petal_f, petal_c = [], [], []

    def triangle(target, points, tint, factors=(0.86, 1.0, 1.025)):
        out_v, out_f, out_c = target
        index = len(out_v)
        out_v.extend(tuple(point) for point in points)
        out_f.append((index, index + 1, index + 2))
        out_c.extend(color(tint, factor) for factor in factors)

    def quad(target, points, tint, factors=(0.84, 0.97, 1.035, 0.98)):
        out_v, out_f, out_c = target
        index = len(out_v)
        out_v.extend(tuple(point) for point in points)
        out_f.extend(((index, index + 1, index + 2), (index, index + 2, index + 3)))
        out_c.extend(color(tint, factor) for factor in factors)

    stems = (plant_v, plant_f, plant_c)
    petals = (petal_v, petal_f, petal_c)
    tiers = (
        # count, depth bounds, head radius, stem height, silhouette detail
        (21000, 13.0, 31.0, (0.055, 0.095), (0.12, 0.27), "near"),
        (12000, 31.0, 49.0, (0.070, 0.115), (0.16, 0.30), "middle"),
        (10000, 49.0, 73.5, (0.085, 0.14), (0.08, 0.15), "far"),
    )
    for count, near, far, radii, heights, detail in tiers:
        for base in _plant_positions(count, near + depth_offset, far + depth_offset, rng, wall_y, camera_y, opening_scale, surface_height):
            x, y, z = base
            phase = rng.uniform(0, math.tau)
            radius = rng.uniform(*radii) * opening_scale
            height = rng.uniform(*heights) * opening_scale
            # Small lateral bends and layered heights keep the field organic.
            lean = Vector((math.cos(phase), math.sin(phase), 0))
            head = base + lean * height * rng.uniform(0.12, 0.32) + Vector((0, 0, height))
            normal = Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.85, -0.25), rng.uniform(0.75, 1.15))).normalized()
            u = normal.cross(Vector((0, 1, 0))).normalized()
            v = normal.cross(u).normalized()
            tint = _patch_tint(x, y, rng)
            foliage_tint = _patch_tint(x, y, rng, leaf=True)

            for petal_index in range(5):
                angle = phase + petal_index * math.tau / 5
                radial = u * math.cos(angle) + v * math.sin(angle)
                across = -u * math.sin(angle) + v * math.cos(angle)
                petal_length = radius * rng.uniform(0.91, 1.07)
                cup = radius * rng.uniform(0.12, 0.24)
                if detail == "near":
                    quad(petals, (
                        head - normal * radius * 0.04,
                        head + radial * petal_length * 0.60 - across * radius * 0.47 + normal * cup * 0.25,
                        head + radial * petal_length + normal * cup,
                        head + radial * petal_length * 0.60 + across * radius * 0.47 + normal * cup * 0.25,
                    ), tint)
                else:
                    triangle(petals, (
                        head - normal * radius * 0.04,
                        head + radial * petal_length * 0.83 - across * radius * 0.47 + normal * cup,
                        head + radial * petal_length + across * radius * 0.30 + normal * cup * 0.75,
                    ), tint)

            if detail == "near":
                # Two crossed tapered strips keep even thin stems visible from
                # the camera and its water reflection without alpha textures.
                for axis in (Vector((1, 0, 0)), Vector((0, 1, 0))):
                    thickness = rng.uniform(0.0025, 0.0040)
                    quad(stems, (base - axis * thickness, base + axis * thickness, head + axis * thickness * 0.35, head - axis * thickness * 0.35), foliage_tint, (0.76, 0.78, 0.95, 0.94))
                leaf_base = base + (head - base) * 0.42
                leaf_axis = lean * radius * 1.45 + Vector((0, 0, radius * 0.30))
                side = Vector((-lean.y, lean.x, 0)) * radius * 0.23
                quad(stems, (leaf_base, leaf_base + leaf_axis * 0.5 - side, leaf_base + leaf_axis, leaf_base + leaf_axis * 0.5 + side), foliage_tint)
            elif detail == "middle":
                triangle(stems, (base - u * 0.003, base + u * 0.003, head), foliage_tint)
                leaf_base = base + (head - base) * 0.40
                tip = leaf_base + lean * radius * 1.20 + Vector((0, 0, radius * 0.2))
                side = Vector((-lean.y, lean.x, 0)) * radius * 0.22
                quad(stems, (leaf_base, (leaf_base + tip) * 0.5 - side, tip, (leaf_base + tip) * 0.5 + side), foliage_tint)
            else:
                # A tiny ivory core separates overlapping distant florets.
                triangle(petals, (head + u * radius * 0.15, head - u * radius * 0.10 + v * radius * 0.12, head - u * radius * 0.10 - v * radius * 0.12), (0.92, 0.84, 0.83))

    shrubs = mesh("Landscape | layered lilac flowering canopies", plant_v, plant_f, plant_c, canopy)
    flowers = mesh("Landscape | blush five petal blossoms", petal_v, petal_f, petal_c, petal)
    ground["ridge_height_m"] = 3.0 * height_scale
    ground["wall_y"] = wall_y
    ground["opening_scale"] = opening_scale
    shrubs["botanical_stems"] = 33000
    shrubs["botanical_leaves"] = 33000
    flowers["blossoms"] = 43000
    flowers["petals"] = 215000
    flowers["depth_bands"] = "21000 near, 12000 middle, 10000 far"
    return {"ground": ground, "canopies": shrubs, "blossoms": flowers}


def replace_landscape(scene=None, seed=20260919, wall_y=8.0, camera_y=-21.0, opening_scale=1.0, height_scale=1.0):
    """Replace only garden objects in an already loaded scene; never save it.

    This does not change lights, world, stations, camera, or other materials.
    Call the separate scene material/lighting refinement after this function.
    """
    scene = scene or bpy.context.scene
    for obj in list(scene.objects):
        if obj.name.startswith("Landscape | "):
            bpy.data.objects.remove(obj, do_unlink=True)
    return build_landscape(seed=seed, wall_y=wall_y, camera_y=camera_y, opening_scale=opening_scale, height_scale=height_scale)


def refine_arch_lighting(scene):
    """Keep the warm sun behind the openings so geometry forms real shafts."""
    directional = scene.objects.get("Light | sun shadows")
    if directional:
        directional.data.energy = 2.0
        directional.data.angle = 0.055
        directional.data.color = (1.0, 0.83, 0.73)
        directional.rotation_euler = Vector((-12, -25, -15)).to_track_quat("-Z", "Y").to_euler()
    diagonal = scene.objects.get("Light | warm diagonal sun")
    if diagonal:
        diagonal.data.energy = 5800
        diagonal.data.size = 1.5
    broad = scene.objects.get("Light | broad ivory sky fill")
    if broad:
        broad.data.energy = 180
    # Keep physical skylight for diffuse rays, and a softer blue cloud sky
    # for the camera and water. World normals point opposite the ray direction.
    if scene.world and scene.world.use_nodes:
        tree = scene.world.node_tree
        tree.nodes.clear()
        nodes = tree.nodes
        sky = nodes.new("ShaderNodeTexSky")
        sky.sky_type = "NISHITA"
        sky.sun_elevation = math.radians(28)
        sky.sun_rotation = math.radians(130)
        sky.altitude = 0.1
        sky.air_density = 0.85
        sky.dust_density = 0.45
        daylight = nodes.new("ShaderNodeBackground")
        daylight.inputs["Strength"].default_value = 0.26
        tree.links.new(sky.outputs["Color"], daylight.inputs["Color"])
        coords = nodes.new("ShaderNodeTexCoord")
        invert = nodes.new("ShaderNodeVectorMath")
        invert.operation = "SCALE"
        invert.inputs["Scale"].default_value = -1
        tree.links.new(coords.outputs["Normal"], invert.inputs[0])
        separate = nodes.new("ShaderNodeSeparateXYZ")
        tree.links.new(invert.outputs["Vector"], separate.inputs[0])
        elevation = nodes.new("ShaderNodeMath")
        elevation.operation = "MULTIPLY"
        elevation.inputs[1].default_value = 4.0
        tree.links.new(separate.outputs["Z"], elevation.inputs[0])
        gradient = nodes.new("ShaderNodeValToRGB")
        gradient.color_ramp.elements[0].color = tuple(linear(c) for c in (0.90, 0.85, 0.90)) + (1,)
        gradient.color_ramp.elements[1].color = tuple(linear(c) for c in (0.57, 0.68, 0.88)) + (1,)
        tree.links.new(elevation.outputs[0], gradient.inputs[0])
        clouds = nodes.new("ShaderNodeTexNoise")
        clouds.inputs["Scale"].default_value = 9
        clouds.inputs["Detail"].default_value = 4
        clouds.inputs["Roughness"].default_value = 0.65
        tree.links.new(invert.outputs["Vector"], clouds.inputs["Vector"])
        cloud_mask = nodes.new("ShaderNodeValToRGB")
        cloud_mask.color_ramp.elements[0].position = 0.57
        cloud_mask.color_ramp.elements[1].position = 0.68
        tree.links.new(clouds.outputs["Fac"], cloud_mask.inputs[0])
        cloud_color = nodes.new("ShaderNodeMixRGB")
        cloud_color.inputs[2].default_value = (1.0, 0.97, 0.96, 1)
        tree.links.new(cloud_mask.outputs["Color"], cloud_color.inputs[0])
        tree.links.new(gradient.outputs["Color"], cloud_color.inputs[1])
        visible = nodes.new("ShaderNodeBackground")
        visible.inputs["Strength"].default_value = 2.8
        tree.links.new(cloud_color.outputs["Color"], visible.inputs["Color"])
        ray = nodes.new("ShaderNodeLightPath")
        ray_type = nodes.new("ShaderNodeMath")
        ray_type.operation = "MAXIMUM"
        tree.links.new(ray.outputs["Is Camera Ray"], ray_type.inputs[0])
        tree.links.new(ray.outputs["Is Glossy Ray"], ray_type.inputs[1])
        combine = nodes.new("ShaderNodeMixShader")
        tree.links.new(ray_type.outputs[0], combine.inputs[0])
        tree.links.new(daylight.outputs[0], combine.inputs[1])
        tree.links.new(visible.outputs[0], combine.inputs[2])
        output = nodes.new("ShaderNodeOutputWorld")
        tree.links.new(combine.outputs[0], output.inputs["Surface"])
    haze = bpy.data.materials.get("Air | fine sunlit haze")
    if haze and haze.use_nodes:
        volume = next((node for node in haze.node_tree.nodes if node.type == "PRINCIPLED_VOLUME"), None)
        if volume:
            volume.inputs["Density"].default_value = 0.0055
            volume.inputs["Anisotropy"].default_value = 0.62
    haze_box = scene.objects.get("Atmosphere | atrium air")
    if haze_box:
        # Keep scattering in the hall, rather than fogging the entire garden
        # and camera. Arch-cut sunlight now has a bounded volume to illuminate.
        haze_box.location = (0, 0.5, 7)
        haze_box.dimensions = (35, 20, 14)
