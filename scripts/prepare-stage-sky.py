from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source-assets" / "3d-stage" / "sky" / "chinese-garden-original.jpg"
OUTPUT = ROOT / "public" / "assets" / "3d-stage" / "sky"


def export_panorama(name: str, size: tuple[int, int], quality: int) -> None:
    with Image.open(SOURCE) as source:
        panorama = source.convert("RGB")
        panorama = panorama.resize(size, Image.Resampling.LANCZOS)
        panorama = ImageEnhance.Brightness(panorama).enhance(1.06)
        panorama = ImageEnhance.Color(panorama).enhance(0.92)
        panorama = panorama.filter(ImageFilter.UnsharpMask(radius=0.8, percent=45, threshold=4))
        OUTPUT.mkdir(parents=True, exist_ok=True)
        panorama.save(
            OUTPUT / name,
            "JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
            subsampling="4:2:0",
        )


if __name__ == "__main__":
    export_panorama("chinese-garden-sky-desktop.jpg", (3072, 1536), 82)
    export_panorama("chinese-garden-sky-mobile.jpg", (1536, 768), 78)
