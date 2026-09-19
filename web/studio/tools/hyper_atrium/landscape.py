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
    return tuple(linear(min(1.0, max(0.0, value * variation))) * 0.65 for value in rgb) + (1.0,)


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
        grain.inputs["Scale"].default_value = 18 if "earth" in name else 35
        grain.inputs["Detail"].default_value = 3
        grain.inputs["Roughness"].default_value = 0.7
        result.node_tree.links.new(coordinates.outputs["Object"], grain.inputs["Vector"])
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.65
        bump.inputs["Distance"].default_value = 0.075 if "earth" in name else 0.022
        result.node_tree.links.new(grain.outputs["Fac"], bump.inputs["Height"])
        result.node_tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    result.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
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


def build_landscape(seed=20260919):
    """Create a coherent garden without per-bush objects or texture downloads."""
    rng = random.Random(seed)
    earth = material(MATERIAL_NAMES[0], 0.92)
    canopy = material(MATERIAL_NAMES[1], 0.84, 0.045)
    petal = material(MATERIAL_NAMES[2], 0.72, 0.08)

    vertices, faces, colors = [], [], []
    nx, ny = 100, 40
    for j in range(ny + 1):
        y = 9.0 + 65.0 * j / ny
        for i in range(nx + 1):
            x = -50 + 100 * i / nx
            vertices.append((x, y, height_at(x, y)))
            wash = 0.5 + 0.5 * noise.noise(Vector((x * 0.18, y * 0.18, 4.1)))
            colors.append(color((0.63 + wash * 0.12, 0.49 + wash * 0.12, 0.52 + wash * 0.12)))
    for j in range(ny):
        for i in range(nx):
            index = j * (nx + 1) + i
            faces.append((index, index + 1, index + nx + 2, index + nx + 1))
    ground = mesh("Landscape | rolling rose garden ridges", vertices, faces, colors, earth)

    # Smooth, low-domed ellipsoids give the garden a flowering canopy silhouette.
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1)
    prototype = bpy.context.object
    ico_vertices = [vertex.co.copy() for vertex in prototype.data.vertices]
    ico_faces = [tuple(face.vertices) for face in prototype.data.polygons]
    bpy.data.objects.remove(prototype, do_unlink=True)
    bush_vertices, bush_faces, bush_colors = [], [], []
    bloom_vertices, bloom_faces, bloom_colors = [], [], []
    canopy_palette = ((0.68, 0.48, 0.56), (0.76, 0.55, 0.61), (0.68, 0.53, 0.66), (0.83, 0.65, 0.71), (0.75, 0.58, 0.69))
    petal_palette = ((0.94, 0.75, 0.81), (0.98, 0.82, 0.85), (0.84, 0.72, 0.88), (0.91, 0.71, 0.79), (0.91, 0.80, 0.94))

    # Jittered rows avoid large accidental holes while breaking any orchard grid.
    for row in range(60):
        for column in range(70):
            x = -38 + (column + rng.uniform(-0.30, 0.30)) * 76 / 69
            y = 24.5 + (row + rng.uniform(-0.30, 0.30)) * 43 / 59
            radius = rng.uniform(0.18, 0.28)
            tall = radius * rng.uniform(0.58, 0.95)
            center = Vector((x, y, height_at(x, y) + tall * 0.30))
            phase = rng.uniform(0, math.tau)
            swatch = rng.choice(canopy_palette)
            offset = len(bush_vertices)
            for point in ico_vertices:
                # Uniform smooth normals and modest asymmetry, never cone tips.
                px = point.x * math.cos(phase) - point.y * math.sin(phase)
                py = point.x * math.sin(phase) + point.y * math.cos(phase)
                scale = rng.uniform(0.94, 1.06)
                bush_vertices.append(tuple(center + Vector((px * radius * scale, py * radius * 0.9 * scale, point.z * tall * scale))))
                bush_colors.append(color(swatch, 0.92 + 0.12 * (point.z + 1) / 2))
            bush_faces.extend(tuple(offset + index for index in face) for face in ico_faces)

            # Small five-petal flower heads punctuate the distant canopy. These remain actual
            # geometry in the unified Blender file and the exported live scene.
            for bloom in range(1 if (row * 70 + column) % 4 == 0 else 0):
                a = phase + bloom * 2.5
                head = center + Vector((math.cos(a) * radius * 0.42, math.sin(a) * radius * 0.42, tall * 0.73))
                normal = Vector((rng.uniform(-0.30, 0.30), rng.uniform(-0.65, -0.15), 1)).normalized()
                u = normal.cross(Vector((0, 1, 0))).normalized()
                v = normal.cross(u).normalized()
                size = rng.uniform(0.065, 0.10)
                tint = rng.choice(petal_palette)
                for petal_index in range(5):
                    angle = phase + petal_index * math.tau / 5
                    radial = u * math.cos(angle) + v * math.sin(angle)
                    across = -u * math.sin(angle) + v * math.cos(angle)
                    offset = len(bloom_vertices)
                    blossom = (
                        head + radial * size * 0.06,
                        head + radial * size * 0.58 - across * size * 0.30 + normal * size * 0.10,
                        head + radial * size + normal * size * 0.28,
                        head + radial * size * 0.58 + across * size * 0.30 + normal * size * 0.10,
                    )
                    bloom_vertices.extend(tuple(point) for point in blossom)
                    bloom_colors.extend(color(tint, factor) for factor in (0.80, 0.96, 1.04, 0.96))
                    bloom_faces.extend(((offset, offset + 1, offset + 2), (offset, offset + 2, offset + 3)))

    # Fine vegetation on the visible near slopes, placed inside the five
    # window sight lines. Its scale stays tiny even beside the nearest arches.
    for arch_x, arch_width in ((-13.1, 2.0), (-7.1, 2.9), (0, 6.0), (7.1, 2.9), (13.1, 2.0)):
        for _ in range(180):
            y = rng.uniform(14.0, 24.0)
            perspective = (y + 21.0) / 29.0
            x = (arch_x + rng.uniform(-arch_width * 0.58, arch_width * 0.58)) * perspective
            radius = rng.uniform(0.08, 0.13)
            tall = radius * rng.uniform(0.65, 1.0)
            center = Vector((x, y, height_at(x, y) + tall * 0.25))
            swatch = rng.choice(canopy_palette)
            offset = len(bush_vertices)
            phase = rng.uniform(0, math.tau)
            for point in ico_vertices:
                px = point.x * math.cos(phase) - point.y * math.sin(phase)
                py = point.x * math.sin(phase) + point.y * math.cos(phase)
                bush_vertices.append(tuple(center + Vector((px * radius, py * radius * 0.9, point.z * tall))))
                bush_colors.append(color(swatch, 0.94 + 0.10 * (point.z + 1) / 2))
            bush_faces.extend(tuple(offset + index for index in face) for face in ico_faces)

    shrubs = mesh("Landscape | layered lilac flowering canopies", bush_vertices, bush_faces, bush_colors, canopy)
    flowers = mesh("Landscape | blush five petal blossoms", bloom_vertices, bloom_faces, bloom_colors, petal)
    ground["ridge_height_m"] = 3.0
    shrubs["canopies"] = 5100
    flowers["blossoms"] = 1050
    return {"ground": ground, "canopies": shrubs, "blossoms": flowers}


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
