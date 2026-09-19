"""Apply the final bounded stone and pearl refinements to the saved scene."""
from pathlib import Path
import sys

import bpy

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from props import finish_ground_stone

SOURCE = HERE.parents[1] / "assets/blender/hyper-atrium/hyper-atrium.blend"
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
stones = [obj for obj in bpy.data.objects if obj.name.startswith("Ground | weathered marble")]
assert len(stones) == 6
for stone in stones:
    finish_ground_stone(stone)
material = bpy.data.materials["Hero | graduated rose quartz and pearl"]
shader = next(node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
shader.inputs["Roughness"].default_value = 0.19
shader.inputs["Coat Roughness"].default_value = 0.15
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
print("DETAILS_UPDATED", len(stones), "rounded stones; hero roughness", 0.19)
