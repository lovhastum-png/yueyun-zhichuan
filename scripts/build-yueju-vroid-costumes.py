import math
import shutil
import sys
import tempfile
from pathlib import Path

import bmesh
import bpy
import numpy as np


PROJECT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = PROJECT / "public" / "assets" / "3d-stage" / "vroid" / "yueju-base.web.vrm"
DEFAULT_OUTPUT = PROJECT / "public" / "assets" / "3d-stage" / "vroid" / "costumes"

PALETTES = {
    "xu": {
        "name": "徐派小生朱砂蟒袍",
        "main": "#a91f2b",
        "accent": "#e4bd65",
        "secondary": "#5d1720",
        "head": "official",
        "skirt": True,
    },
    "yuan": {
        "name": "袁派花旦粉青对襟褂",
        "main": "#e8a7b3",
        "accent": "#8fc8c2",
        "secondary": "#f5e2d4",
        "head": "flowers",
        "skirt": True,
    },
    "fan": {
        "name": "范派小生月白褶子",
        "main": "#e7ddc6",
        "accent": "#416b6b",
        "secondary": "#a7b8ae",
        "head": "scholar",
        "skirt": True,
    },
    "fu": {
        "name": "傅派花旦百花水袖衣",
        "main": "#f4eee5",
        "accent": "#e4879d",
        "secondary": "#82aaa0",
        "head": "flowers",
        "skirt": True,
        "water_sleeves": True,
    },
    "laosheng": {
        "name": "老生墨绿员外袍",
        "main": "#244b3b",
        "accent": "#bb8b4a",
        "secondary": "#191f1b",
        "head": "round",
        "skirt": True,
    },
    "chou": {
        "name": "丑角锦色短打",
        "main": "#d49b27",
        "accent": "#c63b39",
        "secondary": "#345a89",
        "head": "headband",
        "skirt": False,
        "pants": True,
    },
}

UPPER_MATERIALS = {
    "N00_007_01_Tops_01_CLOTH_02 (Instance)",
    "材质.009",
    "材质.008",
    "材质.010",
}


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    source = Path(values[0]).resolve() if values else DEFAULT_SOURCE
    output = Path(values[1]).resolve() if len(values) > 1 else DEFAULT_OUTPUT
    requested = set(values[2].split(",")) if len(values) > 2 else set(PALETTES)
    return source, output, requested


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.materials, bpy.data.images):
        for item in list(collection):
            if item.users == 0:
                collection.remove(item)


def import_vrm_as_gltf(source):
    temporary = Path(tempfile.gettempdir()) / "yueju-costume-source.glb"
    shutil.copyfile(source, temporary)
    bpy.ops.import_scene.gltf(filepath=str(temporary))
    bpy.context.view_layer.update()


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) / 255.0 for index in (0, 2, 4))


def srgb_to_linear(values):
    values = np.asarray(values, dtype=np.float32)
    return np.where(values <= 0.04045, values / 12.92, ((values + 0.055) / 1.055) ** 2.4)


def colorize_image(image, primary, accent, secondary, label):
    if not image or image.size[0] <= 0 or image.size[1] <= 0:
        return image
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape((-1, 4))
    source = pixels[:, :3]
    alpha = pixels[:, 3:4]
    luminance = np.clip(source @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), 0.0, 1.0)
    maximum = source.max(axis=1)
    minimum = source.min(axis=1)
    chroma = maximum - minimum

    primary_linear = srgb_to_linear(primary)
    accent_linear = srgb_to_linear(accent)
    secondary_linear = srgb_to_linear(secondary)

    detail = np.clip(0.54 + luminance[:, None] * 0.92, 0.24, 1.24)
    recolored = primary_linear[None, :] * detail
    gold_mask = (source[:, 0] > source[:, 1] * 1.07) & (source[:, 0] > source[:, 2] * 1.28) & (chroma > 0.035)
    shadow_mask = luminance < 0.035
    secondary_mask = (
        (~gold_mask)
        & (source[:, 2] > source[:, 1] * 1.12)
        & (source[:, 2] > source[:, 0] * 1.25)
        & (chroma > 0.04)
    )
    recolored[gold_mask] = accent_linear[None, :] * np.clip(0.32 + luminance[gold_mask, None] * 1.05, 0.08, 1.15)
    recolored[secondary_mask] = secondary_linear[None, :] * np.clip(0.27 + luminance[secondary_mask, None] * 1.10, 0.06, 1.12)
    recolored[shadow_mask] *= np.clip(0.72 + luminance[shadow_mask, None] * 3.0, 0.5, 0.84)
    recolored = np.clip(recolored, 0.0, 1.0)

    generated = bpy.data.images.new(
        name=label,
        width=int(image.size[0]),
        height=int(image.size[1]),
        alpha=True,
    )
    generated.colorspace_settings.name = image.colorspace_settings.name
    output = np.concatenate((recolored, alpha), axis=1).astype(np.float32).reshape(-1)
    generated.pixels.foreach_set(output)
    if max(generated.size[0], generated.size[1]) > 512:
        resize_scale = 512 / max(generated.size[0], generated.size[1])
        generated.scale(
            max(1, round(generated.size[0] * resize_scale)),
            max(1, round(generated.size[1] * resize_scale)),
        )
    generated.pack()
    return generated


def material_target(name, object_name, palette):
    primary = hex_rgb(palette["main"])
    accent = hex_rgb(palette["accent"])
    secondary = hex_rgb(palette["secondary"])
    if palette is PALETTES["chou"] and ("010" in name or object_name.endswith("Back")):
        primary, secondary = secondary, primary
    elif palette is PALETTES["yuan"] and ("010" in name or object_name.endswith("Back")):
        primary = tuple((a + b) * 0.5 for a, b in zip(primary, secondary))
    elif palette is PALETTES["fan"] and "010" in name:
        primary = secondary
    return primary, accent, secondary


def recolor_object(obj, palette, outfit_id):
    for slot_index, slot in enumerate(obj.material_slots):
        material = slot.material
        if not material:
            continue
        targets = material_target(material.name, obj.name, palette)
        primary, accent, secondary = targets
        source_image = None
        if material.use_nodes:
            source_image = next(
                (node.image for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image),
                None,
            )
        generated = colorize_image(
            source_image,
            primary,
            accent,
            secondary,
            f"Yueju_{outfit_id}_{obj.name}_{slot_index}",
        ) if source_image else None

        copied = bpy.data.materials.new(f"Yueju_{outfit_id}_{obj.name}_{slot_index}")
        copied.use_nodes = True
        copied.use_backface_culling = False
        nodes = copied.node_tree.nodes
        links = copied.node_tree.links
        nodes.clear()
        output = nodes.new("ShaderNodeOutputMaterial")
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        shader.inputs["Base Color"].default_value = (*primary, 1.0)
        shader.inputs["Roughness"].default_value = 0.72
        if generated:
            texture = nodes.new("ShaderNodeTexImage")
            texture.image = generated
            links.new(texture.outputs["Color"], shader.inputs["Base Color"])
            links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
        links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        slot.material = copied


def keep_material_faces(obj, material_names):
    allowed = {
        index
        for index, slot in enumerate(obj.material_slots)
        if slot.material and any(slot.material.name.startswith(name) for name in material_names)
    }
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    doomed = [face for face in mesh.faces if face.material_index not in allowed]
    bmesh.ops.delete(mesh, geom=doomed, context="FACES")
    loose = [vertex for vertex in mesh.verts if not vertex.link_faces]
    if loose:
        bmesh.ops.delete(mesh, geom=loose, context="VERTS")
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


def make_pbr(name, color, roughness=0.72, metallic=0.0, alpha=1.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*color, alpha)
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        material.surface_render_method = "DITHERED"
    return material


def bind_rigid(obj, armature, bone_name):
    obj.parent = armature
    modifier = obj.modifiers.new("Yueju_Armature", "ARMATURE")
    modifier.object = armature
    group = obj.vertex_groups.new(name=bone_name)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    return obj


def bind_blended(obj, armature, bone_weights):
    obj.parent = armature
    modifier = obj.modifiers.new("Yueju_Armature", "ARMATURE")
    modifier.object = armature
    for bone_name, weight_function in bone_weights.items():
        group = obj.vertex_groups.new(name=bone_name)
        for vertex in obj.data.vertices:
            weight = float(weight_function(vertex.co))
            if weight > 0.0001:
                group.add([vertex.index], min(1.0, weight), "REPLACE")
    return obj


def primitive_object(kind, name, location, scale, material, **kwargs):
    if kind == "cube":
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=location)
    elif kind == "cylinder":
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=1.0, depth=1.0, location=location)
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(
            major_radius=kwargs.get("major_radius", 0.1),
            minor_radius=kwargs.get("minor_radius", 0.01),
            major_segments=24,
            minor_segments=8,
            location=location,
        )
    else:
        raise ValueError(kind)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    return obj


def add_hat_wings(armature, palette, outfit_id, objects):
    wing_color = tuple(channel * 0.62 for channel in hex_rgb(palette["accent"]))
    wood = make_pbr(f"Yueju_{outfit_id}_HatGold", wing_color, 0.48, 0.16)
    red = make_pbr(f"Yueju_{outfit_id}_HatBand", hex_rgb(palette["secondary"]), 0.66)
    band = primitive_object("cube", f"Costume_{outfit_id}_HatBand", (0.0, -0.012, 1.675), (0.31, 0.065, 0.035), red)
    bind_rigid(band, armature, "J_Bip_C_Head")
    objects.append(band)
    for side in (-1, 1):
        wing = primitive_object("cube", f"Costume_{outfit_id}_HatWing_{side}", (side * 0.22, -0.012, 1.69), (0.18, 0.035, 0.022), wood)
        wing.rotation_euler[1] = side * 0.10
        bind_rigid(wing, armature, "J_Bip_C_Head")
        objects.append(wing)


def add_flower_headpiece(armature, palette, outfit_id, objects):
    flower = make_pbr(f"Yueju_{outfit_id}_Flower", hex_rgb(palette["accent"]), 0.58)
    leaf = make_pbr(f"Yueju_{outfit_id}_Leaf", hex_rgb(palette["secondary"]), 0.72)
    gold = make_pbr(f"Yueju_{outfit_id}_Hairpin", (0.77, 0.58, 0.22), 0.38, 0.30)
    pin = primitive_object("cylinder", f"Costume_{outfit_id}_Hairpin", (0.0, -0.04, 1.73), (0.012, 0.012, 0.28), gold)
    pin.rotation_euler[1] = math.pi / 2
    bind_rigid(pin, armature, "J_Bip_C_Head")
    objects.append(pin)
    for side in (-1, 1):
        center_x = side * 0.105
        for index, angle in enumerate(np.linspace(0.0, math.tau, 6, endpoint=False)):
            petal = primitive_object(
                "sphere",
                f"Costume_{outfit_id}_Flower_{side}_{index}",
                (center_x + math.cos(angle) * 0.032, -0.095, 1.724 + math.sin(angle) * 0.032),
                (0.032, 0.014, 0.018),
                flower,
            )
            petal.rotation_euler[1] = angle
            bind_rigid(petal, armature, "J_Bip_C_Head")
            objects.append(petal)
        leaf_obj = primitive_object("sphere", f"Costume_{outfit_id}_Leaf_{side}", (side * 0.16, -0.078, 1.69), (0.05, 0.014, 0.018), leaf)
        leaf_obj.rotation_euler[1] = side * 0.55
        bind_rigid(leaf_obj, armature, "J_Bip_C_Head")
        objects.append(leaf_obj)


def add_headband(armature, palette, outfit_id, objects):
    band_material = make_pbr(f"Yueju_{outfit_id}_Headband", hex_rgb(palette["accent"]), 0.68)
    band = primitive_object("cube", f"Costume_{outfit_id}_Headband", (0.0, -0.112, 1.668), (0.11, 0.012, 0.018), band_material)
    bind_rigid(band, armature, "J_Bip_C_Head")
    objects.append(band)
    knot = primitive_object("sphere", f"Costume_{outfit_id}_HeadbandKnot", (0.0, 0.074, 1.66), (0.026, 0.018, 0.026), band_material)
    bind_rigid(knot, armature, "J_Bip_C_Head")
    objects.append(knot)


def add_water_sleeves(armature, palette, outfit_id, objects):
    sleeve_material = make_pbr(f"Yueju_{outfit_id}_WaterSleeve", (0.95, 0.93, 0.88), 0.94, 0.0, 0.92)
    accent_material = make_pbr(f"Yueju_{outfit_id}_WaterSleeveTrim", hex_rgb(palette["accent"]), 0.72)
    for side, label in ((-1, "L"), (1, "R")):
        inner = side * 0.56
        outer = side * 1.10
        columns = 7
        vertices = []
        for y in (-0.025, 0.045):
            for row in (0, 1):
                for column in range(columns):
                    progress = column / (columns - 1)
                    x = inner + (outer - inner) * progress
                    top = 1.49 - progress * 0.06
                    bottom = 1.22 - math.sin(progress * math.pi) * 0.34 - progress * 0.08
                    vertices.append((x, y, top if row == 0 else bottom))
        faces = []
        layer = columns * 2
        for column in range(columns - 1):
            faces.append((column, column + 1, columns + column + 1, columns + column))
            back = layer
            faces.append((back + columns + column, back + columns + column + 1, back + column + 1, back + column))
        for column in range(columns - 1):
            faces.append((column, layer + column, layer + column + 1, column + 1))
            lower = columns + column
            faces.append((lower + 1, layer + lower + 1, layer + lower, lower))
        faces.extend([
            (0, columns, layer + columns, layer),
            (columns - 1, layer - 1, layer * 2 - 1, layer + columns - 1),
        ])
        mesh = bpy.data.meshes.new(f"Costume_{outfit_id}_WaterSleeve_{label}_Mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(f"Costume_{outfit_id}_WaterSleeve_{label}", mesh)
        bpy.context.collection.objects.link(obj)
        obj.data.materials.append(sleeve_material)
        lower_arm = f"J_Bip_{label}_LowerArm"
        hand = f"J_Bip_{label}_Hand"
        bind_blended(
            obj,
            armature,
            {
                lower_arm: lambda co, side=side: max(0.0, min(1.0, 1.0 - abs(co.x - side * 0.56) / 0.47)),
                hand: lambda co, side=side: max(0.0, min(1.0, abs(co.x - side * 0.56) / 0.47)),
            },
        )
        objects.append(obj)
        trim = primitive_object("cube", f"Costume_{outfit_id}_WaterSleeveTrim_{label}", (outer, 0.01, 1.14), (0.015, 0.052, 0.25), accent_material)
        bind_rigid(trim, armature, hand)
        objects.append(trim)


def add_duanda_pants(armature, palette, outfit_id, objects):
    left_material = make_pbr(f"Yueju_{outfit_id}_PantsBlue", hex_rgb(palette["secondary"]), 0.78)
    right_material = make_pbr(f"Yueju_{outfit_id}_PantsGold", hex_rgb(palette["main"]), 0.78)
    cuff_material = make_pbr(f"Yueju_{outfit_id}_PantsCuff", hex_rgb(palette["accent"]), 0.58)
    for side, label, material in ((-1, "L", left_material), (1, "R", right_material)):
        bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.082, radius2=0.125, depth=0.84, location=(side * 0.115, 0.0, 0.53))
        pants = bpy.context.object
        pants.name = f"Costume_{outfit_id}_Pants_{label}"
        pants.scale.y = 1.03
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        pants.data.materials.append(material)
        upper = f"J_Bip_{label}_UpperLeg"
        lower = f"J_Bip_{label}_LowerLeg"
        bind_blended(
            pants,
            armature,
            {
                upper: lambda co: max(0.0, min(1.0, (co.z - 0.30) / 0.36)),
                lower: lambda co: max(0.0, min(1.0, (0.78 - co.z) / 0.48)),
            },
        )
        objects.append(pants)
        cuff = primitive_object("torus", f"Costume_{outfit_id}_PantsCuff_{label}", (side * 0.115, 0.0, 0.115), (1.0, 1.03, 1.0), cuff_material, major_radius=0.082, minor_radius=0.012)
        bind_rigid(cuff, armature, lower)
        objects.append(cuff)
    belt = primitive_object("cylinder", f"Costume_{outfit_id}_Belt", (0.0, 0.0, 1.015), (0.18, 0.15, 0.052), cuff_material)
    bind_blended(belt, armature, {"J_Bip_C_Hips": lambda _co: 0.72, "J_Bip_C_Spine": lambda _co: 0.28})
    objects.append(belt)


def scale_mesh(obj, x=1.0, y=1.0, z=1.0, pivot_z=0.0):
    for vertex in obj.data.vertices:
        vertex.co.x *= x
        vertex.co.y *= y
        vertex.co.z = pivot_z + (vertex.co.z - pivot_z) * z
    obj.data.update()


def build_outfit(source, output_dir, outfit_id, palette):
    clear_scene()
    import_vrm_as_gltf(source)
    armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
    upper = next(
        (
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and sum(
                any(slot.material and slot.material.name.startswith(prefix) for slot in obj.material_slots)
                for prefix in ("材质.009", "材质.008", "材质.010")
            )
            >= 3
        ),
        None,
    )
    skirt = next(
        (
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and any(slot.material and slot.material.name.startswith("材质.006") for slot in obj.material_slots)
        ),
        None,
    )
    source_hat = next(
        (
            obj
            for obj in bpy.context.scene.objects
            if obj.type == "MESH"
            and any(slot.material and slot.material.name.startswith("材质.013") for slot in obj.material_slots)
        ),
        None,
    )
    if not armature or not upper or not skirt:
        raise RuntimeError("优化 VRM 中缺少 Armature、Body 或柱体服装网格")

    upper.name = f"Costume_{outfit_id}_Upper"
    keep_material_faces(upper, UPPER_MATERIALS)
    outfit_objects = [upper]

    if palette.get("skirt"):
        skirt.name = f"Costume_{outfit_id}_Skirt"
        outfit_objects.append(skirt)
    else:
        bpy.data.objects.remove(skirt, do_unlink=True)

    head_style = palette.get("head")
    if head_style in {"official", "scholar", "round"} and source_hat:
        source_hat.name = f"Costume_{outfit_id}_Hat"
        outfit_objects.append(source_hat)
    elif source_hat:
        bpy.data.objects.remove(source_hat, do_unlink=True)

    if outfit_id == "yuan":
        scale_mesh(upper, 1.015, 1.025, 0.98, 1.0)
        scale_mesh(skirt, 1.08, 1.05, 0.96, 1.02)
    elif outfit_id == "fan":
        scale_mesh(upper, 0.98, 1.0, 1.0, 1.0)
        scale_mesh(skirt, 0.94, 0.98, 1.0, 1.02)
    elif outfit_id == "fu":
        scale_mesh(upper, 1.025, 1.035, 1.0, 1.0)
        scale_mesh(skirt, 1.10, 1.06, 0.985, 1.02)
    elif outfit_id == "laosheng":
        scale_mesh(upper, 1.035, 1.035, 1.0, 1.0)
        scale_mesh(skirt, 1.08, 1.06, 1.0, 1.02)

    for obj in list(outfit_objects):
        recolor_object(obj, palette, outfit_id)

    if head_style == "official":
        add_hat_wings(armature, palette, outfit_id, outfit_objects)
    elif head_style == "scholar":
        add_hat_wings(armature, palette, outfit_id, outfit_objects)
    elif head_style == "flowers":
        add_flower_headpiece(armature, palette, outfit_id, outfit_objects)
    elif head_style == "headband":
        add_headband(armature, palette, outfit_id, outfit_objects)

    if palette.get("water_sleeves"):
        add_water_sleeves(armature, palette, outfit_id, outfit_objects)
    if palette.get("pants"):
        add_duanda_pants(armature, palette, outfit_id, outfit_objects)

    keep = {armature, *outfit_objects}
    for obj in list(bpy.context.scene.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)

    for obj in outfit_objects:
        if obj.type == "MESH":
            obj.data.name = f"{obj.name}_Mesh"
            for polygon in obj.data.polygons:
                polygon.use_smooth = True

    armature.name = f"Yueju_{outfit_id}_Rig"
    output_path = output_dir / f"{outfit_id}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(output_path),
        export_format="GLB",
        export_skins=True,
        export_animations=False,
        export_materials="EXPORT",
        export_yup=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    print(f"BUILT_COSTUME={outfit_id}|{output_path}|{output_path.stat().st_size}")


def main():
    source, output_dir, requested = parse_args()
    output_dir.mkdir(parents=True, exist_ok=True)
    for outfit_id, palette in PALETTES.items():
        if outfit_id not in requested:
            continue
        build_outfit(source, output_dir, outfit_id, palette)
    clear_scene()
    print(f"COSTUME_COLLECTION_READY={output_dir}")


main()
