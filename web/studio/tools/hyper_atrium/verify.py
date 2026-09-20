"""Verify the saved scene and reusable GLB library without rendering again."""
import bpy
import json
import struct
import sys
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from props import is_station_cover
OUT=ROOT/'assets/blender/hyper-atrium'
PUBLIC=ROOT/'public/assets/hyper-atrium'
scene=bpy.context.scene
library=bpy.data.collections.get('Crystal library | reusable onboarding stations')
assert library is not None
variants=[ob['station_template'] for ob in library.objects if 'station_template' in ob]
assert len(variants)==10 and len(set(variants))==10
for parent in (obj for obj in library.objects if 'station_template' in obj):
    relics=[obj for obj in parent.children_recursive if obj.get('station_relic') and obj.type=='MESH' and not obj.hide_render and not obj.hide_viewport and len(obj.data.polygons)>0]
    assert relics, f"Template {parent['station_template']} has no visible relic geometry"
covers=[obj for obj in scene.objects if is_station_cover(obj)]
assert len(covers)==30, 'Five scene stations and ten reusable templates retain two hidden aperture guides each'
assert all(obj.hide_render and obj.hide_viewport for obj in covers)
assert scene.camera is not None
assert bpy.data.objects['Atrium | monolithic blush limestone'].type=='MESH'
assert len(bpy.data.objects['Atrium | monolithic blush limestone'].data.polygons)>100
surface=bpy.data.objects['Water | flooded atrium']
def sample(frame):
    scene.frame_set(frame)
    obj=surface.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh=obj.to_mesh()
    points=[mesh.vertices[i].co.z for i in range(0,len(mesh.vertices),601)]
    obj.to_mesh_clear()
    return points
first=sample(1);second=sample(120)
assert max(abs(a-b) for a,b in zip(first,second))>0.005
scene.frame_set(1)
manifest=json.loads((PUBLIC/'scene.json').read_text())
assert len(manifest['templates'])==10
exported_relics={}
for template in manifest['templates']:
    path=PUBLIC/Path(template['url']).name
    with path.open('rb') as handle:
        magic,version,_=struct.unpack('<4sII',handle.read(12))
        assert magic==b'glTF' and version==2
        length,kind=struct.unpack('<I4s',handle.read(8))
        assert kind==b'JSON'
        gltf=json.loads(handle.read(length))
        assert not any('solid clear arched' in node.get('name','') or 'front polished rim' in node.get('name','') for node in gltf.get('nodes',[])), path.name
        relics=[]
        for node in gltf.get('nodes',[]):
            if 'mesh' not in node or any(part in node.get('name','').lower() for part in ('plinth','light seam','title','enter','solid clear arched','front polished rim')):
                continue
            primitives=gltf['meshes'][node['mesh']].get('primitives',[])
            if any(gltf['accessors'][primitive['attributes']['POSITION']]['count']>0 for primitive in primitives):
                relics.append(node.get('name',''))
        assert relics, f'{path.name} contains no non-plinth relic geometry'
        exported_relics[template['id']]=len(relics)
sun=next(ob for ob in scene.objects if ob.type=='LIGHT' and ob.data.type=='SUN')
toward_sun=(sun.rotation_euler.to_quaternion() @ Vector((0,0,1))).normalized()
wall=bpy.data.objects['Atrium | monolithic blush limestone'].evaluated_get(bpy.context.evaluated_depsgraph_get())
inverse=wall.matrix_world.inverted()
illumination={}
for name,point in {'pearl center':(0,1.5,3.16),'pearl left':(-1.2,1.5,3.16),'pearl right':(1.2,1.5,3.16),'pearl crown':(0,1.5,4.6),'basin center':(0,0,.61)}.items():
    blocked=wall.ray_cast(inverse @ Vector(point), (inverse.to_3x3() @ toward_sun).normalized(), distance=200)[0]
    illumination[name]=not blocked
    assert not blocked, f'The rear wall blocks direct sunlight from {name}'
result={'blender':bpy.app.version_string,'station_templates':variants,'water_vertices':len(surface.data.vertices),'water_animation_verified':True,'camera':list(scene.camera.location),'resolution':[scene.render.resolution_x,scene.render.resolution_y],'packed_fonts':sum(1 for font in bpy.data.fonts if font.packed_file),'glb_assets_verified':10}
result['aperture_sunlight_verified']=illumination
result['uncovered_relics_verified']={'hidden_aperture_guides':len(covers),'cover_free_station_assets':10,'relic_meshes_by_template':exported_relics}
marble=bpy.data.materials.get('Hyper | blush ivory honed limestone')
if marble and marble.get('marble_world_scale'):
    shader=next(node for node in marble.node_tree.nodes if node.type=='BSDF_PRINCIPLED')
    assert all(shader.inputs[name].is_linked for name in ('Base Color','Roughness','Normal'))
    assert marble.get('runtime_surface')=='marble'
    result['marble_verified']={'world_scale':marble['marble_world_scale'],'nodes':len(marble.node_tree.nodes),'channels':['color','roughness','microbump']}
side=json.loads(scene.get('atrium_side_light','null'))
if side:
    baffle=bpy.data.objects[side['occluder']['name']].evaluated_get(bpy.context.evaluated_depsgraph_get())
    inverse=baffle.matrix_world.inverted()
    source=Vector(side['position'])
    for aperture in side['apertures']:
        target=Vector(aperture['target'])
        assert not baffle.ray_cast(inverse @ target,(inverse.to_3x3() @ (source-target)).normalized(),distance=200)[0], aperture['name']
        if scene.get('hyper_key_fill_balance') and aperture['name']!='pearl':
            projected=world_to_camera_view(scene,scene.camera,target)
            assert 0<projected.x<1 and 0<projected.y<1, aperture['name']+' target is outside the composition'
    projections=[world_to_camera_view(scene,scene.camera,baffle.matrix_world @ vertex.co) for vertex in baffle.data.vertices]
    assert all(point.x>1 for point in projections), 'Side baffle enters the reference camera frame'
    result['side_aperture_verified']={'targets':[a['name'] for a in side['apertures']],'off_camera':True,'blender_type':bpy.data.objects['Fidelity | warm side aperture'].data.type}
(OUT/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
