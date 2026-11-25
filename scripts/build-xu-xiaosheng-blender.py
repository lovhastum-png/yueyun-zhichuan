import math
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = PROJECT_ROOT / "public" / "assets" / "3d-stage" / "xu-xiaosheng"
SOURCE_ROOT = PROJECT_ROOT / "source" / "3d-stage" / "xu-xiaosheng"
GLB_PATH = PUBLIC_ROOT / "xu-xiaosheng-character.glb"
PREVIEW_PATH = PUBLIC_ROOT / "previews" / "xu-xiaosheng-preview.png"
BLEND_PATH = SOURCE_ROOT / "xu-xiaosheng-character.blend"

PUBLIC_ROOT.mkdir(parents=True, exist_ok=True)
PREVIEW_PATH.parent.mkdir(parents=True, exist_ok=True)
SOURCE_ROOT.mkdir(parents=True, exist_ok=True)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.armatures,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def make_material(name, base_color, metallic=0.0, roughness=0.65, sheen=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*base_color, 1.0)
    material.metallic = metallic
    material.roughness = roughness
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*base_color, 1.0)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    if "Coat Weight" in principled.inputs:
        principled.inputs["Coat Weight"].default_value = 0.14 if metallic < 0.5 else 0.24
    if "Sheen Weight" in principled.inputs:
        principled.inputs["Sheen Weight"].default_value = sheen
    return material


def set_smooth(obj):
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True


def add_uv_sphere(name, location, scale, material, segments=48, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    set_smooth(obj)
    return obj


def add_cube(name, location, scale, material, bevel=0.03, rotation=None):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    if rotation:
        obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    if bevel:
        modifier = obj.modifiers.new("Soft bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 3
    return obj


def add_cylinder(name, location, radius, depth, material, vertices=32, rotation=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    obj.data.materials.append(material)
    set_smooth(obj)
    bevel = obj.modifiers.new("Edge softness", "BEVEL")
    bevel.width = min(radius * 0.12, 0.025)
    bevel.segments = 2
    return obj


def add_torus(name, location, major_radius, minor_radius, material, rotation=None, major_segments=64):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=12,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    if rotation:
        obj.rotation_euler = rotation
    obj.data.materials.append(material)
    set_smooth(obj)
    return obj


def add_curve(name, points, material, bevel=0.012, cyclic=False, resolution=2):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = bevel
    curve.bevel_resolution = 3
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coordinate in zip(spline.bezier_points, points):
        point.co = coordinate
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def add_ring_curve(name, center, radius_x, radius_y, material, bevel=0.012, plane="XY", segments=64):
    points = []
    for index in range(segments):
        angle = index / segments * math.tau
        if plane == "XZ":
            points.append((center[0] + math.cos(angle) * radius_x, center[1], center[2] + math.sin(angle) * radius_y))
        elif plane == "YZ":
            points.append((center[0], center[1] + math.cos(angle) * radius_x, center[2] + math.sin(angle) * radius_y))
        else:
            points.append((center[0] + math.cos(angle) * radius_x, center[1] + math.sin(angle) * radius_y, center[2]))
    return add_curve(name, points, material, bevel=bevel, cyclic=True)


def add_segment(name, start, end, radius, material, vertices=28):
    start_v = Vector(start)
    end_v = Vector(end)
    midpoint = (start_v + end_v) * 0.5
    direction = end_v - start_v
    obj = add_cylinder(name, midpoint, radius, direction.length, material, vertices=vertices)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    obj.rotation_mode = "XYZ"
    return obj


def add_extruded_plate(name, outline, y_front, y_back, material, bevel=0.025):
    vertices = [(x, y_front, z) for x, z in outline] + [(x, y_back, z) for x, z in outline]
    count = len(outline)
    faces = []
    faces.append(tuple(range(count)))
    faces.append(tuple(range(count, count * 2))[::-1])
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((index, next_index, count + next_index, count + index))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    bevel_modifier = obj.modifiers.new("Rounded plate edge", "BEVEL")
    bevel_modifier.width = bevel
    bevel_modifier.segments = 3
    return obj


def create_armature():
    armature_data = bpy.data.armatures.new("YueOperaRig")
    armature = bpy.data.objects.new("XuXiaosheng_Rig", armature_data)
    bpy.context.collection.objects.link(armature)
    armature.show_in_front = True
    armature["character"] = "徐派小生"
    armature["outfit_slot"] = "xu-xiaosheng-mangpao"
    armature["version"] = "1.0.0"
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def bone(name, head, tail, parent=None):
        edit_bone = armature_data.edit_bones.new(name)
        edit_bone.head = head
        edit_bone.tail = tail
        if parent:
            edit_bone.parent = armature_data.edit_bones[parent]
        return edit_bone

    bone("Root", (0, 0, 0), (0, 0, 0.22))
    bone("Hips", (0, 0, 0.9), (0, 0, 1.22), "Root")
    bone("Spine", (0, 0, 1.22), (0, 0, 1.92), "Hips")
    bone("Chest", (0, 0, 1.92), (0, 0, 2.34), "Spine")
    bone("Neck", (0, 0, 2.34), (0, 0, 2.54), "Chest")
    bone("Head", (0, 0, 2.54), (0, 0, 3.06), "Neck")

    for suffix, side in (("L", 1), ("R", -1)):
        bone(f"Shoulder.{suffix}", (side * 0.10, 0, 2.30), (side * 0.38, 0, 2.29), "Chest")
        bone(f"UpperArm.{suffix}", (side * 0.38, 0, 2.29), (side * 0.83, 0, 2.03), f"Shoulder.{suffix}")
        bone(f"Forearm.{suffix}", (side * 0.83, 0, 2.03), (side * 1.18, 0, 1.76), f"UpperArm.{suffix}")
        bone(f"Hand.{suffix}", (side * 1.18, 0, 1.76), (side * 1.38, -0.01, 1.63), f"Forearm.{suffix}")
        bone(f"Thigh.{suffix}", (side * 0.18, 0, 1.02), (side * 0.18, 0, 0.58), "Hips")
        bone(f"Shin.{suffix}", (side * 0.18, 0, 0.58), (side * 0.18, 0, 0.15), f"Thigh.{suffix}")
        bone(f"Foot.{suffix}", (side * 0.18, 0, 0.15), (side * 0.18, -0.28, 0.07), f"Shin.{suffix}")

    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def bone_parent(obj, armature, bone_name):
    matrix = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = matrix
    obj["rig_bone"] = bone_name
    return obj


def create_robe(material, armature):
    rings = [
        (0.14, 0.64, 0.38),
        (0.30, 0.67, 0.39),
        (0.68, 0.63, 0.37),
        (1.08, 0.57, 0.34),
        (1.45, 0.49, 0.30),
        (1.82, 0.44, 0.27),
        (2.17, 0.43, 0.25),
        (2.35, 0.38, 0.23),
    ]
    segments = 72
    vertices = []
    for z, radius_x, radius_y in rings:
        for index in range(segments):
            angle = index / segments * math.tau
            vertices.append((math.cos(angle) * radius_x, math.sin(angle) * radius_y, z))
    faces = []
    for ring_index in range(len(rings) - 1):
        for index in range(segments):
            next_index = (index + 1) % segments
            a = ring_index * segments + index
            b = ring_index * segments + next_index
            c = (ring_index + 1) * segments + next_index
            d = (ring_index + 1) * segments + index
            faces.append((a, b, c, d))
    mesh_data = bpy.data.meshes.new("MangpaoMainMesh")
    mesh_data.from_pydata(vertices, [], faces)
    mesh_data.update()
    robe = bpy.data.objects.new("OUTFIT_XU_Mangpao_Main", mesh_data)
    bpy.context.collection.objects.link(robe)
    robe.data.materials.append(material)
    set_smooth(robe)
    solidify = robe.modifiers.new("Silk thickness", "SOLIDIFY")
    solidify.thickness = 0.016
    solidify.offset = 0
    subdivision = robe.modifiers.new("Silk smoothing", "SUBSURF")
    subdivision.levels = 1
    subdivision.render_levels = 1
    robe["outfit"] = "xu"
    robe["garment_layer"] = "main_robe"
    return bone_parent(robe, armature, "Hips")


def create_sleeve(name, start, end, side, material, armature, bone_name):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = (end_v - start_v).normalized()
    depth_axis = Vector((0, 1, 0))
    width_axis = direction.cross(depth_axis).normalized()
    sections = 10
    segments = 32
    vertices = []
    for section in range(sections):
        amount = section / (sections - 1)
        center = start_v.lerp(end_v, amount)
        ease = amount * amount * (3 - 2 * amount)
        radius_width = 0.20 + ease * 0.28
        radius_depth = 0.20 + ease * 0.12
        center.z -= math.sin(amount * math.pi) * 0.04
        for index in range(segments):
            angle = index / segments * math.tau
            point = center + depth_axis * math.cos(angle) * radius_depth + width_axis * math.sin(angle) * radius_width
            vertices.append(tuple(point))
    faces = []
    for section in range(sections - 1):
        for index in range(segments):
            next_index = (index + 1) % segments
            a = section * segments + index
            b = section * segments + next_index
            c = (section + 1) * segments + next_index
            d = (section + 1) * segments + index
            faces.append((a, b, c, d))
    mesh_data = bpy.data.meshes.new(f"{name}Mesh")
    mesh_data.from_pydata(vertices, [], faces)
    mesh_data.update()
    sleeve = bpy.data.objects.new(name, mesh_data)
    bpy.context.collection.objects.link(sleeve)
    sleeve.data.materials.append(material)
    set_smooth(sleeve)
    solidify = sleeve.modifiers.new("Sleeve thickness", "SOLIDIFY")
    solidify.thickness = 0.014
    subdivision = sleeve.modifiers.new("Sleeve smoothing", "SUBSURF")
    subdivision.levels = 1
    subdivision.render_levels = 1
    sleeve["outfit"] = "xu"
    sleeve["garment_layer"] = "wide_sleeve"
    return bone_parent(sleeve, armature, bone_name)


def decorate_front_back(gold, teal, jade, armature):
    ornaments = []
    for y, suffix in ((-0.285, "Front"), (0.285, "Back")):
        ornaments.append(add_ring_curve(f"{suffix}_DragonMedallion_Ring", (0, y, 1.84), 0.31, 0.36, gold, bevel=0.018, plane="XZ"))
        dragon_points = [
            (-0.13, y - (0.012 if y < 0 else -0.012), 2.08),
            (0.08, y - (0.012 if y < 0 else -0.012), 2.01),
            (0.12, y - (0.012 if y < 0 else -0.012), 1.85),
            (-0.08, y - (0.012 if y < 0 else -0.012), 1.79),
            (-0.12, y - (0.012 if y < 0 else -0.012), 1.62),
            (0.12, y - (0.012 if y < 0 else -0.012), 1.57),
        ]
        ornaments.append(add_curve(f"{suffix}_StylizedDragon", dragon_points, gold, bevel=0.022))
        ornaments.append(add_uv_sphere(f"{suffix}_DragonPearl", (0.17, y - (0.02 if y < 0 else -0.02), 2.08), (0.045, 0.028, 0.045), jade, segments=20, rings=12))

        for row in range(4):
            points = []
            for index in range(25):
                amount = index / 24
                x = -0.56 + amount * 1.12
                z = 0.22 + row * 0.115 + math.sin(amount * math.tau * 2 + row * 0.8) * 0.065
                points.append((x, y - (0.10 if y < 0 else -0.10), z))
            ornaments.append(add_curve(f"{suffix}_HemWave_{row + 1}", points, gold if row % 2 == 0 else teal, bevel=0.014))

        for side in (-1, 1):
            cloud = [
                (side * 0.12, y - (0.09 if y < 0 else -0.09), 1.28),
                (side * 0.20, y - (0.09 if y < 0 else -0.09), 1.35),
                (side * 0.31, y - (0.09 if y < 0 else -0.09), 1.29),
                (side * 0.24, y - (0.09 if y < 0 else -0.09), 1.20),
                (side * 0.14, y - (0.09 if y < 0 else -0.09), 1.23),
            ]
            ornaments.append(add_curve(f"{suffix}_Cloud_{'L' if side > 0 else 'R'}", cloud, gold, bevel=0.014, cyclic=True))

    seam = add_curve("Front_Center_Gold_Piping", [(0, -0.405, 0.17), (0, -0.345, 1.2), (0, -0.27, 2.34)], gold, bevel=0.011)
    ornaments.append(seam)
    collar = add_ring_curve("Gold_Round_Collar", (0, 0, 2.38), 0.235, 0.19, gold, bevel=0.016)
    ornaments.append(collar)

    for obj in ornaments:
        obj["outfit"] = "xu"
        obj["garment_layer"] = "embroidery_relief"
        bone_parent(obj, armature, "Hips" if obj.name != "Gold_Round_Collar" else "Chest")
    return ornaments


def create_crown(red, gold, jade, armature):
    crown_objects = []
    main_outline = [(-0.34, 2.92), (-0.37, 3.30), (-0.28, 3.55), (-0.12, 3.72), (0, 3.85), (0.12, 3.72), (0.28, 3.55), (0.37, 3.30), (0.34, 2.92)]
    upper_outline = [(-0.21, 3.28), (-0.24, 3.52), (-0.13, 3.74), (0, 3.94), (0.13, 3.74), (0.24, 3.52), (0.21, 3.28)]
    main_plate = add_extruded_plate("HEADWEAR_XU_Crown_Main", main_outline, -0.15, 0.07, red, bevel=0.025)
    upper_plate = add_extruded_plate("HEADWEAR_XU_Crown_Upper", upper_outline, -0.17, 0.06, red, bevel=0.022)
    crown_objects.extend([main_plate, upper_plate])

    for side in (-1, 1):
        wing_outline = [
            (side * 0.28, 3.06),
            (side * 0.86, 3.03),
            (side * 0.92, 3.18),
            (side * 0.34, 3.26),
        ]
        crown_objects.append(add_extruded_plate(f"HEADWEAR_XU_SideWing_{side:+d}", wing_outline, -0.12, 0.05, red, bevel=0.018))

    for outline, label in ((main_outline, "Main"), (upper_outline, "Upper")):
        border = [(x, -0.19, z) for x, z in outline]
        crown_objects.append(add_curve(f"Crown_{label}_GoldBorder", border, gold, bevel=0.018, cyclic=True))

    scroll_specs = [
        [(-0.26, -0.20, 3.33), (-0.12, -0.22, 3.44), (0, -0.22, 3.36), (0.12, -0.22, 3.44), (0.26, -0.20, 3.33)],
        [(-0.18, -0.21, 3.60), (-0.08, -0.22, 3.69), (0, -0.22, 3.61), (0.08, -0.22, 3.69), (0.18, -0.21, 3.60)],
        [(-0.62, -0.16, 3.10), (-0.49, -0.18, 3.18), (-0.38, -0.18, 3.12)],
        [(0.62, -0.16, 3.10), (0.49, -0.18, 3.18), (0.38, -0.18, 3.12)],
    ]
    for index, points in enumerate(scroll_specs):
        crown_objects.append(add_curve(f"Crown_GoldScroll_{index + 1}", points, gold, bevel=0.017))

    jewel_specs = [(0, -0.23, 3.50, 0.085), (0, -0.24, 3.78, 0.072), (-0.29, -0.19, 3.18, 0.055), (0.29, -0.19, 3.18, 0.055)]
    for index, (x, y, z, radius) in enumerate(jewel_specs):
        jewel = add_uv_sphere(f"Crown_Jade_{index + 1}", (x, y, z), (radius, radius * 0.55, radius), jade, segments=28, rings=16)
        crown_objects.append(jewel)
        crown_objects.append(add_ring_curve(f"Crown_JadeSetting_{index + 1}", (x, y - 0.015, z), radius * 1.18, radius * 1.18, gold, bevel=0.009, plane="XZ"))

    base_band = add_ring_curve("Crown_BaseBand_Gold", (0, 0, 2.94), 0.38, 0.31, gold, bevel=0.022)
    crown_objects.append(base_band)

    for obj in crown_objects:
        obj["outfit"] = "xu"
        obj["garment_layer"] = "headwear"
        bone_parent(obj, armature, "Head")
    return crown_objects


def create_character(armature, materials):
    skin = materials["skin"]
    hair = materials["hair"]
    red = materials["red"]
    deep_red = materials["deep_red"]
    gold = materials["gold"]
    jade = materials["jade"]
    teal = materials["teal"]
    black = materials["black"]
    ivory = materials["ivory"]
    lip = materials["lip"]

    objects = []

    torso = add_uv_sphere("BODY_Torso", (0, 0, 1.78), (0.39, 0.25, 0.66), ivory)
    objects.append(bone_parent(torso, armature, "Spine"))
    pelvis = add_uv_sphere("BODY_Pelvis", (0, 0, 1.1), (0.34, 0.24, 0.30), ivory)
    objects.append(bone_parent(pelvis, armature, "Hips"))
    neck = add_cylinder("BODY_Neck", (0, 0, 2.48), 0.12, 0.24, skin, vertices=32)
    objects.append(bone_parent(neck, armature, "Neck"))

    face = add_uv_sphere("BODY_Head", (0, -0.012, 2.75), (0.27, 0.24, 0.34), skin, segments=64, rings=32)
    objects.append(bone_parent(face, armature, "Head"))
    jaw = add_uv_sphere("BODY_JawSoftener", (0, -0.062, 2.64), (0.205, 0.19, 0.145), skin, segments=48, rings=24)
    objects.append(bone_parent(jaw, armature, "Head"))
    hair_cap = add_uv_sphere("BODY_HairCap", (0, 0.045, 2.87), (0.285, 0.265, 0.34), hair, segments=48, rings=24)
    objects.append(bone_parent(hair_cap, armature, "Head"))
    bun = add_uv_sphere("BODY_HairBun", (0, 0.18, 3.02), (0.13, 0.11, 0.13), hair, segments=32, rings=18)
    objects.append(bone_parent(bun, armature, "Head"))

    for side, label in ((-1, "R"), (1, "L")):
        ear = add_uv_sphere(f"BODY_Ear_{label}", (side * 0.265, -0.005, 2.75), (0.045, 0.03, 0.07), skin, segments=28, rings=16)
        objects.append(bone_parent(ear, armature, "Head"))
        eye_white = add_uv_sphere(f"FACE_EyeWhite_{label}", (side * 0.096, -0.248, 2.78), (0.058, 0.014, 0.022), materials["eye_white"], segments=28, rings=14)
        objects.append(bone_parent(eye_white, armature, "Head"))
        iris = add_uv_sphere(f"FACE_Iris_{label}", (side * 0.096, -0.260, 2.78), (0.018, 0.008, 0.017), black, segments=24, rings=12)
        objects.append(bone_parent(iris, armature, "Head"))
        brow_points = [
            (side * 0.045, -0.257, 2.855),
            (side * 0.100, -0.266, 2.875),
            (side * 0.155, -0.253, 2.858),
        ]
        brow = add_curve(f"FACE_Brow_{label}", brow_points, hair, bevel=0.012)
        objects.append(bone_parent(brow, armature, "Head"))

    nose = add_uv_sphere("FACE_Nose", (0, -0.270, 2.70), (0.030, 0.036, 0.050), skin, segments=28, rings=16)
    objects.append(bone_parent(nose, armature, "Head"))
    upper_lip = add_curve("FACE_UpperLip", [(-0.060, -0.254, 2.615), (0, -0.267, 2.624), (0.060, -0.254, 2.615)], lip, bevel=0.007)
    lower_lip = add_curve("FACE_LowerLip", [(-0.055, -0.254, 2.612), (0, -0.266, 2.594), (0.055, -0.254, 2.612)], lip, bevel=0.006)
    objects.extend([bone_parent(upper_lip, armature, "Head"), bone_parent(lower_lip, armature, "Head")])

    arm_points = {
        "L": ((0.38, 0, 2.29), (0.83, 0, 2.03), (1.18, 0, 1.76), (1.36, -0.01, 1.64)),
        "R": ((-0.38, 0, 2.29), (-0.83, 0, 2.03), (-1.18, 0, 1.76), (-1.36, -0.01, 1.64)),
    }
    for label, (shoulder, elbow, wrist, hand_position) in arm_points.items():
        upper = add_segment(f"BODY_UpperArm_{label}", shoulder, elbow, 0.12, skin)
        lower = add_segment(f"BODY_Forearm_{label}", elbow, wrist, 0.105, skin)
        hand = add_uv_sphere(f"BODY_Hand_{label}", hand_position, (0.115, 0.07, 0.15), skin, segments=36, rings=18)
        objects.extend([
            bone_parent(upper, armature, f"UpperArm.{label}"),
            bone_parent(lower, armature, f"Forearm.{label}"),
            bone_parent(hand, armature, f"Hand.{label}"),
        ])
        side = 1 if label == "L" else -1
        for finger_index in range(5):
            spread = (finger_index - 2) * 0.022
            start = Vector(hand_position) + Vector((side * 0.075, -0.055 + spread, -0.03 + abs(finger_index - 2) * 0.008))
            end = start + Vector((side * (0.11 - abs(finger_index - 2) * 0.012), -0.015, -0.035))
            finger = add_segment(f"BODY_Finger_{label}_{finger_index + 1}", start, end, 0.018, skin, vertices=16)
            objects.append(bone_parent(finger, armature, f"Hand.{label}"))

    for label, side in (("L", 1), ("R", -1)):
        thigh = add_segment(f"BODY_Thigh_{label}", (side * 0.18, 0, 1.02), (side * 0.18, 0, 0.58), 0.14, ivory)
        shin = add_segment(f"BODY_Shin_{label}", (side * 0.18, 0, 0.58), (side * 0.18, 0, 0.15), 0.12, ivory)
        shoe = add_uv_sphere(f"OUTFIT_XU_Shoe_{label}", (side * 0.18, -0.105, 0.105), (0.19, 0.31, 0.12), deep_red, segments=36, rings=18)
        shoe_trim = add_ring_curve(f"OUTFIT_XU_ShoeTrim_{label}", (side * 0.18, -0.285, 0.11), 0.15, 0.075, gold, bevel=0.012, plane="XZ")
        objects.extend([
            bone_parent(thigh, armature, f"Thigh.{label}"),
            bone_parent(shin, armature, f"Shin.{label}"),
            bone_parent(shoe, armature, f"Foot.{label}"),
            bone_parent(shoe_trim, armature, f"Foot.{label}"),
        ])

    robe = create_robe(red, armature)
    objects.append(robe)
    sleeve_l = create_sleeve("OUTFIT_XU_WideSleeve_L", (0.31, 0, 2.30), (1.36, 0, 1.62), 1, red, armature, "UpperArm.L")
    sleeve_r = create_sleeve("OUTFIT_XU_WideSleeve_R", (-0.31, 0, 2.30), (-1.36, 0, 1.62), -1, red, armature, "UpperArm.R")
    objects.extend([sleeve_l, sleeve_r])

    for label, side in (("L", 1), ("R", -1)):
        cuff_center = (side * 1.30, -0.02, 1.68)
        cuff = add_ring_curve(f"OUTFIT_XU_CuffGold_{label}", cuff_center, 0.31, 0.43, gold, bevel=0.018, plane="YZ")
        objects.append(bone_parent(cuff, armature, f"UpperArm.{label}"))
        wave = add_curve(
            f"OUTFIT_XU_SleeveWave_{label}",
            [
                (side * 0.88, -0.29, 1.92),
                (side * 1.04, -0.34, 1.86),
                (side * 1.18, -0.37, 1.77),
                (side * 1.32, -0.33, 1.69),
            ],
            teal,
            bevel=0.018,
        )
        objects.append(bone_parent(wave, armature, f"UpperArm.{label}"))

    objects.extend(decorate_front_back(gold, teal, jade, armature))
    objects.extend(create_crown(red, gold, jade, armature))

    for obj in objects:
        if hasattr(obj, "select_set"):
            obj.select_set(False)
    return objects


def create_animations(armature):
    animation_specs = {
        "Idle": [
            (1, {"Chest": (0, 0, -0.018), "Head": (0.015, 0, 0.025)}),
            (36, {"Chest": (0, 0, 0.018), "Head": (-0.012, 0, -0.025)}),
            (72, {"Chest": (0, 0, -0.018), "Head": (0.015, 0, 0.025)}),
        ],
        "Walk": [
            (1, {"Thigh.L": (0.42, 0, 0), "Thigh.R": (-0.42, 0, 0), "UpperArm.L": (-0.24, 0, 0.08), "UpperArm.R": (0.24, 0, -0.08)}),
            (14, {"Thigh.L": (0, 0, 0), "Thigh.R": (0, 0, 0), "Hips": (0, 0, 0.035)}),
            (27, {"Thigh.L": (-0.42, 0, 0), "Thigh.R": (0.42, 0, 0), "UpperArm.L": (0.24, 0, 0.08), "UpperArm.R": (-0.24, 0, -0.08)}),
            (40, {"Thigh.L": (0, 0, 0), "Thigh.R": (0, 0, 0), "Hips": (0, 0, 0.035)}),
            (53, {"Thigh.L": (0.42, 0, 0), "Thigh.R": (-0.42, 0, 0), "UpperArm.L": (-0.24, 0, 0.08), "UpperArm.R": (0.24, 0, -0.08)}),
        ],
        "WaterSleeve": [
            (1, {"UpperArm.L": (0.1, -0.2, -1.05), "UpperArm.R": (-0.1, 0.2, 1.05), "Forearm.L": (0.08, 0, 0.05), "Forearm.R": (0.08, 0, -0.05)}),
            (36, {"Root": (0, 0, math.pi * 0.66), "UpperArm.L": (-0.35, 0.2, -1.25), "UpperArm.R": (0.35, -0.2, 1.25), "Forearm.L": (0.18, 0.08, 0), "Forearm.R": (0.04, -0.08, 0)}),
            (72, {"Root": (0, 0, math.pi * 1.33), "UpperArm.L": (0.35, -0.2, -0.96), "UpperArm.R": (-0.35, 0.2, 0.96), "Forearm.L": (0.04, -0.08, 0), "Forearm.R": (0.18, 0.08, 0)}),
            (108, {"Root": (0, 0, math.tau), "UpperArm.L": (0.1, -0.2, -1.05), "UpperArm.R": (-0.1, 0.2, 1.05), "Forearm.L": (0.08, 0, 0.05), "Forearm.R": (0.08, 0, -0.05)}),
        ],
        "CloudStep": [
            (1, {"UpperArm.L": (0.15, 0, -0.72), "UpperArm.R": (-0.15, 0, 0.72), "Hips": (0, 0, -0.04)}),
            (32, {"Hips": (0, 0, 0.08), "Spine": (0, 0.08, 0.06), "UpperArm.L": (-0.2, 0.1, -0.9), "UpperArm.R": (0.2, -0.1, 0.52), "Thigh.L": (0.17, 0, 0), "Thigh.R": (-0.12, 0, 0)}),
            (64, {"Hips": (0, 0, -0.04), "Spine": (0, -0.08, -0.06), "UpperArm.L": (0.2, -0.1, -0.52), "UpperArm.R": (-0.2, 0.1, 0.9), "Thigh.L": (-0.12, 0, 0), "Thigh.R": (0.17, 0, 0)}),
            (96, {"UpperArm.L": (0.15, 0, -0.72), "UpperArm.R": (-0.15, 0, 0.72), "Hips": (0, 0, -0.04)}),
        ],
        "OrchidGesture": [
            (1, {"UpperArm.L": (0.25, -0.2, -0.82), "Forearm.L": (-0.18, 0.08, 0), "UpperArm.R": (-0.58, 0.15, 0.38), "Forearm.R": (-0.22, -0.08, 0), "Head": (0, 0, -0.10)}),
            (42, {"UpperArm.L": (0.38, -0.08, -0.68), "Forearm.L": (-0.24, 0.05, 0), "UpperArm.R": (-0.42, 0.08, 0.54), "Forearm.R": (-0.18, -0.05, 0), "Head": (0.04, 0, -0.04)}),
            (84, {"UpperArm.L": (0.25, -0.2, -0.82), "Forearm.L": (-0.18, 0.08, 0), "UpperArm.R": (-0.58, 0.15, 0.38), "Forearm.R": (-0.22, -0.08, 0), "Head": (0, 0, -0.10)}),
        ],
        "StagePose": [
            (1, {"Chest": (0.10, 0, 0), "Head": (0.08, 0, 0), "UpperArm.L": (-0.2, 0.1, -1.03), "UpperArm.R": (-0.2, -0.1, 1.03), "Forearm.L": (0, 0, 0), "Forearm.R": (0, 0, 0), "Thigh.L": (0.12, 0, 0), "Thigh.R": (-0.12, 0, 0)}),
            (38, {"Chest": (0.16, 0, 0), "Head": (0.12, 0, 0), "UpperArm.L": (-0.3, 0.1, -1.12), "UpperArm.R": (-0.3, -0.1, 1.12), "Forearm.L": (0, 0, 0), "Forearm.R": (0, 0, 0), "Thigh.L": (0.14, 0, 0), "Thigh.R": (-0.14, 0, 0)}),
            (76, {"Chest": (0.10, 0, 0), "Head": (0.08, 0, 0), "UpperArm.L": (-0.2, 0.1, -1.03), "UpperArm.R": (-0.2, -0.1, 1.03), "Forearm.L": (0, 0, 0), "Forearm.R": (0, 0, 0), "Thigh.L": (0.12, 0, 0), "Thigh.R": (-0.12, 0, 0)}),
        ],
    }

    armature.animation_data_create()
    for action_name, keyframes in animation_specs.items():
        action = bpy.data.actions.new(action_name)
        action.use_fake_user = True
        armature.animation_data.action = action
        for frame, transforms in keyframes:
            bpy.context.scene.frame_set(frame)
            for pose_bone in armature.pose.bones:
                pose_bone.rotation_euler = (0, 0, 0)
                pose_bone.location = (0, 0, 0)
            for bone_name, values in transforms.items():
                pose_bone = armature.pose.bones[bone_name]
                if bone_name == "Hips" and len(values) == 3 and abs(values[2]) < 0.2 and values[0] == 0 and values[1] == 0:
                    pose_bone.location = values
                    pose_bone.keyframe_insert(data_path="location", frame=frame, group=bone_name)
                else:
                    pose_bone.rotation_euler = values
                    pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
            for pose_bone in armature.pose.bones:
                if pose_bone.name not in transforms:
                    pose_bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=pose_bone.name)
                    pose_bone.keyframe_insert(data_path="location", frame=frame, group=pose_bone.name)
        for fcurve in action.fcurves:
            for keyframe in fcurve.keyframe_points:
                keyframe.interpolation = "BEZIER" if action_name != "WaterSleeve" else "LINEAR"
        print("Created action", action_name, action.frame_range[:])
    armature.animation_data.action = bpy.data.actions.get("Idle")
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 108
    bpy.context.scene.frame_set(1)


def setup_preview(scene, armature):
    ground_material = make_material("Preview Ground", (0.055, 0.065, 0.06), roughness=0.9)
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    ground = bpy.context.object
    ground.name = "PREVIEW_Ground"
    ground.data.materials.append(ground_material)

    world = scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.025, 0.035, 0.03, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.42

    def add_area(name, location, energy, color, size):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.color = color
        data.shape = "DISK"
        data.size = size
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = location
        look_at(obj, (0, 0, 1.9))
        return obj

    add_area("PREVIEW_Key", (-4.5, -5.5, 7.0), 1050, (1.0, 0.78, 0.56), 4.0)
    add_area("PREVIEW_Fill", (4.0, -2.2, 4.2), 720, (0.55, 0.78, 0.74), 3.2)
    add_area("PREVIEW_Rim", (1.0, 4.2, 5.7), 920, (0.74, 0.25, 0.22), 3.0)

    camera_data = bpy.data.cameras.new("PREVIEW_Camera")
    camera = bpy.data.objects.new("PREVIEW_Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (4.7, -8.2, 4.2)
    camera.data.lens = 66
    look_at(camera, (0, 0, 1.9))
    scene.camera = camera

    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW_PATH)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_percentage = 100

    armature.animation_data.action = bpy.data.actions.get("StagePose")
    scene.frame_set(20)
    bpy.ops.render.render(write_still=True)
    armature.animation_data.action = bpy.data.actions.get("Idle")
    scene.frame_set(1)
    return ground, camera


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def export_character(armature, character_objects, preview_objects):
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in character_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature

    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_extra_animations=True,
        export_force_sampling=True,
        export_frame_step=1,
        export_skins=True,
        export_def_bones=True,
        export_leaf_bone=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_yup=True,
    )

    for obj in preview_objects:
        obj.hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))


def main():
    reset_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps = 30

    materials = {
        "skin": make_material("Skin Porcelain Warm", (0.86, 0.59, 0.46), roughness=0.66),
        "hair": make_material("Hair Ink Black", (0.015, 0.012, 0.01), roughness=0.34),
        "red": make_material("Mangpao Cinnabar Silk", (0.66, 0.018, 0.025), roughness=0.32, sheen=0.28),
        "deep_red": make_material("Shoe Deep Cinnabar", (0.27, 0.012, 0.018), roughness=0.44),
        "gold": make_material("Embroidery Antique Gold", (0.83, 0.48, 0.09), metallic=0.72, roughness=0.24),
        "jade": make_material("Jade Muted Green", (0.39, 0.52, 0.37), metallic=0.05, roughness=0.24),
        "teal": make_material("Wave Deep Teal", (0.08, 0.28, 0.25), metallic=0.08, roughness=0.46),
        "black": make_material("Eye Dark Brown", (0.012, 0.008, 0.006), roughness=0.3),
        "ivory": make_material("Undergarment Ivory", (0.76, 0.70, 0.60), roughness=0.82),
        "eye_white": make_material("Eye White", (0.92, 0.88, 0.80), roughness=0.5),
        "lip": make_material("Restrained Stage Lip", (0.52, 0.08, 0.09), roughness=0.5),
    }

    armature = create_armature()
    character_objects = create_character(armature, materials)
    create_animations(armature)
    ground, camera = setup_preview(scene, armature)
    export_character(armature, character_objects, [ground, camera])

    print("GLB", GLB_PATH, GLB_PATH.stat().st_size)
    print("BLEND", BLEND_PATH, BLEND_PATH.stat().st_size)
    print("PREVIEW", PREVIEW_PATH, PREVIEW_PATH.stat().st_size)


if __name__ == "__main__":
    main()
