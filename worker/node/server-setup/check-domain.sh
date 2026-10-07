#!/bin/bash
# Читает домены из репозитория и, когда они начнут показывать на нас,
# выпускает сертификат. Пока доменов нет или они показывают не сюда —
# тихо ничего не делает и пробует снова через пять минут.
#
# Первая строка файла — основной домен, остальные — зеркала, которые на
# него переадресуются.
set -uo pipefail

FILE=/opt/pravofin/repo/worker/node/domain.txt
MARK=/opt/pravofin/.tls-names

if [ ! -f "$FILE" ]; then exit 0; fi

# Читаем все непустые строки без комментариев.
#
# Пробелы срезаем через sed, а не через tr: tr работает по всему потоку и
# удаляет в том числе переносы строк — два домена склеивались в один
# «ecofin26.ruekofin26.ru», и не работал ни один.
mapfile -t LINES < <(grep -vE '^\s*(#|$)' "$FILE" | sed 's/[[:space:]]//g' | grep -v '^$')
if [ "${#LINES[@]}" -eq 0 ]; then exit 0; fi

MAIN="${LINES[0]}"
ALIASES=("${LINES[@]:1}")

MY_IP=$(curl -s --max-time 5 https://api.ipify.org || true)
if [ -z "$MY_IP" ]; then exit 0; fi

# Куда имя показывает прямо сейчас — у самих серверов зоны, мимо кэшей.
#
# Обычный запрос идёт через кэш, а запись домена живёт в нём шесть часов.
# После смены адреса машина ещё шесть часов видела бы старый и не просила
# бы сертификат — сайт всё это время не открывался бы по https. Серверы
# зоны отвечают сразу, и Let's Encrypt спрашивает именно их.
# Та же функция — в enable-tls.sh; менять обе.
fresh_ips() {
  command -v dig >/dev/null 2>&1 || return 0
  local zone ns
  zone=$(printf '%s' "$1" | awk -F. '{ print $(NF-1) "." $NF }')
  for ns in $(dig +short +time=3 +tries=1 NS "$zone" 2>/dev/null | head -3); do
    dig +short +time=3 +tries=1 A "$1" "@$ns" 2>/dev/null \
      | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' && return 0
  done
  return 0
}

points_here() {
  local ips
  ips=$(fresh_ips "$1")
  [ -n "$ips" ] || ips=$(getent hosts "$1" 2>/dev/null | awk '{print $1}')
  printf '%s\n' "$ips" | grep -qxF "$MY_IP"
}

if ! points_here "$MAIN"; then
  echo "домен $MAIN пока показывает не на нас ($MY_IP) — жду"
  exit 0
fi

# Какие имена МОЖНО закрыть сертификатом прямо сейчас.
#
# Считаем это каждый раз заново, а не один раз при первом выпуске: домены
# докупают. Зеркало, купленное через неделю после основного, иначе никогда
# бы не получило сертификат — проверка бы просто не запустилась, потому что
# основной уже выпущен.
WANT="$MAIN"
if points_here "www.$MAIN"; then WANT="$WANT www.$MAIN"; fi
for a in "${ALIASES[@]:-}"; do
  if [ -z "$a" ]; then continue; fi
  if points_here "$a"; then WANT="$WANT $a"; fi
  if points_here "www.$a"; then WANT="$WANT www.$a"; fi
done

PREV=""
if [ -f "$MARK" ]; then PREV=$(cat "$MARK"); fi

# Настройка тоже может требовать починки, даже когда с именами всё в
# порядке. Пример из жизни: после смены домена в ней осталась строка
# «если пришли по старому имени — отправить на старое имя», а сертификата
# для того имени больше нет, и человек по старой ссылке видит во весь
# экран предупреждение о поддельном сайте.
#
# Без этой проверки исправленный enable-tls.sh лёг на сервер и не
# запустился НИ РАЗУ: сертификат есть, имена прежние — выходим сразу.
stale_redirect() {
  local f
  for f in /etc/nginx/sites-available/pravofin /etc/nginx/sites-available/pravofin-redirect; do
    [ -f "$f" ] || continue
    # Цель переадресации, ведущая не на основной домен и не на $host.
    if grep -oE 'return 301 https://[^;$]+' "$f" 2>/dev/null \
         | grep -vqF "https://$MAIN"; then
      return 0
    fi
  done
  return 1
}

if [ "$WANT" = "$PREV" ] && [ -d "/etc/letsencrypt/live/$MAIN" ] && ! stale_redirect; then
  exit 0
fi

if stale_redirect; then
  echo "в настройке осталась переадресация на чужое имя — перенастраиваю"
fi

echo "нужен сертификат на: $WANT"
if /opt/pravofin/enable-tls.sh "$MAIN" "${ALIASES[@]:-}"; then
  echo "$WANT" > "$MARK"
  echo "готово"
else
  echo "не вышло — попробую через пять минут"
fi
