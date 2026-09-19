"""Verify the saved scene and reusable GLB library without rendering again."""
import bpy
import json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'assets/blender/hyper-atrium'
PUBLIC=ROOT/'public/assets/hyper-atrium'
scene=bpy.context.scene
library=bpy.data.collections.get('Crystal library | reusable onboarding stations')
assert library is not None
variants=[ob['station_template'] for ob in library.objects if 'station_template' in ob]
assert len(variants)==10 and len(set(variants))==10
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
for template in manifest['templates']:
    path=PUBLIC/Path(template['url']).name
    with path.open('rb') as handle:assert handle.read(4)==b'glTF'
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
(OUT/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
