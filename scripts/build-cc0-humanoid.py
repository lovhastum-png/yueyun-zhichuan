from pathlib import Path

import bpy


PROJECT = Path(r"D:\实验室项目\越韵智传完整demo")
OUTPUT_DIR = PROJECT / "public" / "assets" / "3d-stage" / "cc0"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

scene = bpy.context.scene
armature = next(obj for obj in scene.objects if obj.type == "ARMATURE")

for obj in list(scene.objects):
    if obj.type in {"CAMERA", "LIGHT"}:
        bpy.data.objects.remove(obj, do_unlink=True)

armature.name = "CC0_Humanoid_Rig"
mesh_names = {
    "body.001": "CC0_Humanoid_Body",
    "baseMesh1_A1.001": "CC0_Humanoid_Head",
    "hair": "CC0_Humanoid_Hair",
    "eye.L": "CC0_Humanoid_Eye_L",
    "eye.R": "CC0_Humanoid_Eye_R",
}
for old_name, new_name in mesh_names.items():
    obj = bpy.data.objects.get(old_name)
    if obj:
        obj.name = new_name

for action in list(bpy.data.actions):
    if action.name not in {"run", "stand_free"}:
        bpy.data.actions.remove(action)

def find_image(fragment):
    image = next((image for image in bpy.data.images if fragment.lower() in image.name.lower()), None)
    if image:
        _ = tuple(image.size)
    if image and image.size[0] == 0:
        try:
            image.reload()
        except RuntimeError:
            return None
    return image if image and image.size[0] > 0 else None

def configure_material(material, image=None, base_color=(0.22, 0.16, 0.12, 1.0), roughness=0.72):
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.inputs["Base Color"].default_value = base_color
    shader.inputs["Roughness"].default_value = roughness
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    if image:
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        texture.interpolation = "Linear"
        links.new(texture.outputs["Color"], shader.inputs["Base Color"])

body_image = find_image("baseMesh_A1_body.png")
face_image = find_image("baseMesh_A1_face.png")
eye_image = find_image("black_eye.png")
material_assignments = {
    "CC0_Humanoid_Body": (body_image, (0.55, 0.29, 0.2, 1.0), 0.78),
    "CC0_Humanoid_Head": (face_image, (0.55, 0.29, 0.2, 1.0), 0.74),
    "CC0_Humanoid_Hair": (None, (0.018, 0.012, 0.01, 1.0), 0.58),
    "CC0_Humanoid_Eye_L": (eye_image, (0.012, 0.008, 0.006, 1.0), 0.24),
    "CC0_Humanoid_Eye_R": (eye_image, (0.012, 0.008, 0.006, 1.0), 0.24),
}
for object_name, (image, color, roughness) in material_assignments.items():
    obj = bpy.data.objects.get(object_name)
    if obj and obj.data.materials:
        configure_material(obj.data.materials[0], image, color, roughness)

for image in bpy.data.images:
    if image.source != "FILE" or not image.has_data:
        continue
    width, height = image.size
    longest = max(width, height)
    if longest > 1024:
        ratio = 1024 / longest
        image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))

bpy.context.view_layer.objects.active = armature
armature.select_set(True)
for obj in scene.objects:
    if obj.type == "MESH":
        obj.select_set(True)

available = {prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}
options = {
    "filepath": str(OUTPUT_DIR / "young-warrior.web.glb"),
    "export_format": "GLB",
    "use_selection": True,
    "export_apply": False,
    "export_animations": True,
    "export_animation_mode": "ACTIONS",
    "export_frame_range": True,
    "export_force_sampling": True,
    "export_skins": True,
    "export_morph": True,
    "export_image_format": "WEBP",
    "export_image_quality": 82,
    "export_texture_dir": "",
}
bpy.ops.export_scene.gltf(**{key: value for key, value in options.items() if key in available})

print(f"CC0_EXPORT={OUTPUT_DIR / 'young-warrior.web.glb'}")
