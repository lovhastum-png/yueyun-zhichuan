"""Create a web-sized VRM while preserving all VRM/glTF extensions and bone data."""

from __future__ import annotations

import argparse
import io
import json
import struct
from pathlib import Path

from PIL import Image


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or total_length != len(data):
        raise ValueError("Input is not a valid glTF 2.0 binary file")

    json_chunk = None
    binary_chunk = None
    offset = 12
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8 : offset + 8 + chunk_length]
        if chunk_type == JSON_CHUNK:
            json_chunk = chunk
        elif chunk_type == BIN_CHUNK:
            binary_chunk = chunk
        offset += 8 + chunk_length

    if json_chunk is None or binary_chunk is None:
        raise ValueError("The VRM must contain JSON and BIN chunks")

    document = json.loads(json_chunk.decode("utf-8").rstrip("\x00 "))
    return document, binary_chunk


def resize_image(payload: bytes, mime_type: str, max_size: int) -> tuple[bytes, tuple[int, int], tuple[int, int]]:
    with Image.open(io.BytesIO(payload)) as source:
        source.load()
        before = source.size
        if max(before) <= max_size:
            return payload, before, before

        ratio = max_size / max(before)
        after = (max(1, round(before[0] * ratio)), max(1, round(before[1] * ratio)))
        resized = source.resize(after, Image.Resampling.LANCZOS)
        output = io.BytesIO()
        if mime_type == "image/jpeg":
            resized.convert("RGB").save(output, format="JPEG", quality=88, optimize=True, progressive=True)
        else:
            resized.save(output, format="PNG", optimize=True, compress_level=9)
        return output.getvalue(), before, after


def optimise(source: Path, destination: Path, max_texture: int, max_thumbnail: int) -> None:
    document, original_bin = read_glb(source)
    buffer_views = document.get("bufferViews", [])
    images = document.get("images", [])

    image_by_view: dict[int, list[tuple[int, dict]]] = {}
    for image_index, image in enumerate(images):
        if "bufferView" in image:
            image_by_view.setdefault(image["bufferView"], []).append((image_index, image))

    replacement_payloads: dict[int, bytes] = {}
    changes: list[dict] = []
    for view_index, entries in image_by_view.items():
        view = buffer_views[view_index]
        start = view.get("byteOffset", 0)
        payload = original_bin[start : start + view["byteLength"]]
        image_index, image = entries[0]
        mime_type = image.get("mimeType", "image/png")
        is_thumbnail = image.get("name") == "Thumbnail"
        limit = max_thumbnail if is_thumbnail else max_texture
        resized, before, after = resize_image(payload, mime_type, limit)
        replacement_payloads[view_index] = resized
        if before != after or len(payload) != len(resized):
            changes.append(
                {
                    "image": image_index,
                    "name": image.get("name", ""),
                    "before": before,
                    "after": after,
                    "bytes_before": len(payload),
                    "bytes_after": len(resized),
                }
            )

    rebuilt = bytearray()
    for view_index, view in enumerate(buffer_views):
        while len(rebuilt) % 4:
            rebuilt.append(0)
        original_start = view.get("byteOffset", 0)
        payload = replacement_payloads.get(
            view_index,
            original_bin[original_start : original_start + view["byteLength"]],
        )
        view["buffer"] = 0
        view["byteOffset"] = len(rebuilt)
        view["byteLength"] = len(payload)
        rebuilt.extend(payload)

    document["buffers"][0]["byteLength"] = len(rebuilt)
    json_bytes = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    bin_bytes = bytes(rebuilt)
    bin_bytes += b"\x00" * ((4 - len(bin_bytes) % 4) % 4)

    total_length = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    output = bytearray(struct.pack("<4sII", b"glTF", 2, total_length))
    output.extend(struct.pack("<II", len(json_bytes), JSON_CHUNK))
    output.extend(json_bytes)
    output.extend(struct.pack("<II", len(bin_bytes), BIN_CHUNK))
    output.extend(bin_bytes)

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(output)

    report = {
        "source": str(source),
        "destination": str(destination),
        "bytes_before": source.stat().st_size,
        "bytes_after": destination.stat().st_size,
        "saved_percent": round((1 - destination.stat().st_size / source.stat().st_size) * 100, 1),
        "changed_images": changes,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--max-texture", type=int, default=1024)
    parser.add_argument("--max-thumbnail", type=int, default=512)
    args = parser.parse_args()
    optimise(args.source, args.destination, args.max_texture, args.max_thumbnail)


if __name__ == "__main__":
    main()
