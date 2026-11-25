"""Prepare a static FBX venue asset for the Three.js Yue Opera stage.

Run with Blender:
  blender --background --factory-startup --python scripts/prepare-venue-model.py -- \
    input.fbx output.glb [target_triangles] [target_width_m]
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


def script_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def mesh_objects() -> list[bpy.types.Object]:
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def triangle_count(objects: list[bpy.types.Object]) -> int:
    total = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    return total


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    corners = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    if not corners:
        raise RuntimeError("The imported file contains no mesh bounds.")
    return (
        Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners))),
        Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners))),
    )


def select_only(objects: list[bpy.types.Object]) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def main() -> None:
    args = script_args()
    if len(args) < 2:
        raise SystemExit("Expected input FBX and output GLB paths after --")

    source = Path(args[0]).resolve()
    output = Path(args[1]).resolve()
    target_triangles = int(args[2]) if len(args) > 2 else 60_000
    target_width = float(args[3]) if len(args) > 3 else 14.0
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source), use_image_search=True)

    meshes = mesh_objects()
    if not meshes:
        raise RuntimeError(f"No mesh objects imported from {source}")

    # FBX commonly places meshes under rotated/scaled helper empties. Detach them
    # while preserving the evaluated world transform before removing those helpers.
    for obj in meshes:
        world_matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world_matrix

    # Static venue assets must not bring cameras, lights or animation helpers into runtime.
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)

    meshes = mesh_objects()
    before_triangles = triangle_count(meshes)
    bounds_min, bounds_max = world_bounds(meshes)
    size = bounds_max - bounds_min
    horizontal_span = max(size.x, size.y, 0.001)
    scale = target_width / horizontal_span

    # FBX is Z-up. Center the pavilion horizontally and place its lowest point at z=0.
    center_x = (bounds_min.x + bounds_max.x) * 0.5
    center_y = (bounds_min.y + bounds_max.y) * 0.5
    venue_transform = Matrix.Translation((-center_x * scale, -center_y * scale, -bounds_min.z * scale)) @ Matrix.Scale(scale, 4)
    for obj in meshes:
        obj.matrix_world = venue_transform @ obj.matrix_world

    select_only(meshes)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Only decimate when the source actually exceeds the web budget. Architectural
    # silhouettes are kept intact by applying one conservative ratio per object.
    if before_triangles > target_triangles:
        ratio = max(0.35, target_triangles / before_triangles)
        for obj in meshes:
            if len(obj.data.polygons) < 120:
                continue
            modifier = obj.modifiers.new(name="WebDecimate", type="DECIMATE")
            modifier.decimate_type = "COLLAPSE"
            modifier.ratio = ratio
            modifier.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            obj.select_set(False)

    # Remove unused material slots, then merge the static architecture into one mesh.
    # The exported GLB keeps one primitive per material, but avoids one draw call and
    # transform update for every original FBX object.
    for obj in meshes:
        select_only([obj])
        bpy.ops.object.material_slot_remove_unused()
        obj["yueju_static_venue"] = True

    select_only(meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    merged = bpy.context.active_object
    merged.name = "Yueju_CC0_Chinese_Pavilion"
    merged["yueju_static_venue"] = True

    select_only([merged])
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )

    final_meshes = mesh_objects()
    final_min, final_max = world_bounds(final_meshes)
    stats = {
        "source": source.name,
        "output": output.name,
        "objects": len(final_meshes),
        "materials": len({mat.name for obj in final_meshes for mat in obj.data.materials if mat}),
        "triangles_before": before_triangles,
        "triangles_after": triangle_count(final_meshes),
        "dimensions_m": [round(v, 3) for v in (final_max - final_min)],
        "output_mb": round(output.stat().st_size / 1_048_576, 3),
    }
    print("YUEJU_VENUE_STATS=" + json.dumps(stats, ensure_ascii=False))


if __name__ == "__main__":
    main()
