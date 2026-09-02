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
import os, math, io, re

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


def count_calcs():
    """Сколько калькуляторов на сайте. Считаем по разметке, а не пишем
    числом: обложка ссылки — то место, куда забывают заглянуть, и она
    полгода обещала девятнадцать, когда их стало двадцать пять."""
    try:
        html = io.open("calc.html", encoding="utf-8").read()
        return html.count('onclick="switchCalc(')
    except Exception:
        return 0


def count_articles():
    """Столько же про статьи базы знаний.

    Считаем по строкам «code:», а не по «title:». Заголовки с тем же
    отступом есть и у разделов, и у тестов — по ним выходило 57 вместо
    49. Поле «code» (какой закон) есть только у статьи."""
    try:
        js = io.open("js/knowledge.js", encoding="utf-8").read()
        return len(re.findall(r'^    code: "', js, re.M))
    except Exception:
        return 0


def draw_mark(d, cx, cy, scale, color=GOLD_LIGHT):
    """Монета с рублём. Координаты повторяют icon.svg (холст 512),
    поэтому правка значка переносится сюда один в один.

    Раньше здесь были весы правосудия — знак прежнего названия. Сайт
    переставлен финансами вперёд, и значок на домашнем экране телефона
    должен говорить о деньгах.

    Растущих столбиков, которые есть в большом знаке на главной, здесь
    нет намеренно: на значке 32 пикселя они превращаются в три палочки,
    неотличимые от грязи."""
    def P(x, y):
        return (cx + (x - 256) * scale, cy + (y - 256) * scale)

    def W(w):
        return max(1, round(w * scale))

    def circle(x, y, r, width):
        c = P(x, y)
        rr = r * scale
        d.ellipse([c[0] - rr, c[1] - rr, c[0] + rr, c[1] + rr], outline=color, width=W(width))

    # монета: ободок и внутренний кант
    circle(256, 250, 150, 18)
    circle(256, 250, 128, 6)

    # рубль: ножка и поперечина
    d.line([P(226, 170), P(226, 330)], fill=color, width=W(26))
    d.line([P(196, 282), P(282, 282)], fill=color, width=W(26))

    # чаша рубля: правая половина окружности, ломаной по дуге
    bowl = []
    for i in range(25):
        a = -math.pi / 2 + math.pi * i / 24
        bowl.append(P(226 + 38 * math.cos(a), 208 + 38 * math.sin(a)))
    d.line(bowl, fill=color, width=W(26), joint="curve")


def make_icon(size, radius_ratio=0.22, pad=0.0, name="icon.png"):
    big = size * SS
    img = diagonal_gradient((big, big), TEAL, GREEN).convert("RGBA")
    d = ImageDraw.Draw(img)
    draw_mark(d, big / 2, big / 2, (big / 512) * (1 - pad * 2))
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
    draw_mark(d, 240, H // 2 - 10, 0.62)

    x = 470
    d.text((x, 176), "ЭкоФин", font=font(84), fill=(255, 255, 255))
    d.text((x, 286), "Финансы, налоги и право", font=font(40, False), fill=(214, 235, 228))
    d.text((x, 338), "в одном сервисе", font=font(40, False), fill=(214, 235, 228))

    # золотая черта — та же, что под заголовками на сайте
    d.rectangle([x, 410, x + 96, 416], fill=GOLD_LIGHT)

    d.text((x, 448), "ИИ-консультант · разбор договоров ·",
           font=font(29, False), fill=(160, 196, 187))
    d.text((x, 488), f"{count_calcs()} калькуляторов · {count_articles()} статей по делу",
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
