from pathlib import Path

from PIL import Image, ImageOps


source_dir = Path("public/assets/virtual-tryon/headwear")
output_dir = source_dir / "optimized"
output_dir.mkdir(exist_ok=True)

for source_path in sorted(source_dir.glob("*.png")):
    image = Image.open(source_path).convert("RGBA")
    alpha_box = image.getchannel("A").getbbox()
    if not alpha_box:
        raise RuntimeError(f"No visible pixels in {source_path}")
    cropped = ImageOps.expand(
        image.crop(alpha_box),
        border=6,
        fill=(0, 0, 0, 0),
    )
    cropped.thumbnail((512, 512), Image.Resampling.LANCZOS)
    output_path = output_dir / f"{source_path.stem}-512.webp"
    cropped.save(output_path, "WEBP", quality=84, method=6, exact=True)
    print(output_path.name, cropped.size, output_path.stat().st_size)
