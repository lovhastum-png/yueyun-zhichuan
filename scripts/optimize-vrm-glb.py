import json
import shutil
import struct
import sys
import tempfile
from pathlib import Path

import bpy


HIDDEN_COSTUME_IMAGES = {
    "_14",
    "_15",
    "_16",
    "衣袖",
    "深绿长袍三视图与贴图展开图1",
    "深绿长袍三视图与贴图展开图2",
    "深绿长袍三视图与贴图展开图3",
    "深绿长袍三视图与贴图展开图4",
    "帽顶",
    "装饰上",
    "装饰中",
    "装饰下",
}


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) < 2:
        raise SystemExit("usage: blender --background --python optimize-vrm-glb.py -- INPUT.vrm OUTPUT.vrm [VISIBLE_MAX]")
    visible_max = int(values[2]) if len(values) > 2 else 1024
    return Path(values[0]).resolve(), Path(values[1]).resolve(), visible_max


def read_glb(path):
    data = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or total_length != len(data):
        raise ValueError("input is not a valid GLB/VRM 2.0 container")
    offset = 12
    json_length, json_type = struct.unpack_from("<II", data, offset)
    offset += 8
    if json_type != 0x4E4F534A:
        raise ValueError("GLB JSON chunk is missing")
    document = json.loads(data[offset : offset + json_length].rstrip(b" \x00").decode("utf-8"))
    offset += json_length
    binary_length, binary_type = struct.unpack_from("<II", data, offset)
    offset += 8
    if binary_type != 0x004E4942:
        raise ValueError("GLB BIN chunk is missing")
    return document, data[offset : offset + binary_length]


def write_glb(path, document, binary):
    document["buffers"][0]["byteLength"] = len(binary)
    encoded_json = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded_json += b" " * ((4 - len(encoded_json) % 4) % 4)
    binary += b"\x00" * ((4 - len(binary) % 4) % 4)
    total_length = 12 + 8 + len(encoded_json) + 8 + len(binary)
    payload = bytearray()
    payload += struct.pack("<4sII", b"glTF", 2, total_length)
    payload += struct.pack("<II", len(encoded_json), 0x4E4F534A)
    payload += encoded_json
    payload += struct.pack("<II", len(binary), 0x004E4942)
    payload += binary
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def resize_png(payload, name, target_size, work_dir, scene):
    source_path = work_dir / f"source-{name}.png"
    output_path = work_dir / f"optimized-{name}.png"
    source_path.write_bytes(payload)
    image = bpy.data.images.load(str(source_path), check_existing=False)
    width, height = int(image.size[0]), int(image.size[1])
    if max(width, height) <= target_size:
        bpy.data.images.remove(image)
        return payload, width, height, width, height
    scale = target_size / max(width, height)
    optimized_width = max(1, round(width * scale))
    optimized_height = max(1, round(height * scale))
    image.scale(optimized_width, optimized_height)
    image.filepath_raw = str(output_path)
    image.file_format = "PNG"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 72
    image.save()
    optimized = output_path.read_bytes()
    bpy.data.images.remove(image)
    return optimized, width, height, optimized_width, optimized_height


def main():
    source, destination, visible_max = parse_args()
    document, binary = read_glb(source)
    buffer_views = document.get("bufferViews", [])
    replacements = {}
    reports = []
    work_dir = Path(tempfile.mkdtemp(prefix="yueju-vrm-optimize-"))
    scene = bpy.context.scene
    try:
        for index, image_info in enumerate(document.get("images", [])):
            if image_info.get("mimeType") != "image/png" or "bufferView" not in image_info:
                continue
            view_index = image_info["bufferView"]
            view = buffer_views[view_index]
            start = int(view.get("byteOffset", 0))
            end = start + int(view["byteLength"])
            payload = binary[start:end]
            name = image_info.get("name") or f"image-{index}"
            target_size = 256 if name in HIDDEN_COSTUME_IMAGES or name == "Thumbnail" else visible_max
            optimized, old_width, old_height, new_width, new_height = resize_png(
                payload,
                f"{index:02d}",
                target_size,
                work_dir,
                scene,
            )
            if len(optimized) < len(payload):
                replacements[view_index] = optimized
                reports.append({
                    "image": name,
                    "old": len(payload),
                    "new": len(optimized),
                    "size": f"{old_width}x{old_height}->{new_width}x{new_height}",
                })

        rebuilt = bytearray()
        for view_index, view in enumerate(buffer_views):
            while len(rebuilt) % 4:
                rebuilt.append(0)
            source_start = int(view.get("byteOffset", 0))
            source_end = source_start + int(view["byteLength"])
            payload = replacements.get(view_index, binary[source_start:source_end])
            view["byteOffset"] = len(rebuilt)
            view["byteLength"] = len(payload)
            rebuilt.extend(payload)

        write_glb(destination, document, bytes(rebuilt))
        print("VRM_OPTIMIZED=" + json.dumps({
            "source": str(source),
            "destination": str(destination),
            "oldBytes": source.stat().st_size,
            "newBytes": destination.stat().st_size,
            "images": reports,
        }, ensure_ascii=False))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


main()
