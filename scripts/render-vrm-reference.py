import math
import os
import shutil
import sys
import tempfile
from pathlib import Path

import bpy
from mathutils import Vector


def arguments():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) < 2:
        raise SystemExit("usage: blender --background --python render-vrm-reference.py -- INPUT.vrm OUTPUT_PREFIX")
    return Path(values[0]).resolve(), Path(values[1]).resolve()


def look_at(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def make_material(name, color, roughness=0.85, metallic=0.0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1.0)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    return material


source, output_prefix = arguments()
output_prefix.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)

temporary = Path(tempfile.gettempdir()) / f"yueju-vrm-reference-{source.stem}-{os.getpid()}.glb"
shutil.copyfile(source, temporary)
bpy.ops.import_scene.gltf(filepath=str(temporary))

for obj in list(bpy.context.scene.objects):
    if obj.name == "Icosphere":
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    if obj.type == "MESH":
        obj.hide_render = False

bpy.context.view_layer.update()
renderables = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.hide_render]
points = [obj.matrix_world @ Vector(corner) for obj in renderables for corner in obj.bound_box]
minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
center = (minimum + maximum) * 0.5
height = maximum.z - minimum.z
width = maximum.x - minimum.x

floor_material = make_material("Reference_Floor", (0.31, 0.24, 0.18), 0.92)
bpy.ops.mesh.primitive_plane_add(size=20, location=(center.x, center.y, minimum.z - 0.012))
floor = bpy.context.object
floor.name = "Reference_Floor"
floor.data.materials.append(floor_material)

world = bpy.context.scene.world or bpy.data.worlds.new("Reference_World")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.055, 0.045, 0.038, 1.0)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.48

def area_light(name, location, energy, size, color):
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color
    light = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(light)
    light.location = location
    look_at(light, (center.x, center.y, center.z))


area_light("Key", (center.x + 3.2, center.y + 4.0, center.z + 2.5), 1250, 3.0, (1.0, 0.82, 0.68))
area_light("Fill", (center.x - 3.4, center.y + 1.6, center.z + 1.0), 850, 3.8, (0.58, 0.72, 1.0))
area_light("Rim", (center.x, center.y - 3.6, center.z + 2.2), 1100, 2.6, (1.0, 0.42, 0.28))

camera_data = bpy.data.cameras.new("Reference_Camera")
camera = bpy.data.objects.new("Reference_Camera", camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera.data.lens = 58

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 720
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.film_transparent = False
scene.render.image_settings.color_depth = "8"
scene.render.resolution_percentage = 100
scene.view_settings.look = "AgX - Medium High Contrast"

target = (center.x, center.y, minimum.z + height * 0.53)
distance = max(height * 1.75, width * 2.3)

for label, direction in (("front", 1.0), ("back", -1.0)):
    camera.location = (center.x, center.y + direction * distance, minimum.z + height * 0.56)
    look_at(camera, target)
    scene.render.filepath = str(output_prefix.parent / f"{output_prefix.name}-{label}.png")
    bpy.ops.render.render(write_still=True)

print(f"VRM_REFERENCE_RENDERED={output_prefix}-front.png|{output_prefix}-back.png")
