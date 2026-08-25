# -*- coding: utf-8 -*-
"""Проставляет версию всем локальным css/js на страницах: js/app.js?v=7

Зачем. GitHub Pages отдаёт файлы с Cache-Control: max-age=600. После выката
вернувшийся посетитель получает новый HTML и старый JS из кэша браузера —
сайт оказывается в несогласованном состоянии и падает на вызовах функций,
которых в старом файле ещё нет. Версия в адресе делает файл новым для кэша.

Запуск перед каждым коммитом с изменениями фронтенда:
    python bump-version.py
"""
import io, os, re, glob, sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))

VERSION_FILE = ".assets-version"

def current():
    try:
        return int(io.open(VERSION_FILE, encoding="utf-8").read().strip())
    except Exception:
        return 0

version = current() + 1
if "--keep" in sys.argv:
    version = max(1, current())

# Локальные css и js в атрибутах href/src; внешние адреса не трогаем
PATTERN = re.compile(r'((?:href|src)=")((?:css|js)/[a-zA-Z0-9_\-./]+\.(?:css|js))(\?v=\d+)?(")')

changed = 0
for page in glob.glob("*.html"):
    s = io.open(page, encoding="utf-8").read()
    new = PATTERN.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={version}{m.group(4)}", s)
    if new != s:
        io.open(page, "w", encoding="utf-8").write(new)
        changed += 1

# Тот же номер — в service worker, иначе он продолжит отдавать старое
sw = io.open("sw.js", encoding="utf-8").read()
sw_new = re.sub(r'const CACHE = "pravofin-v\d+";', f'const CACHE = "pravofin-v{version}";', sw)
# И в списке ресурсов версии тоже нужны, иначе SW закэширует безверсионные копии
sw_new = re.sub(r'"((?:css|js)/[a-zA-Z0-9_\-./]+\.(?:css|js))(\?v=\d+)?"',
                lambda m: f'"{m.group(1)}?v={version}"', sw_new)
if sw_new != sw:
    io.open("sw.js", "w", encoding="utf-8").write(sw_new)

io.open(VERSION_FILE, "w", encoding="utf-8").write(str(version))
print(f"версия ресурсов: {version}, страниц обновлено: {changed}")
print("не забудьте пересобрать страницы статей: node build-seo.mjs")
