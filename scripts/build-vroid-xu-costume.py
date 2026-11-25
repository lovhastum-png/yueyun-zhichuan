import math
import shutil
import tempfile
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


PROJECT = Path(r"D:\实验室项目\越韵智传完整demo")
SOURCE_VRM = PROJECT / "source" / "3d-stage" / "vroid" / "yueju-base.vrm"
SOURCE_BLEND = PROJECT / "source" / "3d-stage" / "vroid" / "xu-xiaosheng-vroid-costume.blend"
PUBLIC_DIR = PROJECT / "public" / "assets" / "3d-stage" / "vroid"
PUBLIC_GLB = PUBLIC_DIR / "xu-xiaosheng-vroid-costume.glb"
PREVIEW = PUBLIC_DIR / "xu-xiaosheng-vroid-costume-preview.png"


def material(name, color, metallic=0.0, roughness=0.55):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def add_armature_binding(obj, armature, weights):
    for group_name, vertex_weights in weights.items():
        group = obj.vertex_groups.new(name=group_name)
        for vertex_index, weight in vertex_weights:
            if weight > 0.0001:
                group.add([vertex_index], weight, "REPLACE")
    modifier = obj.modifiers.new(name="VRoid Skeleton", type="ARMATURE")
    modifier.object = armature
    obj.parent = armature


def smooth_mesh(obj, bevel=0.006):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    if bevel:
        modifier = obj.modifiers.new(name="Soft tailoring", type="BEVEL")
        modifier.width = bevel
        modifier.segments = 2


def build_vertical_robe(name, rings, segments, mat, armature, weight_mode):
    vertices = []
    faces = []
    for z, radius_x, radius_y in rings:
        for segment in range(segments):
            angle = (segment / segments) * math.tau
            vertices.append((radius_x * math.cos(angle), radius_y * math.sin(angle), z))
    for ring_index in range(len(rings) - 1):
        row = ring_index * segments
        next_row = (ring_index + 1) * segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((row + segment, row + following, next_row + following, next_row + segment))
    faces.append(tuple(range(segments - 1, -1, -1)))
    top = (len(rings) - 1) * segments
    faces.append(tuple(top + i for i in range(segments)))

    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)

    weights = {}
    for vertex in mesh.vertices:
        z = vertex.co.z
        if weight_mode == "neck":
            weights.setdefault("J_Bip_C_Chest", []).append((vertex.index, 0.72))
            weights.setdefault("J_Bip_C_Neck", []).append((vertex.index, 0.28))
        elif weight_mode == "skirt":
            weights.setdefault("J_Bip_C_Hips", []).append((vertex.index, 1.0))
        else:
            hips = max(0.0, min(1.0, (1.14 - z) / 0.22))
            chest = max(0.0, min(1.0, (z - 1.16) / 0.22))
            spine = max(0.0, 1.0 - hips - chest)
            total = max(0.001, hips + spine + chest)
            weights.setdefault("J_Bip_C_Hips", []).append((vertex.index, hips / total))
            weights.setdefault("J_Bip_C_Spine", []).append((vertex.index, spine / total))
            weights.setdefault("J_Bip_C_Chest", []).append((vertex.index, chest / total))
    add_armature_binding(obj, armature, weights)
    smooth_mesh(obj)
    return obj


def build_trouser_leg(side, armature, pants_mat):
    sign = -1 if side == "L" else 1
    rings = [
        (0.13, 0.115, 0.105, 0.12),
        (0.34, 0.12, 0.11, 0.115),
        (0.62, 0.135, 0.12, 0.12),
        (0.84, 0.16, 0.135, 0.115),
        (0.98, 0.19, 0.145, 0.10),
    ]
    segments = 28
    vertices = []
    faces = []
    for z, radius_x, radius_y, center_x in rings:
        for segment in range(segments):
            angle = (segment / segments) * math.tau
            vertices.append(
                (
                    sign * center_x + radius_x * math.cos(angle),
                    radius_y * math.sin(angle),
                    z,
                )
            )
    for ring_index in range(len(rings) - 1):
        row = ring_index * segments
        next_row = (ring_index + 1) * segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((row + segment, row + following, next_row + following, next_row + segment))
    faces.append(tuple(range(segments - 1, -1, -1)))
    top = (len(rings) - 1) * segments
    faces.append(tuple(top + index for index in range(segments)))

    mesh = bpy.data.meshes.new(f"Costume_Duanda_Pants_{side}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(f"Costume_Duanda_Pants_{side}", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(pants_mat)

    upper_name = f"J_Bip_{side}_UpperLeg"
    lower_name = f"J_Bip_{side}_LowerLeg"
    weights = {upper_name: [], lower_name: []}
    for vertex in mesh.vertices:
        upper = max(0.0, min(1.0, (vertex.co.z - 0.30) / 0.34))
        weights[upper_name].append((vertex.index, upper))
        weights[lower_name].append((vertex.index, 1.0 - upper))
    add_armature_binding(obj, armature, weights)
    smooth_mesh(obj, bevel=0.004)
    return obj


def build_sleeve(side, armature, robe_mat):
    sign = -1 if side == "L" else 1
    positions = [0.145, 0.27, 0.38, 0.50, 0.615]
    sizes = [(0.105, 0.12), (0.11, 0.14), (0.115, 0.16), (0.12, 0.18), (0.125, 0.20)]
    segments = 20
    vertices = []
    faces = []
    for position, (radius_y, radius_z) in zip(positions, sizes):
        for segment in range(segments):
            angle = (segment / segments) * math.tau
            vertices.append(
                (
                    sign * position,
                    -0.005 + radius_y * math.cos(angle),
                    1.405 + radius_z * math.sin(angle),
                )
            )
    for ring_index in range(len(positions) - 1):
        row = ring_index * segments
        next_row = (ring_index + 1) * segments
        for segment in range(segments):
            following = (segment + 1) % segments
            faces.append((row + segment, row + following, next_row + following, next_row + segment))
    faces.append(tuple(range(segments - 1, -1, -1)))

    mesh = bpy.data.meshes.new(f"Costume_Sleeve_{side}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(f"Costume_Sleeve_{side}", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(robe_mat)

    upper_name = f"J_Bip_{side}_UpperArm"
    lower_name = f"J_Bip_{side}_LowerArm"
    weights = {upper_name: [], lower_name: []}
    for vertex in mesh.vertices:
        distance = abs(vertex.co.x)
        lower = max(0.0, min(1.0, (distance - 0.29) / 0.18))
        weights[upper_name].append((vertex.index, 1.0 - lower))
        weights[lower_name].append((vertex.index, lower))
    add_armature_binding(obj, armature, weights)
    smooth_mesh(obj, bevel=0.004)
    return obj


def build_cuff(side, armature, gold_mat, lining_mat):
    sign = -1 if side == "L" else 1
    bpy.ops.mesh.primitive_torus_add(major_radius=0.198, minor_radius=0.016, major_segments=32, minor_segments=8)
    cuff = bpy.context.object
    cuff.name = f"Costume_Cuff_{side}"
    cuff.rotation_euler[1] = math.pi / 2
    cuff.scale.y = 0.72
    cuff.location = (sign * 0.612, -0.005, 1.405)
    cuff.data.materials.append(gold_mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    weights = {f"J_Bip_{side}_LowerArm": [(vertex.index, 1.0) for vertex in cuff.data.vertices]}
    add_armature_binding(cuff, armature, weights)

    bpy.ops.mesh.primitive_torus_add(major_radius=0.174, minor_radius=0.011, major_segments=32, minor_segments=8)
    lining = bpy.context.object
    lining.name = f"Costume_CuffLining_{side}"
    lining.rotation_euler[1] = math.pi / 2
    lining.scale.y = 0.72
    lining.location = (sign * 0.618, -0.005, 1.405)
    lining.data.materials.append(lining_mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    weights = {f"J_Bip_{side}_LowerArm": [(vertex.index, 1.0) for vertex in lining.data.vertices]}
    add_armature_binding(lining, armature, weights)
    return cuff, lining


def curve_mesh(name, points, bevel, mat, armature, bone_name):
    curve = bpy.data.curves.new(name + "Curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = bevel
    curve.bevel_resolution = 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    weights = {bone_name: [(vertex.index, 1.0) for vertex in obj.data.vertices]}
    add_armature_binding(obj, armature, weights)
    return obj


def flat_weighted_mesh(name, vertices, faces, mat, armature, bone_name):
    mesh = bpy.data.meshes.new(name + "Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    weights = {bone_name: [(vertex.index, 1.0) for vertex in mesh.vertices]}
    add_armature_binding(obj, armature, weights)
    bevel = obj.modifiers.new(name="Soft edge", type="BEVEL")
    bevel.width = 0.004
    bevel.segments = 2
    return obj


def build_back_neck_guard(armature, inner_mat):
    vertices = [
        (-0.14, -0.135, 1.385),
        (0.14, -0.135, 1.385),
        (0.092, -0.080, 1.505),
        (-0.092, -0.080, 1.505),
        (-0.14, -0.075, 1.385),
        (0.14, -0.075, 1.385),
        (0.092, -0.045, 1.505),
        (-0.092, -0.045, 1.505),
    ]
    faces = [
        (0, 1, 2, 3),
        (7, 6, 5, 4),
        (0, 4, 5, 1),
        (3, 2, 6, 7),
        (0, 3, 7, 4),
        (1, 5, 6, 2),
    ]
    mesh = bpy.data.meshes.new("Costume_Neck_GuardMesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("Costume_Neck_Guard", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(inner_mat)
    weights = {
        "J_Bip_C_Chest": [(vertex.index, 0.72) for vertex in mesh.vertices],
        "J_Bip_C_Neck": [(vertex.index, 0.28) for vertex in mesh.vertices],
    }
    add_armature_binding(obj, armature, weights)
    bevel = obj.modifiers.new(name="Neck guard tailoring", type="BEVEL")
    bevel.width = 0.005
    bevel.segments = 2
    return obj


def add_box(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new(name="Jewellery bevel", type="BEVEL")
    bevel.width = 0.012
    bevel.segments = 3
    return obj


def parent_to_bone(obj, armature, bone_name):
    matrix_world = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = matrix_world


def build_crown(armature, dark_mat, robe_mat, gold_mat, jade_mat):
    parts = []
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=20, location=(0, -0.003, 1.735))
    cap = bpy.context.object
    cap.name = "Costume_Crown_Cap"
    cap.scale = (0.128, 0.112, 0.07)
    cap.data.materials.append(dark_mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    parts.append(cap)

    band = add_box("Costume_Crown_Band", (0, 0.095, 1.72), (0.16, 0.025, 0.035), robe_mat)
    parts.append(band)
    crest = add_box("Costume_Crown_Crest", (0, 0.06, 1.825), (0.09, 0.035, 0.115), gold_mat)
    parts.append(crest)
    inset = add_box("Costume_Crown_Inset", (0, 0.098, 1.825), (0.056, 0.012, 0.078), robe_mat)
    parts.append(inset)

    for sign in (-1, 1):
        wing = add_box(
            f"Costume_Crown_Wing_{'L' if sign < 0 else 'R'}",
            (sign * 0.17, 0.02, 1.81),
            (0.105, 0.022, 0.026),
            gold_mat,
        )
        wing.rotation_euler[1] = sign * 0.16
        parts.append(wing)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, location=(sign * 0.095, 0.101, 1.825))
        jade = bpy.context.object
        jade.name = f"Costume_Crown_Jade_{'L' if sign < 0 else 'R'}"
        jade.scale = (0.022, 0.012, 0.032)
        jade.data.materials.append(jade_mat)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        parts.append(jade)

    for obj in parts:
        parent_to_bone(obj, armature, "J_Bip_C_Head")
    return parts


def aim_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
SOURCE_BLEND.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

temporary = Path(tempfile.gettempdir()) / "yueju-vroid-costume-source.glb"
shutil.copyfile(SOURCE_VRM, temporary)
bpy.ops.import_scene.gltf(filepath=str(temporary))

armature = next(obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE")
for obj in list(bpy.context.scene.objects):
    if obj.name.startswith("Icosphere"):
        bpy.data.objects.remove(obj, do_unlink=True)

for obj in bpy.context.scene.objects:
    if obj.type != "MESH" or obj.name != "Body":
        continue
    hidden_materials = {
        index
        for index, slot in enumerate(obj.material_slots)
        if slot.material and "Tops_01_CLOTH" in slot.material.name
    }
    if hidden_materials:
        editable = bmesh.new()
        editable.from_mesh(obj.data)
        removable = [face for face in editable.faces if face.material_index in hidden_materials]
        bmesh.ops.delete(editable, geom=removable, context="FACES")
        editable.to_mesh(obj.data)
        editable.free()
        obj.data.update()

for mat in bpy.data.materials:
    if "Tops_01_CLOTH" not in mat.name:
        continue
    mat.diffuse_color[3] = 0.0
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Alpha"].default_value = 0.0
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "DITHERED"

robe_mat = material("VRoid_Robe_Main", (0.28, 0.008, 0.014), metallic=0.02, roughness=0.42)
gold_mat = material("VRoid_Robe_Gold", (0.9, 0.57, 0.12), metallic=0.72, roughness=0.25)
lining_mat = material("VRoid_Robe_Lining", (0.96, 0.83, 0.53), metallic=0.08, roughness=0.48)
inner_mat = material("VRoid_Robe_Inner", (0.11, 0.012, 0.018), metallic=0.0, roughness=0.68)
dark_mat = material("VRoid_Crown_Dark", (0.018, 0.014, 0.018), metallic=0.28, roughness=0.3)
jade_mat = material("VRoid_Crown_Jade", (0.12, 0.58, 0.48), metallic=0.12, roughness=0.26)

costume_objects = []
costume_objects.append(
    build_vertical_robe(
        "Costume_Torso",
        [(0.94, 0.195, 0.132), (1.08, 0.205, 0.137), (1.25, 0.218, 0.145), (1.41, 0.225, 0.15)],
        40,
        robe_mat,
        armature,
        "torso",
    )
)
costume_objects.append(build_back_neck_guard(armature, inner_mat))
costume_objects.append(
    build_vertical_robe(
        "Costume_Skirt",
        [(0.12, 0.38, 0.215), (0.30, 0.365, 0.205), (0.62, 0.31, 0.18), (0.94, 0.205, 0.137), (1.04, 0.205, 0.137)],
        48,
        robe_mat,
        armature,
        "skirt",
    )
)

costume_objects.append(
    build_vertical_robe(
        "Costume_Duanda_Belt",
        [(0.90, 0.225, 0.15), (0.99, 0.225, 0.15), (1.03, 0.21, 0.142)],
        40,
        gold_mat,
        armature,
        "skirt",
    )
)
for side in ("L", "R"):
    costume_objects.append(build_trouser_leg(side, armature, inner_mat))

for side in ("L", "R"):
    costume_objects.append(build_sleeve(side, armature, robe_mat))

costume_objects.append(
    curve_mesh(
        "Costume_Collar_Gold",
        [(-0.18, 0.151, 1.405), (-0.08, 0.162, 1.29), (0, 0.165, 1.205), (0.08, 0.162, 1.29), (0.18, 0.151, 1.405)],
        0.014,
        gold_mat,
        armature,
        "J_Bip_C_Chest",
    )
)
costume_objects.append(
    flat_weighted_mesh(
        "Costume_Inner_Collar",
        [(-0.125, 0.154, 1.405), (0.125, 0.154, 1.405), (0.052, 0.135, 1.472), (-0.052, 0.135, 1.472)],
        [(0, 1, 2, 3)],
        inner_mat,
        armature,
        "J_Bip_C_Chest",
    )
)
costume_objects.append(
    curve_mesh(
        "Costume_Collar_Lining",
        [(-0.165, 0.168, 1.405), (-0.075, 0.176, 1.30), (0, 0.18, 1.225), (0.075, 0.176, 1.30), (0.165, 0.168, 1.405)],
        0.007,
        lining_mat,
        armature,
        "J_Bip_C_Chest",
    )
)

for index, z in enumerate((0.18, 0.205)):
    points = []
    for step in range(33):
        angle = (step / 32) * math.tau
        points.append((0.365 * math.cos(angle), 0.21 * math.sin(angle), z))
    points.append(points[0])
    costume_objects.append(curve_mesh(f"Costume_Hem_{index}", points, 0.012 if index == 0 else 0.006, gold_mat if index == 0 else lining_mat, armature, "J_Bip_C_Hips"))

dragon_points = []
for step in range(70):
    angle = step / 69 * math.tau * 1.65
    radius = 0.09 - step / 69 * 0.045
    dragon_points.append((radius * math.cos(angle), 0.158, 1.105 + radius * math.sin(angle)))
costume_objects.append(curve_mesh("Costume_Dragon_Medallion", dragon_points, 0.008, gold_mat, armature, "J_Bip_C_Spine"))

for sign in (-1, 1):
    flower_points = []
    for step in range(97):
        angle = (step / 96) * math.tau
        radius = 0.052 + 0.015 * math.sin(angle * 5)
        flower_points.append((sign * 0.14 + radius * math.cos(angle), 0.178, 0.73 + radius * math.sin(angle)))
    costume_objects.append(curve_mesh(f"Costume_Peony_{sign}", flower_points, 0.006, gold_mat, armature, "J_Bip_C_Hips"))

crown_parts = build_crown(armature, dark_mat, robe_mat, gold_mat, jade_mat)
costume_objects.extend(crown_parts)

bpy.context.view_layer.update()

bpy.ops.object.select_all(action="DESELECT")
armature.select_set(True)
for obj in costume_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.export_scene.gltf(
    filepath=str(PUBLIC_GLB),
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_animations=False,
    export_skins=True,
    export_morph=False,
    export_materials="EXPORT",
)

bpy.ops.object.select_all(action="DESELECT")

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 900
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(PREVIEW)
scene.render.film_transparent = False
scene.render.image_settings.color_mode = "RGBA"
scene.world.color = (0.025, 0.028, 0.026)

for side, target_location in (("L", (-0.46, 0.08, 1.02)), ("R", (0.46, 0.08, 1.08))):
    target = bpy.data.objects.new(f"PreviewIK_{side}", None)
    target.empty_display_type = "SPHERE"
    target.empty_display_size = 0.04
    target.location = target_location
    bpy.context.collection.objects.link(target)
    lower_arm = armature.pose.bones.get(f"J_Bip_{side}_LowerArm")
    if lower_arm:
        constraint = lower_arm.constraints.new("IK")
        constraint.target = target
        constraint.chain_count = 2

bpy.context.view_layer.update()

bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0.02))
floor = bpy.context.object
floor.name = "PreviewFloor"
floor.data.materials.append(material("PreviewFloorMaterial", (0.055, 0.065, 0.06), roughness=0.88))

bpy.ops.object.light_add(type="AREA", location=(-3.2, 3.8, 5.0))
key = bpy.context.object
key.name = "PreviewKey"
key.data.energy = 900
key.data.shape = "DISK"
key.data.size = 4.0
aim_at(key, (0, 0, 1.05))

bpy.ops.object.light_add(type="AREA", location=(3.2, 1.5, 3.2))
fill = bpy.context.object
fill.name = "PreviewFill"
fill.data.energy = 650
fill.data.color = (0.48, 0.72, 0.8)
fill.data.size = 3.0
aim_at(fill, (0, 0, 1.1))

bpy.ops.object.light_add(type="AREA", location=(0, 2.2, 3.7))
rim = bpy.context.object
rim.name = "PreviewRim"
rim.data.energy = 1000
rim.data.color = (1.0, 0.36, 0.18)
rim.data.size = 2.5
aim_at(rim, (0, 0, 1.2))

bpy.ops.object.camera_add(location=(2.75, 4.8, 2.35))
camera = bpy.context.object
camera.name = "PreviewCamera"
camera.data.lens = 66
aim_at(camera, (0, 0, 0.99))
scene.camera = camera

scene.view_settings.look = "AgX - Medium High Contrast"
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE_BLEND))
bpy.ops.render.render(write_still=True)

print(f"VRM_COSTUME_GLB={PUBLIC_GLB}")
print(f"VRM_COSTUME_BLEND={SOURCE_BLEND}")
print(f"VRM_COSTUME_PREVIEW={PREVIEW}")
