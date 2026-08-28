#!/bin/bash
# ============ Виден ли сайт снаружи ============
#
# Сервер проверяет сам себя — но чужими руками.
#
# Зачем именно так. Проверить себя изнутри невозможно: с самой машины и
# из облака сайт открывается всегда, даже когда для всего интернета он
# недоступен. Мы на это потратили целую ночь, прежде чем поняли, что
# смотрим не туда. Поэтому проверку делает посторонний сервис
# check-host.net: он открывает наш адрес из полутора десятков стран.
#
# Что именно ловим. Адреса облачных хостингов попадают под фильтры у
# операторов связи — не за что-то, а по соседству: через эти диапазоны
# ходят VPN. Приходит это молча: сайт работает, сервер бодр, в журналах
# чисто, просто людей нет. Без такой проверки узнать об этом можно было
# бы только по упавшей выручке через неделю.
#
# Что делает при беде: пишет владельцу в телеграм-бота с готовой командой.
# И пишет ещё раз, когда всё вернётся, — чтобы не гадать.
#
# Запускается раз в час из расписания. Руками:
#     sudo /opt/pravofin/watch-outside.sh

set -uo pipefail

DIR=/opt/pravofin
ENVF=$DIR/env
DB=$DIR/data/pravofin.db
STATE=$DIR/outside.state

NODES="${NODES:-12}"           # из скольких стран проверять
NEED="${NEED:-3}"              # меньше этого — считаем, что сайт недоступен
REMIND=21600                   # напоминать не чаще раза в шесть часов

log() { printf '[outside] %s %s\n' "$(date +%H:%M)" "$*"; }

# ---------- Свой публичный адрес ----------
#
# Спрашиваем у самой машины, а не вписываем: адрес меняется, и вписанный
# однажды превратился бы в проверку чужого сайта.
IP=$(curl -s --max-time 5 -H "Metadata-Flavor: Google" \
  "http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip" 2>/dev/null)
[ -n "$IP" ] || IP=$(curl -s --max-time 8 https://api.ipify.org 2>/dev/null)
case "$IP" in
  *.*.*.*) ;;
  *) log "не смог узнать свой адрес, пропускаю проверку"; exit 0 ;;
esac

# ---------- Спрашиваем мир ----------

JSON=$(curl -s -H "Accept: application/json" --max-time 30 \
  "https://check-host.net/check-http?host=http://$IP/api/health&max_nodes=$NODES" 2>/dev/null)
ID=$(printf '%s' "$JSON" | grep -o '"request_id":"[^"]*"' | cut -d'"' -f4)
if [ -z "$ID" ]; then
  # Не достучались до проверяльщика — это не повод объявлять тревогу.
  log "check-host не ответил, пропускаю"
  exit 0
fi
TOTAL=$(printf '%s' "$JSON" | grep -o '\.node\.check-host\.net' | wc -l)

# Узлы отвечают вразнобой, поэтому смотрим несколько раз и берём лучшее.
OK=0
for _ in 1 2 3 4; do
  sleep 8
  n=$(curl -s -H "Accept: application/json" --max-time 25 \
        "https://check-host.net/check-result/$ID" 2>/dev/null | grep -o '\[\[1,' | wc -l)
  [ "$n" -gt "$OK" ] && OK=$n
done

log "адрес $IP: ответили $OK из $TOTAL"

# ---------- Сообщаем владельцу ----------

tg() {   # $1 — текст
  local token chat
  token=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' "$ENVF" 2>/dev/null | cut -d= -f2-)
  [ -n "$token" ] || { log "нет токена бота, сообщить некому"; return 1; }
  chat=$(sqlite3 "$DB" "SELECT tg_chat_id FROM users WHERE role='owner' AND tg_chat_id IS NOT NULL LIMIT 1" 2>/dev/null)
  [ -n "$chat" ] || { log "владелец не подключил телеграм, сообщить некуда"; return 1; }
  curl -s -m 15 "https://api.telegram.org/bot$token/sendMessage" \
    --data-urlencode "chat_id=$chat" \
    --data-urlencode "text=$1" >/dev/null 2>&1
}

WAS=$(cut -d' ' -f1 "$STATE" 2>/dev/null)
WHEN=$(cut -d' ' -f2 "$STATE" 2>/dev/null)
NOW=$(date +%s)
[ -n "$WHEN" ] || WHEN=0

if [ "$OK" -lt "$NEED" ]; then
  # Молчим, если уже жаловались недавно: тревога раз в час быстро
  # превращается в шум, который перестают читать.
  if [ "$WAS" != "плохо" ] || [ $((NOW - WHEN)) -ge "$REMIND" ]; then
    tg "ПравоФин: сайт не открывается снаружи.

Адрес $IP видят только $OK точек из $TOTAL. Сервер при этом работает —
скорее всего адрес попал под фильтры у операторов связи.

Лечится сменой адреса. В Cloud Shell:

curl -fsSL https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/find-good-ip.sh -o find.sh && bash find.sh

Скрипт переберёт адреса и сам проверит каждый снаружи." && log "сообщил владельцу"
    printf 'плохо %s\n' "$NOW" > "$STATE"
  else
    printf 'плохо %s\n' "$WHEN" > "$STATE"
  fi
else
  if [ "$WAS" = "плохо" ]; then
    tg "ПравоФин: сайт снова открывается снаружи — $OK точек из $TOTAL. Адрес $IP." \
      && log "сообщил, что всё вернулось"
  fi
  printf 'хорошо %s\n' "$NOW" > "$STATE"
fi
