#!/bin/bash
# ============ Что с машиной ============
#
# Показывает, почему сайт ещё не отвечает. Ничего не меняет — только
# смотрит и рассказывает.
#
# Запускать в Cloud Shell:
#
#     curl -fsSL https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/check-vm.sh -o check-vm.sh
#     bash check-vm.sh
#
# Весь вывод можно целиком отправить в чат — там нет ни ключей, ни паролей.

NAME="${VM_NAME:-pravofin}"

say()  { printf '%s\n' "$*"; }
head2() { say ""; say "===== $* ====="; }

command -v yc >/dev/null 2>&1 || { say "не нашёл yc — запускать нужно в Cloud Shell"; exit 1; }

head2 "1. Машина"
INFO=$(yc compute instance get --name "$NAME" 2>&1)
if ! printf '%s' "$INFO" | grep -q 'status:'; then
  say "не нашёл машину с именем «$NAME»:"
  say "$INFO"
  exit 1
fi
printf '%s\n' "$INFO" | grep -E '^(id|name|status|zone_id|platform_id):|cores:|memory:|address:|one_to_one_nat|security_group' | sed 's/^/  /'

IP=$(printf '%s\n' "$INFO" | awk '/one_to_one_nat/,0' | awk -F': *' '/address:/ {print $2; exit}')
say ""
say "  публичный адрес: ${IP:-не определился}"

# Группы безопасности — это сетевой замок. Если к интерфейсу привязана
# группа без разрешения на 80 и 443, машина работает, но снаружи
# выглядит мёртвой: пакеты до неё просто не доходят.
head2 "2. Сетевой доступ (группы безопасности)"
SG=$(printf '%s\n' "$INFO" | awk '/security_group_ids/,/^ *[a-z_]+:/' | grep -oE 'enp[a-z0-9]+|c[a-z0-9]{18,}' | head -5)
if [ -z "$SG" ]; then
  say "  группа не привязана — по умолчанию пропускается всё, это нормально"
else
  for g in $SG; do
    say "  группа $g:"
    yc vpc security-group get "$g" 2>&1 | grep -E 'direction:|ports:|from_port:|to_port:|protocol:|v4_cidr' | sed 's/^/    /'
  done
fi

head2 "3. Первичная настройка (последние строки журнала)"
SERIAL=$(yc compute instance get-serial-port-output --name "$NAME" 2>&1)
if printf '%s' "$SERIAL" | grep -q 'Cloud-init .* finished'; then
  DONE_LINE=$(printf '%s\n' "$SERIAL" | grep 'Cloud-init .* finished' | tail -1)
  say "  ПЕРВИЧНАЯ НАСТРОЙКА ЗАВЕРШЕНА:"
  printf '%s\n' "$DONE_LINE" | sed 's/^/    /'

  # Сколько она заняла. Наша настройка ставит Node, nginx и собирает
  # зависимости — быстрее чем за пару минут это невозможно. Если журнал
  # говорит про секунды, значит файл настройки не был прочитан вовсе:
  # машина поднялась чистой Ubuntu. Ошибки при этом нигде не будет.
  UP=$(printf '%s\n' "$DONE_LINE" | grep -oE 'Up [0-9]+' | grep -oE '[0-9]+' | tail -1)
  if [ -n "$UP" ] && [ "$UP" -lt 120 ]; then
    say ""
    say "  ВНИМАНИЕ: настройка заняла $UP секунд — этого не может быть."
    say "  Наша настройка одну только сборку зависимостей делает минуты."
    say "  Значит файл настройки не был прочитан, и машина пустая."
    say "  Лечится пересозданием:  RECREATE=1 bash create-vm.sh"
  fi
elif printf '%s' "$SERIAL" | grep -q 'cloud-init'; then
  say "  ЕЩЁ ИДЁТ — машина ставит Node, nginx и собирает зависимости."
  say "  Это занимает 10-15 минут, дольше обычного из-за сборки better-sqlite3."
else
  say "  журнала пока нет — машина только включается"
fi
say ""
say "  Что говорили наши скрипты:"
SETUP_LINES=$(printf '%s\n' "$SERIAL" | grep -aE '\[setup\]|\[bootstrap\]' | tail -40)
if [ -n "$SETUP_LINES" ]; then
  printf '%s\n' "$SETUP_LINES" | sed 's/.*\(\[setup\]\|\[bootstrap\]\)/    \1/'
else
  say "    ни одной строки — до наших скриптов дело не дошло вовсе."
  say "    Значит cloud-init споткнулся раньше: смотрите ошибки ниже."
fi

# Отдельно — как машина ходит наружу. Именно здесь ломалось дважды:
# сначала не открылся NodeSource, потом сам GitHub.
say ""
say "  Куда машина не смогла достучаться:"
printf '%s\n' "$SERIAL" \
  | grep -aiE 'failed to connect|could not resolve|couldn.t connect|unable to access|timed out' \
  | tail -10 | sed 's/^/    /' || true
say ""
say "  Ошибки, если были:"
printf '%s\n' "$SERIAL" | grep -iE 'error|failed|fatal|E: ' | grep -viE 'no error|error_|failed to connect to lvmetad' | tail -15 | sed 's/^/    /'
say ""
say "  Последние 40 строк:"
printf '%s\n' "$SERIAL" | tail -40 | sed 's/^/    /'

head2 "4. Служба на машине"
# Команда для машины передаётся после двойного тире — отдельного флага
# для этого у yc нет.
yc compute ssh --name "$NAME" -- '
  echo "--- systemctl ---"
  systemctl is-active pravofin  2>&1
  systemctl is-active nginx     2>&1
  echo "--- журнал службы ---"
  sudo journalctl -u pravofin -n 25 --no-pager 2>&1 | tail -25
  echo "--- порт 8080 ---"
  (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E "8080|:80 " || echo "никто не слушает"
  echo "--- изнутри ---"
  curl -s -m 5 http://127.0.0.1:8080/api/health || echo "сервис не ответил"
  echo
  echo "--- код на месте? ---"
  ls /opt/pravofin/repo/worker/node/server.mjs 2>&1
  ls -l /opt/pravofin/repo/worker/.env 2>&1 | awk "{print \$1, \$3, \$4, \$9}"
  echo "--- firewall ---"
  sudo ufw status 2>&1 | head -8
' 2>&1 | sed 's/^/  /' | head -70

head2 "5. Снаружи"
if [ -n "$IP" ]; then
  printf '  http://%s/api/health -> ' "$IP"
  curl -s -m 10 "http://$IP/api/health" || say "не ответил"
  say ""
  printf '  http://%s/ -> ' "$IP"
  curl -s -o /dev/null -w '%{http_code}\n' -m 10 "http://$IP/" || say "не ответил"
fi

say ""
say "===== конец ====="
say "Этот вывод можно целиком отправить в чат — ключей в нём нет."
