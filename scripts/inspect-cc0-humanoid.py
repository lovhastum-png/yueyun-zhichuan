import json

import bpy


scene = bpy.context.scene
report = {
    "objects": [
        {
            "name": obj.name,
            "type": obj.type,
            "parent": obj.parent.name if obj.parent else None,
            "dimensions": [round(value, 4) for value in obj.dimensions],
            "materials": [slot.material.name if slot.material else None for slot in obj.material_slots]
            if obj.type == "MESH"
            else [],
            "vertices": len(obj.data.vertices) if obj.type == "MESH" else None,
        }
        for obj in scene.objects
    ],
    "armatures": [
        {
            "name": obj.name,
            "bones": len(obj.data.bones),
            "bone_names": [bone.name for bone in obj.data.bones],
        }
        for obj in scene.objects
        if obj.type == "ARMATURE"
    ],
    "actions": [
        {"name": action.name, "frames": [round(value, 2) for value in action.frame_range]}
        for action in bpy.data.actions
    ],
    "images": [
        {"name": image.name, "path": image.filepath, "size": list(image.size)}
        for image in bpy.data.images
    ],
}

print("CC0_INSPECTION=" + json.dumps(report, ensure_ascii=False))
