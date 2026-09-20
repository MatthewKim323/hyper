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
    shoulders = 3.8 * math.exp(-((abs(x) - 13.0) / 9.0) ** 2)
    depth = 0.30 + 0.72 * math.sin(y * 0.095 + 0.3) ** 2
    folds = 0.38 * math.sin(x * 0.30 + y * 0.14) + 0.28 * math.cos(x * 0.18 - y * 0.22)
    shoulders += 0.85 * math.exp(-((x - 17.0) / 8.0) ** 2) * math.sin(y * 0.12 + 0.5) ** 2
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
    rose = (0.97, 0.67, 0.76) if not leaf else (0.83, 0.62, 0.69)
    lilac = (0.84, 0.64, 0.82) if not leaf else (0.76, 0.60, 0.77)
    tint = tuple(a * (1 - mix) + b * mix for a, b in zip(rose, lilac))
    depth = min(0.62, max(0.0, (y - 23.0) / 75.0))
    horizon = (0.92, 0.74, 0.82) if not leaf else (0.88, 0.76, 0.83)
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
    """Build small, irregular flowering crowns as three merged meshes.

    Layered branch sprays create shaded interiors and separate pale flower tips.
    Near silhouettes retain cupped petals; distant branches use fewer faces.
    The original ridge mesh and camera-window sight lines remain unchanged.
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
            tint = (0.78 + wash * 0.04, 0.64 + wash * 0.04, 0.70 + wash * 0.04)
            depth = min(0.50, max(0.0, (y - 25) / 90))
            colors.append(color(tuple(c * (1 - depth) + h * depth for c, h in zip(tint, (0.87, 0.76, 0.83)))))
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
    # Scale with the openings for the original shallow-room authoring API, but
    # keep individual crowns under 1.65 m across in the calibrated deep room.
    plant_scale = opening_scale / (48.0 / 29.0)
    tiers = (
        # crowns, depth bounds, radius, crown height, sprays, leaf pairs, detail
        (800, 13.0, 31.0, (0.34, 0.60), (0.40, 0.80), 8, 3, "near"),
        (1000, 31.0, 49.0, (0.40, 0.67), (0.42, 0.84), 7, 2, "middle"),
        (700, 49.0, 73.5, (0.56, 0.82), (0.44, 0.88), 5, 1, "far"),
    )
    golden_angle = math.pi * (3.0 - math.sqrt(5.0))
    crown_count = blossom_count = leaf_count = stem_count = 0
    for count, near, far, radii, heights, spray_count, leaf_pairs, detail in tiers:
        positions = _plant_positions(count, near + depth_offset, far + depth_offset,
                                     rng, wall_y, camera_y, opening_scale, surface_height)
        for base in positions:
            x, y, _ = base
            crown_count += 1
            phase = rng.uniform(0, math.tau)
            radius = rng.uniform(*radii) * plant_scale
            height = rng.uniform(*heights) * plant_scale
            lean = Vector((math.cos(phase), math.sin(phase), 0)) * radius * rng.uniform(0.12, 0.28)
            center = base + lean + Vector((0, 0, height * 0.34))
            tint = _patch_tint(x, y, rng)
            foliage = _patch_tint(x, y, rng, leaf=True)
            # These two open leaf fans shade the interior. They are not a
            # closed ellipsoid: light and sky remain visible between branches.
            for angle in (phase, phase + 1.7):
                axis = Vector((math.cos(angle), math.sin(angle), rng.uniform(0.04, 0.22))).normalized()
                across = Vector((-axis.y, axis.x, 0))
                quad(stems, (
                    center - axis * radius * 0.88,
                    center + across * radius * 0.30 - Vector((0, 0, height * 0.12)),
                    center + axis * radius * 0.92 + Vector((0, 0, height * 0.12)),
                    center - across * radius * 0.28,
                ), foliage, (0.84, 0.90, 1.0, 0.94))
                leaf_count += 1

            for spray_index in range(spray_count):
                angle = phase + spray_index * golden_angle + rng.uniform(-0.22, 0.22)
                spread = math.sqrt((spray_index + 0.5) / spray_count)
                outward = Vector((math.cos(angle), math.sin(angle), 0))
                # Unequal three-lobed branching breaks both dome shapes and
                # repeated circular silhouettes at the skyline.
                lobe = 1.0 + 0.17 * math.sin(angle * 3.0 + phase)
                top = height * (0.44 + 0.56 * (1.0 - spread ** 2))
                top *= rng.uniform(0.82, 1.22)
                head = base + lean + outward * radius * spread * lobe + Vector((0, 0, top))
                branch_base = base + Vector((0, 0, height * rng.uniform(0.10, 0.22)))
                branch = head - branch_base
                sideways = Vector((-outward.y, outward.x, 0))
                if detail != "far":
                    half_width = 0.006 * plant_scale
                    triangle(stems, (branch_base - sideways * half_width,
                                     branch_base + sideways * half_width, head), foliage)
                    stem_count += 1

                for leaf_index in range(leaf_pairs):
                    fraction = 0.30 + (leaf_index + 0.35) / (leaf_pairs + 0.8) * 0.53
                    leaf_base = branch_base + branch * fraction
                    side = -1.0 if leaf_index % 2 else 1.0
                    leaf_direction = (outward * 0.50 + sideways * side * 0.68
                                      + Vector((0, 0, rng.uniform(0.12, 0.32)))).normalized()
                    length = radius * rng.uniform(0.38, 0.58)
                    leaf_tip = leaf_base + leaf_direction * length
                    leaf_mid = (leaf_base + leaf_tip) * 0.5 + Vector((0, 0, length * 0.09))
                    leaf_width = sideways * length * rng.uniform(0.19, 0.28)
                    quad(stems, (leaf_base, leaf_mid - leaf_width, leaf_tip, leaf_mid + leaf_width),
                         foliage, (0.87, 0.96, 1.06, 0.99))
                    leaf_count += 1

                normal = (outward * rng.uniform(0.38, 0.85)
                          + Vector((rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), rng.uniform(0.62, 1.0)))).normalized()
                u = normal.cross(Vector((0, 1, 0))).normalized()
                v = normal.cross(u).normalized()
                flower_radius = rng.uniform(0.13, 0.20) * plant_scale
                if detail == "far":
                    flower_radius *= 1.18
                # Bright cream/blush tips sit above the subdued lilac interior.
                # Geometry normals, transmission and real lights do the shading.
                cream = (0.985, 0.875, 0.83)
                cream_mix = rng.uniform(0.28, 0.58) + 0.10 * top / height
                flower_tint = tuple(a * (1.0 - cream_mix) + b * cream_mix for a, b in zip(tint, cream))
                blossom_count += 1
                for petal_index in range(5):
                    petal_angle = angle + petal_index * math.tau / 5
                    radial = u * math.cos(petal_angle) + v * math.sin(petal_angle)
                    across = -u * math.sin(petal_angle) + v * math.cos(petal_angle)
                    petal_length = flower_radius * rng.uniform(0.90, 1.10)
                    cup = flower_radius * rng.uniform(0.15, 0.30)
                    if detail == "near":
                        quad(petals, (
                            head - normal * flower_radius * 0.04,
                            head + radial * petal_length * 0.60 - across * flower_radius * 0.47 + normal * cup * 0.25,
                            head + radial * petal_length + normal * cup,
                            head + radial * petal_length * 0.60 + across * flower_radius * 0.47 + normal * cup * 0.25,
                        ), flower_tint, (0.94, 1.0, 1.035, 0.99))
                    else:
                        triangle(petals, (
                            head - normal * flower_radius * 0.04,
                            head + radial * petal_length * 0.83 - across * flower_radius * 0.47 + normal * cup,
                            head + radial * petal_length + across * flower_radius * 0.30 + normal * cup * 0.75,
                        ), flower_tint, (0.96, 1.025, 1.0))

    shrubs = mesh("Landscape | layered lilac flowering canopies", plant_v, plant_f, plant_c, canopy)
    flowers = mesh("Landscape | blush five petal blossoms", petal_v, petal_f, petal_c, petal)
    ground["ridge_height_m"] = 3.0 * height_scale
    ground["wall_y"] = wall_y
    ground["opening_scale"] = opening_scale
    ground["height_scale"] = height_scale
    shrubs["botanical_crowns"] = crown_count
    shrubs["botanical_stems"] = stem_count
    shrubs["botanical_leaves"] = leaf_count
    flowers["blossoms"] = blossom_count
    flowers["petals"] = blossom_count * 5
    flowers["depth_bands"] = "800 near crowns, 1000 middle crowns, 700 far crowns"
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
