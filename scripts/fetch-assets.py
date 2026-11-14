#!/usr/bin/env python3
"""
Letölti és előkészíti az eredeti webes felület vizuális elemeit (a repó nem tartalmazza őket):
  • betűtípusok: DM Sans (törzsszöveg), Space Grotesk (címek) – mint a webes verzióban;
  • Lucide ikonok (ugyanaz a készlet és verzió, mint a lucide-react-ben): Android VectorDrawable + iOS SVG-képkészlet.
A CI minden build előtt lefuttatja. Helyi fejlesztéskor: `python3 scripts/fetch-assets.py`.
"""
import json, os, re, sys, urllib.request, xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LUCIDE_VERSION = "0.575.0"   # a webes app lucide-react verziója
ICONS = [
    "play", "pause", "users", "settings-2", "navigation-2", "sun", "moon", "footprints", "bike", "car", "plus", "battery", "map-pin",
    "check", "log-out", "chevron-right", "chevron-left", "chevron-down", "chevron-up", "trash-2", "qr-code", "x", "door-open",
    "shield-check", "circle-help", "scan-line", "camera", "image-plus", "copy", "share-2", "lock-keyhole", "bell", "battery-charging",
    "crosshair", "bug", "palette", "image-plus", "log-out",
]
ALIASES = {"circle-help": ["help-circle"]}
FONTS = {
    "DMSans.ttf": ["https://github.com/google/fonts/raw/main/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf",
                   "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/dmsans/DMSans%5Bopsz%2Cwght%5D.ttf"],
    "SpaceGrotesk.ttf": ["https://github.com/google/fonts/raw/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf",
                         "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf"],
}

def get(urls):
    last = None
    for u in urls:
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "privateplace-assets"}), timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa
            last = e
    raise RuntimeError(f"letöltés sikertelen: {urls[0]} ({last})")

def num(x, d=0.0):
    return float(x) if x not in (None, "") else d

def fmt(v):
    s = ("%.4f" % v).rstrip("0").rstrip(".")
    return s if s else "0"

def element_path(el):
    tag = el.tag.split("}")[-1]
    a = el.attrib
    if tag == "path":
        return a["d"]
    if tag == "circle":
        cx, cy, r = num(a.get("cx")), num(a.get("cy")), num(a.get("r"))
        return f"M{fmt(cx - r)} {fmt(cy)}a{fmt(r)} {fmt(r)} 0 1 0 {fmt(2 * r)} 0a{fmt(r)} {fmt(r)} 0 1 0 {fmt(-2 * r)} 0z"
    if tag == "ellipse":
        cx, cy, rx, ry = num(a.get("cx")), num(a.get("cy")), num(a.get("rx")), num(a.get("ry"))
        return f"M{fmt(cx - rx)} {fmt(cy)}a{fmt(rx)} {fmt(ry)} 0 1 0 {fmt(2 * rx)} 0a{fmt(rx)} {fmt(ry)} 0 1 0 {fmt(-2 * rx)} 0z"
    if tag == "rect":
        x, y, w, h = num(a.get("x")), num(a.get("y")), num(a.get("width")), num(a.get("height"))
        rx = num(a.get("rx"), num(a.get("ry")))
        ry = num(a.get("ry"), rx)
        if rx <= 0:
            return f"M{fmt(x)} {fmt(y)}h{fmt(w)}v{fmt(h)}h{fmt(-w)}z"
        return (f"M{fmt(x + rx)} {fmt(y)}h{fmt(w - 2 * rx)}a{fmt(rx)} {fmt(ry)} 0 0 1 {fmt(rx)} {fmt(ry)}v{fmt(h - 2 * ry)}"
                f"a{fmt(rx)} {fmt(ry)} 0 0 1 {fmt(-rx)} {fmt(ry)}h{fmt(-(w - 2 * rx))}a{fmt(rx)} {fmt(ry)} 0 0 1 {fmt(-rx)} {fmt(-ry)}"
                f"v{fmt(-(h - 2 * ry))}a{fmt(rx)} {fmt(ry)} 0 0 1 {fmt(rx)} {fmt(-ry)}z")
    if tag == "line":
        return f"M{a.get('x1')} {a.get('y1')}L{a.get('x2')} {a.get('y2')}"
    if tag in ("polyline", "polygon"):
        pts = [float(v) for v in re.split(r"[\s,]+", a["points"].strip()) if v]
        pairs = list(zip(pts[0::2], pts[1::2]))
        d = "M" + "L".join(f"{fmt(x)} {fmt(y)}" for x, y in pairs)
        return d + ("z" if tag == "polygon" else "")
    return None

def svg_to_vector(svg_text):
    root = ET.fromstring(svg_text)
    parts = []
    for el in root.iter():
        d = element_path(el)
        if not d:
            continue
        filled = el.attrib.get("fill", "none") not in ("none", "")
        extra = ' android:fillColor="#FFFFFFFF"' if filled else ""
        parts.append(f'    <path android:pathData="{d}"{extra} android:strokeColor="#FFFFFFFF" android:strokeWidth="2" '
                     f'android:strokeLineCap="round" android:strokeLineJoin="round"/>')
    if not parts:
        raise ValueError("üres ikon")
    return ('<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" '
            'android:viewportWidth="24" android:viewportHeight="24">\n' + "\n".join(parts) + "\n</vector>\n")

def write(path, data, mode="w"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode + ("b" if isinstance(data, bytes) else "")) as f:
        f.write(data)

def main():
    for name, urls in FONTS.items():
        data = get(urls)
        write(os.path.join(ROOT, "android/app/src/main/assets/fonts", name), data)
        write(os.path.join(ROOT, "ios/PrivatePlace/Fonts", name), data)
        print("betűtípus:", name, len(data))
    for icon in ICONS:
        urls = []
        for n in [icon] + ALIASES.get(icon, []):
            urls += [f"https://raw.githubusercontent.com/lucide-icons/lucide/{LUCIDE_VERSION}/icons/{n}.svg",
                     f"https://raw.githubusercontent.com/lucide-icons/lucide/v{LUCIDE_VERSION}/icons/{n}.svg",
                     f"https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/{n}.svg"]
        svg = get(urls).decode("utf-8")
        write(os.path.join(ROOT, "android/app/src/main/res/drawable", "ic_" + icon.replace("-", "_") + ".xml"), svg_to_vector(svg))
        ios_svg = svg.replace("currentColor", "#000000")
        base = os.path.join(ROOT, "ios/PrivatePlace/Assets.xcassets", f"lucide-{icon}.imageset")
        write(os.path.join(base, f"{icon}.svg"), ios_svg)
        write(os.path.join(base, "Contents.json"), json.dumps({
            "images": [{"filename": f"{icon}.svg", "idiom": "universal"}],
            "info": {"author": "xcode", "version": 1},
            "properties": {"preserves-vector-representation": True, "template-rendering-intent": "template"}}, indent=2))
        print("ikon:", icon)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        samples = {
            "play": '<svg viewBox="0 0 24 24"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
            "pause": '<svg><rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/></svg>',
            "plus": '<svg><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
            "pin": '<svg><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>',
            "line": '<svg><line x1="3" y1="4" x2="21" y2="4"/><polyline points="1 2 3 4 5 2"/></svg>',
        }
        for k, v in samples.items():
            out = svg_to_vector(v)
            ET.fromstring(out)
            print(k, "ok", out.count("<path"))
    else:
        main()
