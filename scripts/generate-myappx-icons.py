#!/usr/bin/env python3
"""Generate MyAppx Desktop icon assets from the MyAppx brand logo.

Sources (both live in ``src/assets/MyAppx-logo-B-ui``):

* ``myappx-logo-1024.png`` - full colour app icon, used for every bitmap/ICO/ICNS
  output, including the Windows tray icons.
* ``myappx-logo.svg`` - vector source, used to rasterise the flat monochrome
  glyph for the Linux and macOS menu bar icons, and to build the download
  thumbnail, so it stays crisp at 16-32 px.

The Windows tray keeps the full colour brand icon (opaque blue tile) instead of a
monochrome glyph, so it reads the same on light and dark taskbars.
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'src' / 'assets'
LINUX = ASSETS / 'linux'
OSX = ASSETS / 'osx' / 'menuIcons'
WINDOWS = ASSETS / 'windows'

BRAND = ASSETS / 'MyAppx-logo-B-ui'
SOURCE = BRAND / 'myappx-logo-1024.png'
BRAND_SVG = BRAND / 'myappx-logo.svg'
THUMBNAILS = ASSETS / 'thumbnails'
THUMBNAIL_SVG = THUMBNAILS / 'myappx.svg'

MASTER_SOURCE = ASSETS / 'myappx-appicon-master.png'

OUTPUTS = {
    ASSETS / 'appicon_48.png': 48,
    ASSETS / 'appicon_64.png': 64,
    ASSETS / 'appicon_with_spacing_32.png': 32,
    ASSETS / 'icon.png': 256,
    ASSETS / 'icon2.png': 1024,
    LINUX / 'app_icon.png': 256,
}

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024]

# Glyph colours for the flat monochrome icons. macOS menu bar icons are template
# images, so the drawing colour is ignored there and black is the correct value.
GLYPH_ON_DARK_TASKBAR = (255, 255, 255)
GLYPH_ON_LIGHT_TASKBAR = (50, 49, 48)
GLYPH_TEMPLATE = (0, 0, 0)

TRAY_SIZE = 32
# Sizes embedded in each tray ICO, so Windows can pick a frame that is already
# rendered at the taskbar DPI instead of rescaling a single bitmap.
TRAY_ICO_SIZES = [16, 20, 24, 32, 40, 48]
# Optical margin so the blue tile does not touch the taskbar edge.
TRAY_TILE_SCALE = 0.96
TRAY_BADGE_RADIUS = 5
UNREAD_BADGE = (0, 229, 255, 255)
MENTION_BADGE = (255, 23, 68, 255)

# Windows tray keeps the full colour brand icon; both theme files hold the same
# artwork because the opaque tile reads on light and dark taskbars alike.
TRAY_ICONS = {
    'tray_light.ico': None,
    'tray_dark.ico': None,
    'tray_light_unread.ico': 'unread',
    'tray_dark_unread.ico': 'unread',
    'tray_light_mention.ico': 'mention',
    'tray_dark_mention.ico': 'mention',
}

LINUX_ICONS = {
    'top_bar_light_16.png': (GLYPH_ON_DARK_TASKBAR, None),
    'top_bar_dark_16.png': (GLYPH_ON_LIGHT_TASKBAR, None),
    'top_bar_light_unread_16.png': (GLYPH_ON_DARK_TASKBAR, 'unread'),
    'top_bar_dark_unread_16.png': (GLYPH_ON_LIGHT_TASKBAR, 'unread'),
    'top_bar_light_mention_16.png': (GLYPH_ON_DARK_TASKBAR, 'mention'),
    'top_bar_dark_mention_16.png': (GLYPH_ON_LIGHT_TASKBAR, 'mention'),
}

OSX_ICONS = {
    'MenuIcon16Template.png': 16,
    'MenuIcon20Template.png': 20,
    'MenuIcon24Template.png': 24,
    'MenuIcon32Template.png': 32,
    'MenuIconUnread16Template.png': 16,
    'MenuIconUnread20Template.png': 20,
    'MenuIconUnread24Template.png': 24,
    'MenuIconUnread32Template.png': 32,
}

SUPERSAMPLE = 8
GLYPH_OPTICAL_SCALE = 0.88
# The download dropdown paints the thumbnail at 32x32 CSS pixels.
THUMBNAIL_SIZE = 32


def load_source() -> Image.Image:
    if not SOURCE.exists():
        print(f'Missing source image: {SOURCE}', file=sys.stderr)
        raise SystemExit(1)
    return Image.open(SOURCE).convert('RGBA')


def read_glyph_polygons(path: Path = BRAND_SVG) -> list[list[tuple[float, float]]]:
    """Read the white glyph of the brand SVG as a list of polygons.

    The glyph is drawn with straight edges only, so every ``d`` attribute that
    starts with ``M`` and contains ``L``/``Z`` commands can be treated as one
    polygon - which is exactly what Pillow can fill.
    """
    text = path.read_text(encoding='utf-8')
    polygons = []
    for attributes in re.findall(r'<path\b([^>]*?)/>', text, re.S):
        if 'fill="#FFFFFF"' not in attributes:
            continue
        body = re.search(r'\sd="([^"]+)"', attributes)
        if not body:
            continue
        commands = re.findall(r'[MLZmlz]|-?\d+(?:\.\d+)?', body.group(1))
        points: list[tuple[float, float]] = []
        index = 0
        while index < len(commands):
            command = commands[index].upper()
            index += 1
            if command == 'M':
                x, y = float(commands[index]), float(commands[index + 1])
                index += 2
                points.append((x, y))
            elif command == 'L':
                while index + 1 < len(commands) and not commands[index].isalpha():
                    x, y = float(commands[index]), float(commands[index + 1])
                    index += 2
                    points.append((x, y))
        if points:
            polygons.append(points)
    if not polygons:
        print(f'No glyph polygons found in {path}', file=sys.stderr)
        raise SystemExit(1)
    return polygons


def render_glyph(polygons: list[list[tuple[float, float]]], size: int, scale: float = GLYPH_OPTICAL_SCALE) -> Image.Image:
    """Rasterise the glyph into a square alpha mask with a transparent margin."""
    xs = [x for polygon in polygons for x, _ in polygon]
    ys = [y for polygon in polygons for _, y in polygon]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    width = max_x - min_x
    height = max_y - min_y

    canvas_size = size * SUPERSAMPLE
    inner = canvas_size * scale
    factor = inner / max(width, height)
    offset_x = (canvas_size - width * factor) / 2
    offset_y = (canvas_size - height * factor) / 2

    canvas = Image.new('L', (canvas_size, canvas_size), 0)
    draw = ImageDraw.Draw(canvas)
    for polygon in polygons:
        draw.polygon(
            [((x - min_x) * factor + offset_x, (y - min_y) * factor + offset_y) for x, y in polygon],
            fill=255,
        )
    return canvas.resize((size, size), Image.Resampling.LANCZOS)


def read_tile_bounds(path: Path = BRAND_SVG) -> tuple[float, float, float, float]:
    """Return the coordinate bounds of the brand tile (the gradient-filled path)."""
    text = path.read_text(encoding='utf-8')
    match = re.search(r'<path\b[^>]*fill="url\(#icon-bg\)"[^>]*d="([^"]+)"', text, re.S) or \
        re.search(r'<path\b[^>]*d="([^"]+)"[^>]*fill="url\(#icon-bg\)"', text, re.S)
    if not match:
        print(f'No tile path found in {path}', file=sys.stderr)
        raise SystemExit(1)
    numbers = [float(value) for value in re.findall(r'-?\d+(?:\.\d+)?', match.group(1))]
    xs = numbers[0::2]
    ys = numbers[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def write_thumbnail_svg(size: int = THUMBNAIL_SIZE, source: Path = BRAND_SVG, output: Path = THUMBNAIL_SVG) -> None:
    """Write the download thumbnail from the brand SVG.

    The brand artwork carries a transparent margin around the tile, so the tile
    bounds are scaled to fill the thumbnail box - the download dropdown paints
    the icon at exactly ``size`` pixels.
    """
    text = source.read_text(encoding='utf-8')
    defs = re.search(r'<defs>.*?</defs>', text, re.S)
    paths = re.findall(r'<path\b[^>]*?/>', text, re.S)

    min_x, min_y, max_x, max_y = read_tile_bounds(source)
    span = max(max_x - min_x, max_y - min_y)
    if span <= 0:
        print(f'Invalid tile bounds in {source}', file=sys.stderr)
        raise SystemExit(1)
    scale = size / span

    body = '\n'.join(f'    {path.strip()}' for path in paths)
    defs_block = f'  {defs.group(0)}\n' if defs else ''
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <title>MyAppx</title>
{defs_block}  <g transform="scale({scale:.6f}) translate({-min_x:.2f} {-min_y:.2f})">
{body}
  </g>
</svg>
'''
    output.write_text(svg, encoding='utf-8')


def fit_square(source: Image.Image, size: int, scale: float = 1.0) -> Image.Image:
    inner = max(1, round(size * scale))
    ratio = min(inner / source.width, inner / source.height)
    width = max(1, round(source.width * ratio))
    height = max(1, round(source.height * ratio))
    resized = source.resize((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    offset = ((size - width) // 2, (size - height) // 2)
    canvas.paste(resized, offset, resized)
    return canvas


def resize_logo(source: Image.Image, size: int) -> Image.Image:
    return fit_square(source, size)


def resize_with_spacing(source: Image.Image, canvas_size: int, scale: float = 0.8125) -> Image.Image:
    return fit_square(source, canvas_size, scale=scale)


def render_tray_icon(source: Image.Image, size: int, badge: str | None = None) -> Image.Image:
    """Render the full colour brand tile used by the Windows tray icons.

    The brand PNG carries a transparent margin around the rounded square, so the
    artwork is cropped to its bounds first; otherwise that margin would show up
    as transparency in the tray.
    """
    bounds = source.getbbox()
    artwork = source.crop(bounds) if bounds else source
    icon = fit_square(artwork, size, scale=TRAY_TILE_SCALE)
    if badge is None:
        return icon

    draw = ImageDraw.Draw(icon)
    radius = max(2, round(size * TRAY_BADGE_RADIUS / TRAY_SIZE))
    ring = max(1, round(size / TRAY_SIZE))
    center_x = size - radius - ring - 2
    center_y = size - radius - ring - 2
    # White ring keeps the badge readable where it overlaps the blue tile.
    draw.ellipse(
        (
            center_x - radius - ring,
            center_y - radius - ring,
            center_x + radius + ring,
            center_y + radius + ring,
        ),
        fill=(255, 255, 255, 255),
    )
    draw.ellipse(
        (
            center_x - radius,
            center_y - radius,
            center_x + radius,
            center_y + radius,
        ),
        fill=UNREAD_BADGE if badge == 'unread' else MENTION_BADGE,
    )
    return icon


def render_mono_icon(mask: Image.Image, size: int, color: tuple[int, int, int], badge: str | None = None) -> Image.Image:
    icon = Image.new('RGBA', (size, size), color + (0,))
    icon.putalpha(mask)
    if badge is None:
        return icon

    draw = ImageDraw.Draw(icon)
    radius = max(2, round(size * TRAY_BADGE_RADIUS / TRAY_SIZE))
    center_x = size - radius - 1
    center_y = size - radius - 1
    # Punch a hole around the badge so it stays readable on light and dark bars.
    draw.ellipse(
        (
            center_x - radius - 2,
            center_y - radius - 2,
            center_x + radius + 2,
            center_y + radius + 2,
        ),
        fill=(0, 0, 0, 0),
    )
    draw.ellipse(
        (
            center_x - radius,
            center_y - radius,
            center_x + radius,
            center_y + radius,
        ),
        fill=UNREAD_BADGE if badge == 'unread' else MENTION_BADGE,
    )
    return icon


def main() -> int:
    for directory in (LINUX, WINDOWS, OSX):
        directory.mkdir(parents=True, exist_ok=True)

    source = load_source()
    polygons = read_glyph_polygons()
    glyph_cache: dict[int, Image.Image] = {}

    def glyph(size: int) -> Image.Image:
        if size not in glyph_cache:
            glyph_cache[size] = render_glyph(polygons, size)
        return glyph_cache[size]

    master = resize_logo(source, 1024)
    master.save(MASTER_SOURCE, format='PNG')
    print(f'Wrote {MASTER_SOURCE} (1024x1024)')

    for output, size in OUTPUTS.items():
        if output.name == 'appicon_with_spacing_32.png':
            image = resize_with_spacing(source, size)
        else:
            image = resize_logo(source, size)
        image.save(output, format='PNG')
        print(f'Wrote {output} ({size}x{size})')

    icon_ico = ASSETS / 'icon.ico'
    ico_frames = [resize_logo(source, size) for size in ICO_SIZES]
    # Pillow only embeds all ICO sizes when the largest frame is saved first.
    ico_frames[-1].save(
        icon_ico,
        format='ICO',
        sizes=[(size, size) for size in ICO_SIZES],
        append_images=ico_frames[:-1],
    )
    print(f'Wrote {icon_ico} ({len(ICO_SIZES)} sizes)')

    icon_icns = ASSETS / 'icon.icns'
    icns_frames = [resize_logo(source, size) for size in ICNS_SIZES]
    icns_frames[-1].save(
        icon_icns,
        format='ICNS',
        append_images=icns_frames[:-1],
    )
    print(f'Wrote {icon_icns} ({len(ICNS_SIZES)} sizes)')

    for filename, badge in TRAY_ICONS.items():
        tray_path = WINDOWS / filename
        tray_frames = [render_tray_icon(source, size, badge) for size in TRAY_ICO_SIZES]
        tray_frames[-1].save(
            tray_path,
            format='ICO',
            sizes=[(size, size) for size in TRAY_ICO_SIZES],
            append_images=tray_frames[:-1],
        )
        print(f'Wrote {tray_path} ({len(TRAY_ICO_SIZES)} sizes)')

    for filename, (color, badge) in LINUX_ICONS.items():
        base = filename[:-len('_16.png')]
        for suffix, size in (('_16.png', 16), ('_16@2x.png', 32)):
            path = LINUX / f'{base}{suffix}'
            render_mono_icon(glyph(size), size, color, badge).save(path, format='PNG')
            print(f'Wrote {path}')

    for filename, size in OSX_ICONS.items():
        badge = 'unread' if 'Unread' in filename else None
        stem = filename[:-len('.png')]
        render_mono_icon(glyph(size), size, GLYPH_TEMPLATE, badge).save(OSX / filename, format='PNG')
        render_mono_icon(glyph(size * 2), size * 2, GLYPH_TEMPLATE, badge).save(OSX / f'{stem}@2x.png', format='PNG')
        print(f'Wrote {OSX / filename} (+ @2x)')

    for target in ('myappx-logo.svg', 'icon.svg', 'myappx-appicon.svg'):
        shutil.copyfile(BRAND_SVG, ASSETS / target)
        print(f'Wrote {ASSETS / target}')

    write_thumbnail_svg()
    print(f'Wrote {THUMBNAIL_SVG} ({THUMBNAIL_SIZE}x{THUMBNAIL_SIZE})')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
