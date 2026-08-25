# -*- coding: utf-8 -*-
"""Картинки, которых сайту не хватало.

Две дыры закрываются здесь одним скриптом.

1. Установка на телефон. В манифесте была только SVG-иконка. Android Chrome
   предлагает «Установить приложение» лишь при наличии PNG 192 и 512,
   у iOS для домашнего экрана нужен apple-touch-icon. Значка на телефоне
   не появлялось ни у кого — а для сервиса, который должен использоваться
   ежедневно, значок на домашнем экране и есть главный способ возврата.

2. Превью ссылки. В og:image стоял icon.svg. Ни Telegram, ни ВКонтакте,
   ни WhatsApp не рисуют превью из SVG — им нужен PNG или JPEG 1200x630.
   Каждая ссылка, которой человек делился, приходила собеседнику голой.

Рисуем на месте, а не подключаем зависимость: логотип — это дюжина
геометрических примитивов, и держать ради них внешний конвертер SVG
дороже, чем повторить их здесь.

Запуск:  python make-images.py
"""

from PIL import Image, ImageDraw, ImageFont
import os, math

HERE = os.path.dirname(os.path.abspath(__file__))
SS = 4  # во столько раз рисуем крупнее и потом уменьшаем — так сглаживаются края

TEAL = (14, 143, 134)
GREEN = (34, 197, 94)
GOLD_LIGHT = (244, 221, 143)
GOLD_DARK = (177, 143, 31)
GOLD_DOT = (238, 214, 136)
INK = (7, 24, 22)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def diagonal_gradient(size, c1, c2):
    """Градиент по диагонали — тот же, что в icon.svg."""
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = lerp(c1, c2, (x / max(1, w - 1) + y / max(1, h - 1)) / 2)
    return img


def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
    return m


def draw_scales(d, cx, cy, scale, color=GOLD_LIGHT):
    """Весы правосудия. Координаты повторяют icon.svg (холст 512),
    поэтому правки логотипа переносятся сюда один в один."""
    def P(x, y):
        return (cx + (x - 256) * scale, cy + (y - 256) * scale)

    def W(w):
        return max(1, round(w * scale))

    # основание и ступень
    d.line([P(140, 420), P(372, 420)], fill=color, width=W(16))
    for a, b in [((168, 404), (344, 404)), ((168, 404), (180, 386)),
                 ((344, 404), (332, 386)), ((180, 386), (332, 386))]:
        d.line([P(*a), P(*b)], fill=color, width=W(10))

    # колонна и навершие
    d.line([P(256, 386), P(256, 120)], fill=color, width=W(16))
    r = 26 * scale
    c = P(256, 86)
    d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], outline=color, width=W(13))

    # коромысло: дуга через три точки, рисуем ломаной по кривой Безье
    pts = []
    for i in range(41):
        t = i / 40
        x = (1 - t) ** 2 * 110 + 2 * (1 - t) * t * 256 + t ** 2 * 402
        y = (1 - t) ** 2 * 128 + 2 * (1 - t) * t * 92 + t ** 2 * 128
        pts.append(P(x, y))
    d.line(pts, fill=color, width=W(16), joint="curve")

    # две чаши
    for x0 in (78, 370):
        bowl = []
        for i in range(25):
            a = math.pi * i / 24
            bowl.append(P(x0 + 32 - 32 * math.cos(a), 170 + 21 * math.sin(a)))
        d.line(bowl, fill=color, width=W(9), joint="curve")
        d.line([P(x0, 170), P(x0, 150)], fill=color, width=W(9))
        d.line([P(x0 + 64, 170), P(x0 + 64, 150)], fill=color, width=W(9))
        d.line([P(x0, 150), P(x0 + 64, 150)], fill=color, width=W(9))

    # узел крепления
    r = 14 * scale
    c = P(256, 128)
    d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=GOLD_DOT)


def make_icon(size, radius_ratio=0.22, pad=0.0, name="icon.png"):
    big = size * SS
    img = diagonal_gradient((big, big), TEAL, GREEN).convert("RGBA")
    d = ImageDraw.Draw(img)
    draw_scales(d, big / 2, big / 2, (big / 512) * (1 - pad * 2))
    if radius_ratio:
        img.putalpha(rounded_mask((big, big), round(big * radius_ratio)))
    img = img.resize((size, size), Image.LANCZOS)
    img.save(os.path.join(HERE, name))
    return name


def font(size, bold=True):
    """Системный шрифт с кириллицей. Перебираем — на разных машинах
    лежат разные, а падать из-за шрифта скрипт не должен."""
    names = (["arialbd.ttf", "segoeuib.ttf", "verdanab.ttf"] if bold
             else ["arial.ttf", "segoeui.ttf", "verdana.ttf"])
    for n in names:
        for base in ("C:/Windows/Fonts/", "/usr/share/fonts/truetype/dejavu/", ""):
            try:
                return ImageFont.truetype(base + n, size)
            except Exception:
                continue
    return ImageFont.load_default()


def make_cover():
    """Превью для Telegram, ВКонтакте и поисковой выдачи: 1200x630."""
    W, H = 1200, 630
    img = diagonal_gradient((W, H), (6, 31, 28), (10, 74, 68)).convert("RGB")
    d = ImageDraw.Draw(img)

    # знак слева
    draw_scales(d, 240, H // 2 - 10, 0.62)

    x = 470
    d.text((x, 176), "ПравоФин", font=font(84), fill=(255, 255, 255))
    d.text((x, 286), "Право, налоги и финансы", font=font(40, False), fill=(214, 235, 228))
    d.text((x, 338), "в одном сервисе", font=font(40, False), fill=(214, 235, 228))

    # золотая черта — та же, что под заголовками на сайте
    d.rectangle([x, 410, x + 96, 416], fill=GOLD_LIGHT)

    d.text((x, 448), "ИИ-консультант · разбор договоров ·",
           font=font(29, False), fill=(160, 196, 187))
    d.text((x, 488), "19 калькуляторов · напоминания о сроках",
           font=font(29, False), fill=(160, 196, 187))

    img.save(os.path.join(HERE, "og-cover.png"), optimize=True)


if __name__ == "__main__":
    make_icon(192, name="icon-192.png")
    make_icon(512, name="icon-512.png")
    # maskable: Android обрезает иконку по своей форме, поэтому знак
    # уменьшен и лежит внутри безопасной зоны, а фон занимает весь квадрат
    make_icon(512, radius_ratio=0, pad=0.14, name="icon-maskable-512.png")
    # apple-touch-icon iOS скругляет сам — отдаём квадрат
    make_icon(180, radius_ratio=0, name="apple-touch-icon.png")
    make_cover()
    print("готово: icon-192, icon-512, icon-maskable-512, apple-touch-icon, og-cover")
