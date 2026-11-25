import json
import shutil
import sys
import tempfile
from pathlib import Path

import bpy


values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if not values:
    raise SystemExit("usage: blender --background --python inspect-vrm-garments.py -- INPUT.vrm")

source = Path(values[0]).resolve()
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
temporary = Path(tempfile.gettempdir()) / "yueju-vrm-garment-inspect.glb"
shutil.copyfile(source, temporary)
bpy.ops.import_scene.gltf(filepath=str(temporary))

result = {}
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    groups = {}
    for group in obj.vertex_groups:
        assigned = 0
        total_weight = 0.0
        for vertex in obj.data.vertices:
            for membership in vertex.groups:
                if membership.group == group.index and membership.weight > 0.0001:
                    assigned += 1
                    total_weight += membership.weight
                    break
        if assigned:
            groups[group.name] = {"vertices": assigned, "weight": round(total_weight, 3)}

    materials = {}
    for slot in obj.material_slots:
        material = slot.material
        if not material:
            continue
        textures = []
        if material.use_nodes:
            for node in material.node_tree.nodes:
                if node.type == "TEX_IMAGE" and node.image:
                    textures.append({
                        "name": node.image.name,
                        "size": [int(node.image.size[0]), int(node.image.size[1])],
                        "colorspace": node.image.colorspace_settings.name,
                    })
        materials[material.name] = textures

    result[obj.name] = {
        "parent": obj.parent.name if obj.parent else None,
        "groups": groups,
        "materials": materials,
    }

print("VRM_GARMENTS=" + json.dumps(result, ensure_ascii=False))
