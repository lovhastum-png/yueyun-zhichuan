import json
import shutil
import tempfile
from pathlib import Path

import bpy


PROJECT = Path(r"D:\实验室项目\越韵智传完整demo")
SOURCE = PROJECT / "source" / "3d-stage" / "vroid" / "yueju-base.vrm"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

temporary = Path(tempfile.gettempdir()) / "yueju-vroid-inspect.glb"
shutil.copyfile(SOURCE, temporary)
bpy.ops.import_scene.gltf(filepath=str(temporary))

bpy.context.view_layer.update()
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]


def material_bounds(obj):
    result = {}
    for material_index, slot in enumerate(obj.material_slots):
        if not slot.material:
            continue
        vertex_indices = {
            vertex_index
            for polygon in obj.data.polygons
            if polygon.material_index == material_index
            for vertex_index in polygon.vertices
        }
        if not vertex_indices:
            continue
        coordinates = [obj.data.vertices[index].co for index in vertex_indices]
        result[slot.material.name] = {
            "vertices": len(vertex_indices),
            "min": [round(min(coordinate[axis] for coordinate in coordinates), 4) for axis in range(3)],
            "max": [round(max(coordinate[axis] for coordinate in coordinates), 4) for axis in range(3)],
        }
    return result

report = {
    "objects": len(bpy.context.scene.objects),
    "meshes": [
        {
            "name": obj.name,
            "vertices": len(obj.data.vertices),
            "dimensions": [round(value, 4) for value in obj.dimensions],
            "parent": obj.parent.name if obj.parent else None,
            "modifiers": [modifier.type for modifier in obj.modifiers],
            "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
            "material_bounds": material_bounds(obj),
        }
        for obj in meshes
    ],
    "armatures": [
        {
            "name": obj.name,
            "bones": len(obj.data.bones),
            "bone_names": [bone.name for bone in obj.data.bones],
            "dimensions": [round(value, 4) for value in obj.dimensions],
            "key_bones": {
                name: {
                    "head": [round(value, 4) for value in obj.data.bones[name].head_local],
                    "tail": [round(value, 4) for value in obj.data.bones[name].tail_local],
                }
                for name in (
                    "J_Bip_C_Hips",
                    "J_Bip_C_Chest",
                    "J_Bip_C_UpperChest",
                    "J_Bip_C_Head",
                    "J_Bip_L_UpperArm",
                    "J_Bip_L_LowerArm",
                    "J_Bip_L_Hand",
                    "J_Bip_L_UpperLeg",
                    "J_Bip_L_Foot",
                )
                if name in obj.data.bones
            },
        }
        for obj in armatures
    ],
}

print("VRM_INSPECTION=" + json.dumps(report, ensure_ascii=False))
