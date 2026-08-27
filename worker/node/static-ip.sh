#!/bin/bash
# ============ Постоянный адрес для машины ============
#
# Две причины сменить адрес на постоянный.
#
# Первая — та, ради которой скрипт и написан. Динамический адрес выдаётся
# из общего котла, и достался нам такой, до которого доходит хорошо если
# десятая часть интернета: из сорока проверочных точек по миру отвечали
# три. Сервер при этом исправен — просто маршрут до этого адреса живёт
# своей жизнью. Постоянный адрес выделяется отдельно, и это первое, что
# стоит попробовать.
#
# Вторая — он всё равно понадобится. Домен указывают на конкретный адрес,
# а динамический меняется при каждом выключении машины: сайт отвалился бы
# на ровном месте, и никто бы не понял почему.
#
# Запускать в Cloud Shell:
#   curl -fsSL https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/static-ip.sh -o ip.sh
#   bash ip.sh
#
# Машину не перезапускает. Меняется только адрес, по которому она видна.

set -uo pipefail

NAME="${VM_NAME:-pravofin}"
ADDR_NAME="${ADDR_NAME:-pravofin-ip}"

say()  { printf '%s\n' "$*"; }
fail() { printf '\n  ОШИБКА: %s\n\n' "$*" >&2; exit 1; }
field() { awk -F': *' -v k="$1" '$0 ~ "^ *" k ":" { print $2; exit }'; }

say ""
say "=== Постоянный адрес ==="
say ""

command -v yc >/dev/null 2>&1 || fail "не нашёл команду yc — запускать нужно в Cloud Shell"

INFO=$(yc compute instance get --name "$NAME" 2>&1)
printf '%s' "$INFO" | grep -q 'status:' || fail "не нашёл машину «$NAME»:
$INFO"

ZONE=$(printf '%s\n' "$INFO" | field zone_id)
OLD_IP=$(printf '%s\n' "$INFO" | awk '/one_to_one_nat/,0' | field address)
[ -n "$ZONE" ] || fail "не понял, в какой зоне машина"

say "  машина        $NAME"
say "  зона          $ZONE"
say "  адрес сейчас  ${OLD_IP:-нет}"
say ""

# Адрес мог остаться от прошлого запуска — тогда берём его.
NEW_IP=$(yc vpc address get --name "$ADDR_NAME" 2>/dev/null | field address)

if [ -n "$NEW_IP" ]; then
  say "Постоянный адрес уже выделен: $NEW_IP"
else
  say "Выделяю постоянный адрес…"
  yc vpc address create --name "$ADDR_NAME" --external-ipv4 "zone=$ZONE" >/dev/null 2>&1 \
    || fail "не смог выделить адрес.
  Если облако не даёт — попробуйте в консоли:
  Virtual Private Cloud → IP-адреса → Выделить адрес"

  NEW_IP=$(yc vpc address get --name "$ADDR_NAME" 2>/dev/null | field address)
  [ -n "$NEW_IP" ] || fail "адрес вроде выделен, но найти его не удалось"
  say "  выделен: $NEW_IP"
fi

if [ "$NEW_IP" = "$OLD_IP" ]; then
  say ""
  say "Машина уже на этом адресе, менять нечего."
else
  say ""
  say "Перевожу машину на него…"

  # Сначала пробуем заменить адрес одной командой. Она работает не всегда:
  # у интерфейса уже есть публичный адрес, и облако может отказаться менять
  # его на ходу. Тогда идём длинным путём — снять старый, поставить новый.
  ERR=$(yc compute instance update-network-interface "$NAME" \
          --network-interface-index 0 \
          --nat-address "$NEW_IP" 2>&1)

  if [ $? -ne 0 ]; then
    say "  одной командой не вышло:"
    printf '%s\n' "$ERR" | head -3 | sed 's/^/    /'
    say ""
    say "  Пробую иначе: снимаю старый адрес и ставлю новый."

    ERR=$(yc compute instance remove-one-to-one-nat "$NAME" \
            --network-interface-index 0 2>&1) \
      || fail "не смог снять старый адрес:
$(printf '%s' "$ERR" | head -3)"

    say "    старый адрес снят"

    ERR=$(yc compute instance add-one-to-one-nat "$NAME" \
            --network-interface-index 0 \
            --nat-address "$NEW_IP" 2>&1) \
      || fail "старый адрес снят, а новый поставить не удалось:
$(printf '%s' "$ERR" | head -3)

  Машина сейчас без публичного адреса. Поставить его можно так:
      yc compute instance add-one-to-one-nat $NAME --network-interface-index 0 --nat-address $NEW_IP"

    say "    новый адрес поставлен"
  fi
fi

say ""
say "=== Готово ==="
say ""
say "  Новый адрес машины: $NEW_IP"
say ""
say "  Откройте в браузере:"
say ""
say "      http://$NEW_IP/"
say ""
printf '  Проверяю отсюда: '
sleep 5
curl -s -o /dev/null -m 15 -w 'ответ %{http_code}\n' "http://$NEW_IP/api/health" \
  || say "пока не отвечает, подождите полминуты"
say ""
say "  Этот адрес закреплён за вами и больше не поменяется —"
say "  на него же будет указывать домен, когда вы его купите."
say ""
