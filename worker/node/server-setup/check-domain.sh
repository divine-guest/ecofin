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

points_here() {
  local ip
  ip=$(getent hosts "$1" 2>/dev/null | awk '{print $1}' | head -1)
  [ -n "$ip" ] && [ "$ip" = "$MY_IP" ]
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

if [ "$WANT" = "$PREV" ] && [ -d "/etc/letsencrypt/live/$MAIN" ]; then
  exit 0
fi

echo "нужен сертификат на: $WANT"
if /opt/pravofin/enable-tls.sh "$MAIN" "${ALIASES[@]:-}"; then
  echo "$WANT" > "$MARK"
  echo "готово"
else
  echo "не вышло — попробую через пять минут"
fi
