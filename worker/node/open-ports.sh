#!/bin/bash
# ============ Открыть сайт наружу ============
#
# Машина может работать прекрасно и всё равно быть недоступна из интернета:
# в Яндекс Облаке перед ней стоит сетевой замок — группа безопасности.
# Если её не задать, применяется та, что по умолчанию, а она пропускает
# только исходящие соединения. Изнутри облака сайт при этом открывается,
# снаружи — нет. Именно так мы и попались: Cloud Shell получал с сайта
# ответ 200 в ту самую минуту, когда снаружи не устанавливалось даже
# соединение.
#
# Скрипт создаёт группу, которая пропускает внутрь только 80, 443 и 22,
# и вешает её на машину. Исходящие остаются открытыми полностью — иначе
# машина перестанет ходить за обновлениями и сертификатами.
#
# Запускать в Cloud Shell:
#   curl -fsSL https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/open-ports.sh -o open.sh
#   bash open.sh
#
# Машину не трогает: не перезапускает, не пересоздаёт. Всё, что на ней
# есть, остаётся на месте.

set -uo pipefail

NAME="${VM_NAME:-pravofin}"
SG_NAME="${SG_NAME:-pravofin-web}"

say()  { printf '%s\n' "$*"; }
fail() { printf '\n  ОШИБКА: %s\n\n' "$*" >&2; exit 1; }

# Достаёт значение поля из вывода yc (обычный YAML, одно поле — одна строка).
field() { awk -F': *' -v k="$1" '$0 ~ "^ *" k ":" { print $2; exit }'; }

say ""
say "=== Открываю сайт наружу ==="
say ""

command -v yc >/dev/null 2>&1 || fail "не нашёл команду yc — запускать нужно в Cloud Shell"

INFO=$(yc compute instance get --name "$NAME" 2>&1)
printf '%s' "$INFO" | grep -q 'status:' || fail "не нашёл машину «$NAME»:
$INFO"

SUBNET_ID=$(printf '%s\n' "$INFO" | field subnet_id)
[ -n "$SUBNET_ID" ] || fail "не понял, в какой подсети машина"

NETWORK_ID=$(yc vpc subnet get "$SUBNET_ID" 2>/dev/null | field network_id)
[ -n "$NETWORK_ID" ] || fail "не понял, в какой сети подсеть $SUBNET_ID"

say "  машина    $NAME"
say "  подсеть   $SUBNET_ID"
say "  сеть      $NETWORK_ID"
say ""

# Группа могла остаться от прошлого запуска — тогда просто берём её.
SG_ID=$(yc vpc security-group get --name "$SG_NAME" 2>/dev/null | field id)

if [ -n "$SG_ID" ]; then
  say "Группа «$SG_NAME» уже есть: $SG_ID"
else
  say "Создаю группу «$SG_NAME»…"
  # Входящие — только то, что нужно сайту. Исходящие — всё: без этого
  # машина не сможет ни обновиться, ни выпустить сертификат.
  yc vpc security-group create \
    --name "$SG_NAME" \
    --network-id "$NETWORK_ID" \
    --rule "direction=ingress,port=80,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
    --rule "direction=ingress,port=443,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
    --rule "direction=ingress,port=22,protocol=tcp,v4-cidrs=[0.0.0.0/0]" \
    --rule "direction=egress,from-port=0,to-port=65535,protocol=any,v4-cidrs=[0.0.0.0/0]" \
    >/dev/null 2>&1 || fail "не смог создать группу безопасности"

  SG_ID=$(yc vpc security-group get --name "$SG_NAME" 2>/dev/null | field id)
  [ -n "$SG_ID" ] || fail "группа вроде создалась, но найти её не удалось"
  say "  создана: $SG_ID"
fi

say ""
say "Вешаю группу на машину…"
yc compute instance update-network-interface "$NAME" \
  --network-interface-index 0 \
  --security-group-id "$SG_ID" \
  >/dev/null 2>&1 || fail "не смог привязать группу к машине.
  Можно сделать это руками: Compute Cloud → Виртуальные машины → $NAME →
  Редактировать → Группы безопасности → выбрать $SG_NAME"

IP=$(printf '%s\n' "$INFO" | awk '/one_to_one_nat/,0' | field address)

say ""
say "=== Готово ==="
say ""
say "  Внутрь пропускаются только 80, 443 и 22. Наружу — всё."
say ""
if [ -n "$IP" ]; then
  say "  Проверьте в браузере:"
  say ""
  say "      http://$IP/api/health"
  say ""
  say "  Должно ответить: {\"ok\":true, ... \"db\":true}"
  say ""
  printf '  Проверяю отсюда: '
  sleep 5
  curl -s -m 15 "http://$IP/api/health" || say "пока не отвечает, подождите полминуты"
  say ""
fi
