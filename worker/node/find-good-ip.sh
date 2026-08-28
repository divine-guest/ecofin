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

say ""
say "=== Ищу адрес, который видно снаружи ==="
say ""

command -v yc >/dev/null 2>&1 || fail "не нашёл команду yc — запускать нужно в Cloud Shell"
yc compute instance get --name "$NAME" >/dev/null 2>&1 || fail "не нашёл машину «$NAME»"

START_IP=$(current_ip)
say "  сейчас у машины адрес: ${START_IP:-нет}"
say "  проверять буду из $NODES точек мира, принимаю адрес от $NEED ответивших"
say ""

# Заодно проверим нынешний — вдруг он уже хороший.
say "Проверяю нынешний адрес…"
read -r OK TOTAL <<< "$(check_outside "$START_IP")"
say "  $START_IP — ответили $OK из $TOTAL"
if [ "$OK" -ge "$NEED" ]; then
  say ""
  say "=== Этот адрес уже виден снаружи, менять нечего ==="
  say "    http://$START_IP/"
  exit 0
fi

TRIED="$START_IP:$OK"

for i in $(seq 1 "$TRIES"); do
  say ""
  say "--- попытка $i из $TRIES ---"

  yc compute instance remove-one-to-one-nat "$NAME" --network-interface-index 0 >/dev/null 2>&1 \
    || fail "не смог снять адрес с машины"
  yc compute instance add-one-to-one-nat "$NAME" --network-interface-index 0 >/dev/null 2>&1 \
    || fail "снял старый адрес, а новый выдать не удалось.
  Поставить обратно:  yc compute instance add-one-to-one-nat $NAME --network-interface-index 0"

  IP=$(current_ip)
  [ -n "$IP" ] || fail "адрес выдан, но определить его не удалось"
  say "  новый адрес: $IP"

  # Дать сети минуту устояться, иначе проверка застанет полпути.
  sleep 15

  read -r OK TOTAL <<< "$(check_outside "$IP")"
  say "  ответили $OK из $TOTAL"
  TRIED="$TRIED $IP:$OK"

  if [ "$OK" -ge "$NEED" ]; then
    say ""
    say "=== НАШЁЛ ==="
    say ""
    say "  Адрес: $IP"
    say "  Видят его $OK точек из $TOTAL."
    say ""
    say "  Откройте в браузере:"
    say ""
    say "      http://$IP/"
    say ""
    say "  Если открылось — закрепите адрес за собой, чтобы он не менялся:"
    say "  Compute Cloud → $NAME → Сеть → у публичного адреса «Сделать статическим»."
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
