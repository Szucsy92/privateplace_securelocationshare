"""Android ikonok és indítókép előállítása az assets/icon-only.png-ből.

Az eredmény az assets/android-res/ mappába kerül (be van vezetve a tárolóba),
a scripts/patch-android.mjs építéskor rámásolja a generált Android projektre.
Újragenerálás (ha új ikon kell): python3 scripts/make-android-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon-only.png"
OUT = ROOT / "assets" / "android-res"
BG = (0x12, 0x1A, 0x2B)

DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
SPLASH = {
    "drawable": (480, 320),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
}


def masked(img: Image.Image, size: int, radius_ratio: float) -> Image.Image:
    icon = img.resize((size, size), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (size * 4, size * 4), 0)
    r = int(size * 4 * radius_ratio)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=r, fill=255)
    icon.putalpha(mask.resize((size, size), Image.LANCZOS))
    return icon


def main():
    src = Image.open(SRC).convert("RGB")
    for name, size in DENSITIES.items():
        d = OUT / f"mipmap-{name}"
        d.mkdir(parents=True, exist_ok=True)
        # Régi (Android 7 és korábbi) ikonok
        masked(src, size, 0.22).save(d / "ic_launcher.png")
        masked(src, size, 0.5).save(d / "ic_launcher_round.png")
        # Rétegzett ikon (Android 8+): előtér 108dp, a telefon maga vágja körre/négyzetre
        fg = int(size * 108 / 48)
        src.resize((fg, fg), Image.LANCZOS).save(d / "ic_launcher_foreground.png")

    for folder, (w, h) in SPLASH.items():
        d = OUT / folder
        d.mkdir(parents=True, exist_ok=True)
        canvas = Image.new("RGB", (w, h), BG)
        s = int(min(w, h) * 0.5)
        logo = masked(src, s, 0.5)
        canvas.paste(logo, ((w - s) // 2, (h - s) // 2), logo)
        canvas.save(d / "splash.png")

    anydpi = OUT / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        "</adaptive-icon>\n"
    )
    (anydpi / "ic_launcher.xml").write_text(xml)
    (anydpi / "ic_launcher_round.xml").write_text(xml)

    values = OUT / "values"
    values.mkdir(parents=True, exist_ok=True)
    (values / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#121A2B</color>\n</resources>\n'
    )
    print("Kész:", OUT)


if __name__ == "__main__":
    main()
