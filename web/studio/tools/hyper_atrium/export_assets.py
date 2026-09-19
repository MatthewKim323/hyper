"""Export independently reusable crystal stations from the authored Blender scene."""
from pathlib import Path
import sys
import math
import json
import bpy
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import props
ROOT=HERE.parents[1]
OUT=ROOT/'public/assets/hyper-atrium'
OUT.mkdir(parents=True,exist_ok=True)
scene=bpy.context.scene
materials={
 'stone':bpy.data.materials['Hyper | blush ivory honed limestone'],
 'glass':bpy.data.materials['Portals | optically clear rose crystal'],
 'pearl':bpy.data.materials['Hyper | luminous ivory pearl'],
 'metal':bpy.data.materials['Hyper | pale champagne satin metal'],
 'text':bpy.data.materials['Hyper | warm graphite lettering'],
 'glow':bpy.data.materials['Hyper | warm ivory seam light'],
 'portal_glass':bpy.data.materials['Portals | optically clear rose crystal'],
 'edge':bpy.data.materials['Portals | polished clear edge'],
 'paper':bpy.data.materials['Icons | milky lilac opal glass'],
 'white':bpy.data.materials['Icons | white enamel lettering'],
}
library=bpy.data.collections.new('Crystal library | reusable onboarding stations')
scene.collection.children.link(library)
variants=[
 ('accounts-payable','invoice',2.7,3.7),('wallet-identity','ethereum',2.0,3.4),
 ('audit-evidence','audit',2.0,3.4),('training-arena','cubes',2.2,3.4),
 ('approvals','rings',2.5,3.45),('crystal-tall',None,1.8,4.0),
 ('crystal-wide',None,2.7,3.4),('crystal-orbit','rings',2.1,3.65),
 ('crystal-stack','cubes',2.0,3.25),('crystal-clear',None,2.2,3.6),
]
manifest=[]
for index,(key,icon,width,height) in enumerate(variants):
    before=set(bpy.data.objects)
    props._portal('Crystal '+key,0,0,width,height,'',icon,materials)
    created=set(bpy.data.objects)-before
    parent=bpy.data.objects.new('Station | '+key,None)
    library.objects.link(parent)
    parent['station_template']=key
    for ob in created:
        for col in list(ob.users_collection):col.objects.unlink(ob)
        library.objects.link(ob)
        ob.parent=parent
    bpy.ops.object.select_all(action='DESELECT')
    parent.select_set(True)
    for ob in created:ob.select_set(True)
    bpy.context.view_layer.objects.active=parent
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'crystal-{key}.glb'),export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_cameras=False,export_lights=False,export_animations=False)
    manifest.append({'id':key,'url':f'/assets/hyper-atrium/crystal-{key}.glb','width':width,'height':height+.48,'labelHeight':.48+height*.275})
    parent.location=(30+(index%5)*4, (index//5)*6,0)
library.hide_render=True
library.hide_viewport=True
(OUT/'crystals.json').write_text(json.dumps({'templates':manifest},indent=2)+'\n')
(OUT/'scene.json').write_text(json.dumps({'width':2560,'height':1441,'camera':{'position':[0,-21,3.9],'target':[0,2,2.4],'lens':35,'sensorWidth':36},'templates':manifest},indent=2)+'\n')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/blender/hyper-atrium/hyper-atrium.blend'),compress=True)
