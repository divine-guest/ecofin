#!/bin/bash
# ============ Поиск адреса, до которого доходят люди ============
#
# Зачем. Сайт исправен, но недоступен почти отовсюду: из 40 точек мира
# отвечали две. Поддержка Yandex Cloud проверила и подтвердила, что
# снаружи тоже получает таймаут, а внутри облака всё работает — значит
# трафик режется у операторов связи, за пределами облака. Так сейчас
# бывает с адресами облачных хостингов: диапазоны попадают под фильтры,
# потому что через них ходят VPN.
#
# Лечится перебором: взять другой адрес и проверить. Руками это долго —
# каждую попытку надо где-то проверять, а из самого облака сайт виден
# всегда и потому проверка изнутри бесполезна.
#
# Скрипт делает и то, и другое: меняет адрес и тут же проверяет его
# чужими руками — через check-host.net, из полутора десятков стран.
# Останавливается на первом, который видно снаружи.
#
# Запускать в Cloud Shell:
#   curl -fsSL https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/find-good-ip.sh -o find.sh
#   bash find.sh
#
# Машину не трогает и не перезапускает. Меняется только адрес.

set -uo pipefail

NAME="${VM_NAME:-pravofin}"
TRIES="${TRIES:-6}"          # сколько адресов перебрать
NEED="${NEED:-4}"            # сколько точек должны увидеть сайт, чтобы принять адрес
NODES="${NODES:-15}"         # из скольких точек проверять

say()  { printf '%s\n' "$*"; }
fail() { printf '\n  ОШИБКА: %s\n\n' "$*" >&2; exit 1; }
field() { awk -F': *' -v k="$1" '$0 ~ "^ *" k ":" { print $2; exit }'; }

current_ip() {
  yc compute instance get --name "$NAME" 2>/dev/null \
    | awk '/one_to_one_nat/,0' | field address
}

# Просит check-host.net открыть адрес из разных стран и считает, сколько
# получилось. Разбираем ответ без python и jq: удачная проверка выглядит
# как [[1,... — этого достаточно, чтобы их сосчитать.
check_outside() {   # $1 — адрес; печатает «сколько_ответили из_скольких»
  local ip="$1" id json ok total
  json=$(curl -s -H "Accept: application/json" --max-time 30 \
    "https://check-host.net/check-http?host=http://$ip/api/health&max_nodes=$NODES" 2>/dev/null)
  id=$(printf '%s' "$json" | grep -o '"request_id":"[^"]*"' | cut -d'"' -f4)
  [ -n "$id" ] || { echo "0 0"; return; }
  total=$(printf '%s' "$json" | grep -o '\.node\.check-host\.net' | wc -l)

  # Узлы отвечают вразнобой, поэтому смотрим несколько раз и берём лучшее.
  ok=0
  for _ in 1 2 3 4; do
    sleep 8
    local n
    n=$(curl -s -H "Accept: application/json" --max-time 25 \
          "https://check-host.net/check-result/$id" 2>/dev/null \
        | grep -o '\[\[1,' | wc -l)
    [ "$n" -gt "$ok" ] && ok=$n
  done
  echo "$ok $total"
}

# Закрепить найденный адрес за облаком и рассказать, что получилось.
#
# Закрепляем сразу, не спрашивая: искать пригодный адрес заново из-за
# того, что машина однажды перезапустилась, — худшее, что может случиться
# после такого перебора.
keep_it() {   # $1 — адрес
  local ip="$1"
  say ""
  say "=== НАШЁЛ ==="
  say ""
  say "  Адрес: $ip"
  say ""

  if yc vpc address list 2>/dev/null | grep -q "$ip"; then
    say "  Он уже закреплён за вами."
  else
    local nm="pravofin-ip"
    yc vpc address get --name "$nm" >/dev/null 2>&1 && nm="pravofin-ip-$(date +%m%d%H%M)"
    if yc vpc address create --name "$nm" --external-ipv4 "address=$ip,zone=$ZONE" >/dev/null 2>&1; then
      say "  Закрепил за вами под именем $nm — при перезапуске машины не изменится."
    else
      say "  ЗАКРЕПИТЬ НЕ УДАЛОСЬ. Сделайте вручную, иначе адрес однажды пропадёт:"
      say "  Compute Cloud → $NAME → Сеть → у публичного адреса «Сделать статическим»."
    fi
  fi

  say ""
  say "  Откройте в браузере:"
  say ""
  say "      http://$ip/"
  say ""
}

say ""
say "=== Ищу адрес, который видно снаружи ==="
say ""

command -v yc >/dev/null 2>&1 || fail "не нашёл команду yc — запускать нужно в Cloud Shell"
yc compute instance get --name "$NAME" >/dev/null 2>&1 || fail "не нашёл машину «$NAME»"

ZONE=$(yc compute instance get --name "$NAME" 2>/dev/null | field zone_id)

# Выдать машине новый публичный адрес.
#
# Если адреса нет вовсе — просто выдаём. Снимать в этом случае нечего,
# а попытка снять несуществующий уронила бы скрипт на ровном месте.
new_ip() {
  if [ -n "$(current_ip)" ]; then
    yc compute instance remove-one-to-one-nat "$NAME" --network-interface-index 0 >/dev/null 2>&1 \
      || return 1
  fi
  yc compute instance add-one-to-one-nat "$NAME" --network-interface-index 0 >/dev/null 2>&1
}

START_IP=$(current_ip)
say "  сейчас у машины адрес: ${START_IP:-нет, публичного адреса нет}"
say "  проверять буду из $NODES точек мира, принимаю адрес от $NEED ответивших"
say ""

TRIED=""

if [ -z "$START_IP" ]; then
  # Без публичного адреса сайт недоступен вообще ниоткуда. Сначала вернём
  # машине адрес, а годится он или нет — выяснится проверкой, как обычно.
  say "У машины нет публичного адреса — выдаю…"
  new_ip || fail "не смог выдать машине публичный адрес"
  START_IP=$(current_ip)
  [ -n "$START_IP" ] || fail "адрес выдан, но определить его не удалось"
  say "  выдан: $START_IP"
  sleep 15
fi

# Проверим нынешний — вдруг он уже хороший.
say ""
say "Проверяю адрес $START_IP…"
read -r OK TOTAL <<< "$(check_outside "$START_IP")"
say "  ответили $OK из $TOTAL"
TRIED="$START_IP:$OK"

if [ "$OK" -ge "$NEED" ]; then
  keep_it "$START_IP"
  exit 0
fi

for i in $(seq 1 "$TRIES"); do
  say ""
  say "--- попытка $i из $TRIES ---"

  new_ip || fail "не смог сменить адрес машины.
  Если адрес пропал совсем, вернуть его можно так:
      yc compute instance add-one-to-one-nat $NAME --network-interface-index 0"

  IP=$(current_ip)
  [ -n "$IP" ] || fail "адрес выдан, но определить его не удалось"
  say "  новый адрес: $IP"

  # Дать сети минуту устояться, иначе проверка застанет полпути.
  sleep 15

  read -r OK TOTAL <<< "$(check_outside "$IP")"
  say "  ответили $OK из $TOTAL"
  TRIED="$TRIED $IP:$OK"

  if [ "$OK" -ge "$NEED" ]; then
    keep_it "$IP"
    say "  Видят его $OK точек из $TOTAL."
    say ""
    exit 0
  fi
done

say ""
say "=== Ни один адрес не подошёл ==="
say ""
say "  Что пробовали (адрес:сколько_точек_увидели):"
for t in $TRIED; do say "    $t"; done
say ""
say "  Значит перебор адресов не помогает — фильтруется весь диапазон,"
say "  а не отдельные адреса. Перебирать дальше смысла нет."
say ""
say "  Сейчас у машины адрес: $(current_ip)"
say ""
