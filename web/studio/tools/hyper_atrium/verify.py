"""Verify the saved scene and reusable GLB library without rendering again."""
import bpy
import json
from pathlib import Path
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
result={'blender':bpy.app.version_string,'station_templates':variants,'water_vertices':len(surface.data.vertices),'water_animation_verified':True,'camera':list(scene.camera.location),'resolution':[scene.render.resolution_x,scene.render.resolution_y],'packed_fonts':sum(1 for font in bpy.data.fonts if font.packed_file),'glb_assets_verified':10}
(OUT/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
