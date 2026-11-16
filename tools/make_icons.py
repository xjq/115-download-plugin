# -*- coding: utf-8 -*-
# 生成扩展图标：绿色圆角方块 + 白色马蹄磁铁 + 下载箭头
import os
from PIL import Image, ImageDraw, ImageFont

SIZE = 512
BG_TOP = (43, 208, 107, 255)     # #2BD06B
BG_BOTTOM = (13, 150, 76, 255)   # #0D964C
LEG = (255, 255, 255, 255)
TIP = (209, 250, 229, 255)
TEXT_COLOR = (255, 255, 255, 255)

def build_base():
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    grad = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)) + (255,)
        gd.line([(0, y), (SIZE, y)], fill=c)
    mask = Image.new('L', (SIZE, SIZE), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([10, 10, SIZE - 10, SIZE - 10], radius=112, fill=255)
    bg = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    bg.paste(grad, (0, 0), mask)
    return Image.alpha_composite(img, bg)

def draw_magnet(img):
    d = ImageDraw.Draw(img)
    cx, cy = 256, 306
    r_out, r_in = 152, 92
    top_y = 118
    tip_h = 46
    d.pieslice([cx - r_out, cy - r_out, cx + r_out, cy + r_out], 180, 360, fill=LEG)
    d.pieslice([cx - r_in, cy - r_in, cx + r_in, cy + r_in], 180, 360, fill=BG_TOP)
    d.rectangle([cx - r_out, top_y, cx - r_in, cy], fill=LEG)
    d.rectangle([cx + r_in, top_y, cx + r_out, cy], fill=LEG)
    d.rectangle([cx - r_out, top_y, cx - r_in, top_y + tip_h], fill=TIP)
    d.rectangle([cx + r_in, top_y, cx + r_out, top_y + tip_h], fill=TIP)
    ax = cx
    ay0, ay1 = cy - r_in + 34, cy - r_in + 96
    d.line([(ax, ay0), (ax, ay1)], fill=LEG, width=30)
    d.line([(ax - 32, ay1 - 30), (ax, ay1)], fill=LEG, width=30)
    d.line([(ax + 32, ay1 - 30), (ax, ay1)], fill=LEG, width=30)
    return img

def draw_text(img):
    d = ImageDraw.Draw(img)
    font = None
    for path in [
        r'C:\Windows\Fonts\seguisb.ttf',
        r'C:\Windows\Fonts\arialbd.ttf',
        r'C:\Windows\Fonts\msyhbd.ttc',
    ]:
        try:
            font = ImageFont.truetype(path, 86)
            break
        except Exception:
            pass
    if font is None:
        font = ImageFont.load_default()
    text = '115'
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    x = (SIZE - w) / 2 - bbox[0]
    d.text((x, 150), text, font=font, fill=TEXT_COLOR)
    return img

def main():
    out_dir = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons'))
    os.makedirs(out_dir, exist_ok=True)
    img = draw_text(draw_magnet(build_base()))
    for size in (128, 48, 32, 16):
        img.resize((size, size), Image.LANCZOS).save(os.path.join(out_dir, 'icon%d.png' % size))
        print('saved icon%d.png' % size)

if __name__ == '__main__':
    main()
