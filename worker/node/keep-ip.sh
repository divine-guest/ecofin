#!/bin/bash
# ============ Закрепить адрес за собой ============
#
# Адрес, который машина получила при перезапуске, — временный. Стоит ей
# однажды выключиться, и он уйдёт другому, а машина получит новый. После
# всего, что мы прошли в поисках адреса, который вообще виден снаружи,
# потерять его было бы обидно вдвойне: следующий с большой вероятностью
# окажется таким же непригодным.
#
# Скрипт закрепляет нынешний адрес за вашим облаком и заодно удаляет
# ранее зарезервированные, которые больше ни к чему не привязаны, —
# за них капают деньги, а пользы никакой.
#
# Запускать в Cloud Shell:
#   curl -fsSL https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/keep-ip.sh -o keep.sh
#   bash keep.sh
#
# Машину не трогает: адрес остаётся тот же самый, меняется только его
# статус — из временного в постоянный.

set -uo pipefail

NAME="${VM_NAME:-pravofin}"
ADDR_NAME="${ADDR_NAME:-pravofin-ip}"

say()  { printf '%s\n' "$*"; }
fail() { printf '\n  ОШИБКА: %s\n\n' "$*" >&2; exit 1; }
field() { awk -F': *' -v k="$1" '$0 ~ "^ *" k ":" { print $2; exit }'; }

say ""
say "=== Закрепляю адрес ==="
say ""

command -v yc >/dev/null 2>&1 || fail "не нашёл команду yc — запускать нужно в Cloud Shell"

INFO=$(yc compute instance get --name "$NAME" 2>&1)
printf '%s' "$INFO" | grep -q 'status:' || fail "не нашёл машину «$NAME»:
$INFO"

ZONE=$(printf '%s\n' "$INFO" | field zone_id)
IP=$(printf '%s\n' "$INFO" | awk '/one_to_one_nat/,0' | field address)
[ -n "$IP" ]   || fail "у машины нет публичного адреса"
[ -n "$ZONE" ] || fail "не понял, в какой зоне машина"

say "  машина  $NAME"
say "  зона    $ZONE"
say "  адрес   $IP"
say ""

# ---------- Убираем зарезервированные адреса, которые ни к чему не привязаны ----------
#
# Отдельная возня, но нужная: за зарезервированный и неиспользуемый адрес
# Яндекс берёт больше, чем за используемый. Заодно освобождается имя.

say "Смотрю ранее зарезервированные адреса…"
LIST=$(yc vpc address list 2>/dev/null)
FREED=""

while read -r line; do
  [ -z "$line" ] && continue
  aname=$(printf '%s' "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$3); print $3}')
  aip=$(printf '%s' "$line"   | awk -F'|' '{gsub(/^ +| +$/,"",$4); print $4}')
  case "$aip" in
    *.*.*.*) ;;
    *) continue ;;
  esac
  [ "$aip" = "$IP" ] && continue          # нынешний адрес не трогаем

  # Удалится только тот, что реально свободен: занятый Яндекс не отдаст,
  # и это наша страховка от ошибки.
  if yc vpc address delete "${aname:-$aip}" >/dev/null 2>&1; then
    say "  удалён неиспользуемый: $aip ${aname:+($aname)}"
    FREED="да"
  fi
done <<< "$(printf '%s\n' "$LIST" | grep -E '\|.*[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+')"

[ -n "$FREED" ] || say "  лишних не нашлось"

# ---------- Закрепляем нынешний ----------

say ""
EXIST=$(yc vpc address list 2>/dev/null | grep -c "$IP" || true)
if [ "$EXIST" -gt 0 ]; then
  say "Адрес $IP уже закреплён."
else
  say "Закрепляю $IP…"
  ERR=$(yc vpc address create --name "$ADDR_NAME" \
          --external-ipv4 "address=$IP,zone=$ZONE" 2>&1) \
    || fail "не смог закрепить адрес:
$(printf '%s' "$ERR" | head -3)

  Можно сделать в консоли: Compute Cloud → $NAME → Сеть →
  у публичного адреса выбрать «Сделать статическим»."
  say "  закреплён под именем $ADDR_NAME"
fi

say ""
say "=== Готово ==="
say ""
say "  Адрес $IP теперь ваш и при перезапуске машины не изменится."
say "  На него же будет указывать домен, когда вы его купите."
say ""
