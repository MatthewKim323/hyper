"""Rebuild Hyper's post-onboarding atrium in Blender 4.5.

blender -b --python tools/hyper_atrium/build.py -- --preview
blender -b --python tools/hyper_atrium/build.py -- --final
"""
import argparse
import math
import json
import os
from pathlib import Path
import random
import sys
import bpy
from mathutils import Vector, noise

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from materials import build_materials, build_water
from props import build_props
from landscape import build_landscape, refine_arch_lighting

parser = argparse.ArgumentParser()
parser.add_argument('--preview', action='store_true')
parser.add_argument('--final', action='store_true')
parser.add_argument('--save-only', action='store_true')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
OUT = ROOT / 'assets/blender/hyper-atrium'
OUT.mkdir(parents=True, exist_ok=True)
random.seed(19)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in bpy.data.materials:
    bpy.data.materials.remove(block)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32 if args.preview else 96
scene.cycles.use_denoising = True
scene.cycles.adaptive_threshold = 0.04 if args.preview else 0.025
scene.cycles.max_bounces = 12
scene.cycles.transmission_bounces = 10
scene.cycles.transparent_max_bounces = 12
scene.cycles.volume_bounces = 2
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'METAL'
    scene.cycles.device = 'GPU'
except Exception:
    scene.cycles.device = 'CPU'
scene.render.resolution_x = 1280 if args.preview else 2560
scene.render.resolution_y = round(scene.render.resolution_x * 941 / 1672)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -1.65
scene.render.fps = 30
scene.frame_end = 240
m = build_materials()
# Graphite inscriptions remain legible under the high dynamic range window light.
ink=m['text'];ink.node_tree.nodes.clear()
e=ink.node_tree.nodes.new('ShaderNodeEmission');e.inputs['Color'].default_value=(.085,.071,.067,1);e.inputs['Strength'].default_value=1
out=ink.node_tree.nodes.new('ShaderNodeOutputMaterial');ink.node_tree.links.new(e.outputs[0],out.inputs['Surface'])


def mesh(name, vertices, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def cube(name, loc, scale, material, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new('Soft stone edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        mod = obj.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
    return obj


def arch_cutter(x, width, top):
    radius = width / 2
    spring = top - radius
    shape = [(-radius, -1), (radius, -1), (radius, spring)]
    shape += [(radius * math.cos(i * math.pi / 80), spring + radius * math.sin(i * math.pi / 80)) for i in range(1, 81)]
    shape += [(-radius, -1)]
    shape = shape[:-1]
    count = len(shape)
    verts = [(x + px, y, z) for y in (6, 10) for px, z in shape]
    faces = [tuple(range(count)), tuple(range(2 * count - 1, count - 1, -1))]
    faces += [(i + count, (i + 1) % count + count, (i + 1) % count, i) for i in range(count)]
    return mesh('Arch opening construction', verts, faces, m['stone'])

wall = cube('Atrium | monolithic blush limestone', (0, 8, 7.7), (34, 1.0, 16.5), m['stone'])
for x, width, height in [(-13.1,2.0,7.5),(-7.1,2.9,10.7),(0,6.0,13.3),(7.1,2.9,10.7),(13.1,2.0,7.5)]:
    cutter = arch_cutter(x, width, height)
    mod = wall.modifiers.new('Carved arch', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cutter
    bpy.context.view_layer.objects.active = wall
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
edge = wall.modifiers.new('Worn architectural edges', 'BEVEL')
edge.width = 0.07
edge.segments = 3
wall.modifiers.new('Architectural normals', 'WEIGHTED_NORMAL')
for x in [-15.0,-10.5,-4.2,4.2,10.5,15.0]:
    cube('Atrium | inset pilaster', (x, 7.42, 7.1), (.23,.27,14.3), m['stone'], .045)
    cube('Atrium | pilaster foot', (x, 7.22,.17), (.8,.85,.22), m['stone'],.05)
water_objects = build_water(m)
for key in ('surface', 'basin'):
    water_objects[key].pass_index = 1
props_data = build_props(m)

# Curving low pathways frame the foreground pool, without blocking its reflection.
def arc_walkway(name, cx, cy, r, width, start, end):
    n = 130
    v=[]
    for z in (.04,.20):
        for rr in (r-width/2,r+width/2):
            for i in range(n+1):
                a=math.radians(start+(end-start)*i/n)
                v.append((cx+rr*math.cos(a),cy+rr*math.sin(a),z))
    s=n+1
    f=[]
    for i in range(n):
        f += [(i,i+1,s+i+1,s+i),(2*s+i,3*s+i,3*s+i+1,2*s+i+1),(i,2*s+i,2*s+i+1,i+1),(s+i,s+i+1,3*s+i+1,3*s+i)]
    f += [(0,s,3*s,2*s),(n,2*s-1,4*s-1,3*s-1)]
    ob=mesh(name,v,f,m['stone'])
    b=ob.modifiers.new('Rounded waterline', 'BEVEL');b.width=.06;b.segments=3
    ob.modifiers.new('Edge normals','WEIGHTED_NORMAL')
arc_walkway('Walkway | left water curve',-13,-6.0,6.6,.6,-90,85)
arc_walkway('Walkway | right water curve',13,-5.8,6.8,.6,95,265)

# Three merged, vertex-colored meshes form the distant rose garden.
build_landscape()

world=bpy.data.worlds.new('Blush morning sky');world.use_nodes=True;scene.world=world
# The shared lighting setup below authors the physical and visible sky.

def area(name, loc, target, power, color, size, size_y=None):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
    if size_y:data.shape='RECTANGLE';data.size_y=size_y
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler();return obj
area('Light | broad ivory sky fill',(0,-8,10),(0,2,2),450,(.92,.92,1),14)
area('Light | warm diagonal sun',(7.5,10,11),(-2,-10,0),3200,(1,.79,.72),2)
area('Light | central window',(0,9,8),(0,-4,1),2600,(1,.91,.87),5,9)
area('Light | left lavender window',(-7,9,6),(-4,-3,2),1300,(.78,.83,1),3,8)
area('Light | right pearl window',(7,9,6),(4,-3,2),1600,(1,.86,.82),3,8)
sun=bpy.data.lights.new('Light | sun shadows','SUN');sun.energy=1.5;sun.angle=.12;sun.color=(1,.85,.73)
ob=bpy.data.objects.new(sun.name,sun);scene.collection.objects.link(ob);ob.rotation_euler=(math.radians(25),math.radians(-28),math.radians(-145))
# Low-density atmosphere supplies depth, not a screen overlay.
fog=bpy.data.materials.new('Air | fine sunlit haze');fog.use_nodes=True
nt=fog.node_tree;nt.nodes.clear();v=nt.nodes.new('ShaderNodeVolumePrincipled');v.inputs['Density'].default_value=.0022;v.inputs['Color'].default_value=(.86,.78,.79,1);v.inputs['Anisotropy'].default_value=.35
out=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(v.outputs['Volume'],out.inputs['Volume'])
cube('Atmosphere | atrium air',(0,15,10),(75,105,25),fog)
refine_arch_lighting(scene)

camera_data=bpy.data.cameras.new('Camera | reference composition');camera=bpy.data.objects.new(camera_data.name,camera_data);scene.collection.objects.link(camera)
camera.location=(0,-21,3.9)
camera.rotation_euler=(Vector((0,2,2.4))-camera.location).to_track_quat('-Z','Y').to_euler()
camera_data.lens=35;camera_data.sensor_width=36;camera_data.clip_end=300
camera_data.dof.use_dof=False
scene.camera=camera

# The environment carries no decorative copy. Keep only functional station labels.
for obj in list(bpy.data.objects):
    parent = obj
    belongs_to_station = False
    while parent:
        if parent.get('station') or parent.get('station_template'):
            belongs_to_station = True
            break
        parent = parent.parent
    if not belongs_to_station and (obj.type == 'FONT' or obj.name == 'Hero pool | fine centered rule'):
        bpy.data.objects.remove(obj, do_unlink=True)

scene.view_layers[0].use_pass_object_index = False
scene.use_nodes=True
nt=scene.node_tree;nt.nodes.clear()
rl=nt.nodes.new('CompositorNodeRLayers')
gl=nt.nodes.new('CompositorNodeGlare');gl.glare_type='FOG_GLOW';gl.quality='HIGH';gl.threshold=1.8;gl.size=7;gl.mix=-.91
out=nt.nodes.new('CompositorNodeComposite');nt.links.new(rl.outputs['Image'],gl.inputs['Image']);nt.links.new(gl.outputs['Image'],out.inputs['Image'])
scene['description']='Hyper post-onboarding atrium. Reconstructed as editable geometry from the supplied September 19 reference.'
scene['water_model']='Animated dispersive gravity waves with micro-ripple normals, physically transmissive Cycles surface. Not a fluid solver.'
scene.frame_set(1)
# Make the .blend immediately inspectable in its authored composition.
for screen in bpy.data.screens:
    for area_ui in screen.areas:
        if area_ui.type=='VIEW_3D':
            area_ui.spaces.active.region_3d.view_perspective='CAMERA'
            area_ui.spaces.active.shading.type='MATERIAL'
# Match browser hit areas to the rendered camera rather than guessing from the sketch.
from bpy_extras.object_utils import world_to_camera_view
bpy.context.view_layer.update()
portals=[]
for portal in props_data['portals']:
    x,y,z=portal['center'];w=portal['width'];h=portal['height']
    corners=[world_to_camera_view(scene,camera,Vector((x+dx*w/2,y-.15,z+dz*h/2))) for dx in (-1,1) for dz in (-1,1)]
    portals.append({'name':portal['name'],'left':min(p.x for p in corners),'top':1-max(p.y for p in corners),'width':max(p.x for p in corners)-min(p.x for p in corners),'height':max(p.y for p in corners)-min(p.y for p in corners)})
(OUT/'hotspots.json').write_text(json.dumps({'width':scene.render.resolution_x,'height':scene.render.resolution_y,'portals':portals},indent=2)+'\n')
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'hyper-atrium.blend'),compress=True)
if not args.save_only:
    scene.render.filepath=str(OUT/('preview.png' if args.preview else 'hyper-atrium.png'))
    bpy.ops.render.render(write_still=True)
