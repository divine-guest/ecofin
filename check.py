# -*- coding: utf-8 -*-
"""Предполётная проверка сайта.

   Ловит то, на чём этот проект уже трижды спотыкался:
   незакрытые теги (панель календаря пряталась внутри соседней),
   битые внутренние ссылки, вызовы несуществующих функций,
   забытые версии ресурсов.

   Запуск:  python check.py
   Возвращает ненулевой код, если нашлись ошибки, — годится для CI.
"""
import io, os, re, sys, glob, json

os.chdir(os.path.dirname(os.path.abspath(__file__)))

errors, warns = [], []
def err(where, msg):  errors.append(f"{where}: {msg}")
def warn(where, msg): warns.append(f"{where}: {msg}")

VOID = {"area","base","br","col","embed","hr","img","input","link","meta",
        "param","source","track","wbr"}

def strip_noise(html):
    """Убирает то, что не является разметкой страницы: скрипты, стили,
       комментарии и содержимое шаблонных строк внутри ${...}."""
    html = re.sub(r"<script\b.*?</script>", "", html, flags=re.S | re.I)
    html = re.sub(r"<style\b.*?</style>", "", html, flags=re.S | re.I)
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    return html

def check_structure(page, html):
    """Считает баланс блочных тегов. Разметка в HTML-файле должна
       сходиться сама по себе, без учёта того, что дорисует JS."""
    body = strip_noise(html)
    stack = []
    for m in re.finditer(r"<(/?)([a-zA-Z][\w-]*)([^>]*)>", body):
        closing, tag, attrs = m.group(1), m.group(2).lower(), m.group(3)
        if tag in VOID or attrs.rstrip().endswith("/"):
            continue
        if tag not in ("div", "section", "main", "nav", "header", "footer",
                       "form", "table", "tr", "td", "th", "ul", "ol", "li", "p"):
            continue
        if tag == "p":
            continue          # <p> закрывается неявно, это допустимо
        if not closing:
            stack.append((tag, m.start()))
        else:
            if not stack:
                err(page, f"лишний </{tag}>")
                continue
            open_tag, pos = stack.pop()
            if open_tag != tag:
                line = body[:pos].count("\n") + 1
                err(page, f"<{open_tag}> на строке ~{line} закрыт как </{tag}>")
    for tag, pos in stack:
        line = body[:pos].count("\n") + 1
        err(page, f"<{tag}> на строке ~{line} не закрыт")

def check_links(page, html, all_pages):
    """Проверяем только разметку страницы: внутри скриптов ссылки часто
       собираются из переменных, и проверять их статически бессмысленно."""
    html = strip_noise(html)
    for m in re.finditer(r'href="([^"#][^"]*)"', html):
        href = m.group(1)
        if href.startswith(("http", "mailto:", "tel:", "//", "data:")):
            continue
        target = href.split("#")[0].split("?")[0]
        if not target or "${" in href:
            continue
        if target not in all_pages and not os.path.exists(target):
            err(page, f"ссылка в никуда: {href}")

def check_assets(page, html):
    for m in re.finditer(r'(?:src|href)="((?:js|css)/[^"]+)"', html):
        ref = m.group(1)
        path = ref.split("?")[0]
        if not os.path.exists(path):
            err(page, f"нет файла: {path}")
        elif "?v=" not in ref:
            warn(page, f"без версии: {ref} (браузер отдаст старую копию)")

def check_calls(page, html):
    """Ищет onclick-обработчики, для которых нет функции ни на странице,
       ни в подключённых скриптах."""
    scripts = "\n".join(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S))
    external = re.findall(r'<script src="(js/[^"?]+)', html)
    pool = scripts
    for f in external:
        if os.path.exists(f):
            pool += "\n" + io.open(f, encoding="utf-8").read()

    known = set(re.findall(r"(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)", pool))
    known |= set(re.findall(r"^\s*([A-Za-z_$][\w$]*)\s*[:(]", pool, re.M))
    builtin = {"alert","confirm","prompt","event","this","window","document","location",
               "console","setTimeout","navigator","JSON","Math","Date","Object","Array"}
    for m in re.finditer(r'on\w+="([A-Za-z_$][\w$]*)\s*\(', html):
        name = m.group(1)
        if name not in known and name not in builtin:
            err(page, f"обработчик зовёт несуществующую функцию: {name}()")

def check_bootstrap(page, html):
    """Вызов до объявления const роняет весь скрипт молча.

    Самые дорогие поломки этого проекта были именно такими: кабинет не
    работал целиком, а потом семь новых калькуляторов не считались —
    потому что строка запуска стояла выше объявления объекта, к которому
    обращалась. Ошибка не видна ни в разметке, ни в node --check:
    синтаксис корректен, падает выполнение.

    Ищем в каждом встроенном скрипте объявления `const ИМЯ = {` верхнего
    уровня и вызовы `ИМЯ.что-то(` или `ИМЯ(` из строк без отступа —
    то есть из кода, который выполняется сразу. Если вызов стоит выше
    объявления, это ошибка.
    """
    for block in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S):
        lines = block.split("\n")
        declared = {}
        for i, line in enumerate(lines):
            m = re.match(r"const\s+([A-Z][A-Z0-9_]*)\s*=", line)
            if m and m.group(1) not in declared:
                declared[m.group(1)] = i
        if not declared:
            continue
        for i, line in enumerate(lines):
            # только код верхнего уровня: без отступа и не в комментарии
            if not line or line[0] in " \t/*}":
                continue
            for m in re.finditer(r"\b([A-Z][A-Z0-9_]*)\s*(?:\.\w+\s*)?\(", line):
                name = m.group(1)
                if name in declared and i < declared[name]:
                    err(page, f"строка {i + 1}: {name} вызывается до объявления "
                              f"(строка {declared[name] + 1}) — весь скрипт упадёт молча")


def check_meta(page, html):
    if "<title>" not in html:
        err(page, "нет <title>")
    if 'name="description"' not in html:
        warn(page, "нет описания для поиска")
    if "<h1" not in html and "renderCabinet" not in html and "AD.render" not in html:
        warn(page, "нет заголовка h1")
    if 'lang="ru"' not in html:
        warn(page, "не указан язык страницы")


def check_tiers():
    """Ловит проверки вида plan === "pro", в которых забыт «Базовый».

       Дефект повторялся трижды: подписчик «Базового» показывался как
       бесплатный, потому что код писался, когда платный уровень был
       один. Считаем подозрительной строку со сравнением с "pro",
       рядом с которой нигде не упомянут "basic"."""
    for f in glob.glob("*.html") + glob.glob("js/*.js"):
        lines = io.open(f, encoding="utf-8").read().split("\n")
        for i, ln in enumerate(lines):
            if not re.search(r'[=!]==\s*"pro"|"pro"\s*[=!]==', ln):
                continue
            # Смотрим строку и её соседей: тройная развилка — это нормально.
            around = "\n".join(lines[max(0, i - 2):i + 3])
            if '"basic"' in around or "isPro" in around or "hasFeature" in around:
                continue
            err(f, f'строка {i + 1}: платным считается только «Про» — '
                   f'подписчик «Базового» будет выглядеть бесплатным')

def check_secrets():
    """Ключи не должны попадать в файлы, которые отдаются браузеру."""
    patterns = [(r"sk-[a-zA-Z0-9-]{16,}", "ключ ИИ-провайдера"),
                (r"cfut_[a-zA-Z0-9]{20,}", "токен Cloudflare"),
                (r"ghp_[a-zA-Z0-9]{20,}", "токен GitHub"),
                (r"\d{9,10}:AA[\w-]{30,}", "токен Telegram")]
    for f in glob.glob("*.html") + glob.glob("js/*.js") + glob.glob("css/*.css"):
        s = io.open(f, encoding="utf-8").read()
        for pat, what in patterns:
            if re.search(pat, s):
                err(f, f"В ФАЙЛЕ ДЛЯ БРАУЗЕРА ЛЕЖИТ {what}")

def check_cloud_init():
    """Первая строка настройки сервера обязана быть «#cloud-config».

    cloud-init смотрит только на неё. Комментарий или пустая строка перед
    ней — и весь файл молча пропускается: машина поднимается пустой, ошибки
    нигде нет, а понять это можно лишь по времени в журнале. Один раз мы так
    уже подняли машину без сервиса, поэтому проверяем на берегу."""
    f = "worker/node/cloud-init.yaml"
    if not os.path.exists(f):
        return
    first = io.open(f, encoding="utf-8").readline().strip()
    if first != "#cloud-config":
        err(f, f"первая строка «{first}», а должна быть «#cloud-config» — "
               "иначе машина поднимется без сервиса")

def main():
    pages = sorted(glob.glob("*.html"))
    names = set(pages)
    for page in pages:
        html = io.open(page, encoding="utf-8").read()
        check_structure(page, html)
        check_links(page, html, names)
        check_assets(page, html)
        check_calls(page, html)
        check_bootstrap(page, html)
        check_meta(page, html)
    check_tiers()
    check_secrets()
    check_cloud_init()

    print(f"Проверено страниц: {len(pages)}\n")
    if errors:
        print(f"ОШИБКИ ({len(errors)}):")
        for e in errors: print("  ✗", e)
    else:
        print("Ошибок нет.")
    if warns:
        print(f"\nЗамечания ({len(warns)}):")
        for w in warns[:20]: print("  ·", w)
        if len(warns) > 20: print(f"  … и ещё {len(warns) - 20}")
    sys.exit(1 if errors else 0)

main()
