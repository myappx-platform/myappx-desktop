#!/usr/bin/env python3
"""Generate MyEDI Desktop icon assets from myedi desktop.png."""

from __future__ import annotations

import base64
import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'src' / 'assets'
LINUX = ASSETS / 'linux'
WINDOWS = ASSETS / 'windows'
SOURCE = ASSETS / 'myedi desktop.png'
MASTER_SOURCE = ASSETS / 'myedi-appicon-master.png'

OUTPUTS = {
    ASSETS / 'appicon_48.png': 48,
    ASSETS / 'appicon_64.png': 64,
    ASSETS / 'appicon_with_spacing_32.png': 32,
    ASSETS / 'icon.png': 256,
    ASSETS / 'icon2.png': 1024,
    LINUX / 'app_icon.png': 256,
}

TRAY_ICONS = {
    'tray_light.ico': None,
    'tray_dark.ico': None,
    'tray_light_unread.ico': 'unread',
    'tray_dark_unread.ico': 'unread',
    'tray_light_mention.ico': 'mention',
    'tray_dark_mention.ico': 'mention',
}

ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
TRAY_SIZE = 32
TRAY_LOGO_SCALE = 0.875
TRAY_BADGE_RADIUS = 5
UNREAD_BADGE = (0, 229, 255, 255)
MENTION_BADGE = (255, 23, 68, 255)


def load_source() -> Image.Image:
    if not SOURCE.exists():
        print(f'Missing source image: {SOURCE}', file=sys.stderr)
        raise SystemExit(1)
    image = Image.open(SOURCE).convert('RGBA')
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)
    return image


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


def render_tray_icon(source: Image.Image, badge: str | None = None) -> Image.Image:
    icon = fit_square(source, TRAY_SIZE, scale=TRAY_LOGO_SCALE)
    if badge is None:
        return icon

    draw = ImageDraw.Draw(icon)
    badge_x = TRAY_SIZE - TRAY_BADGE_RADIUS - 2
    badge_y = TRAY_SIZE - TRAY_BADGE_RADIUS - 2
    color = UNREAD_BADGE if badge == 'unread' else MENTION_BADGE
    draw.ellipse(
        (
            badge_x - TRAY_BADGE_RADIUS,
            badge_y - TRAY_BADGE_RADIUS,
            badge_x + TRAY_BADGE_RADIUS,
            badge_y + TRAY_BADGE_RADIUS,
        ),
        fill=color,
        outline=(0, 0, 0, 255),
        width=1,
    )
    return icon


def write_embedded_svg(image: Image.Image, output: Path, display_size: int) -> None:
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    view_size = image.size[0]
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="{display_size}"
     height="{display_size}"
     viewBox="0 0 {view_size} {view_size}">
  <image href="data:image/png;base64,{encoded}"
         width="{view_size}"
         height="{view_size}"/>
</svg>
'''
    output.write_text(svg, encoding='utf-8')


def main() -> int:
    LINUX.mkdir(parents=True, exist_ok=True)
    WINDOWS.mkdir(parents=True, exist_ok=True)

    source = load_source()
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

    for filename, badge in TRAY_ICONS.items():
        tray_path = WINDOWS / filename
        render_tray_icon(source, badge).save(
            tray_path,
            format='ICO',
            sizes=[(TRAY_SIZE, TRAY_SIZE)],
        )
        print(f'Wrote {tray_path}')

    write_embedded_svg(resize_logo(source, 1024), ASSETS / 'myedi-logo.svg', 1024)
    print(f'Wrote {ASSETS / "myedi-logo.svg"}')

    write_embedded_svg(resize_logo(source, 256), ASSETS / 'icon.svg', 256)
    print(f'Wrote {ASSETS / "icon.svg"}')

    write_embedded_svg(resize_logo(source, 1024), ASSETS / 'myedi-appicon.svg', 1024)
    print(f'Wrote {ASSETS / "myedi-appicon.svg"}')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
