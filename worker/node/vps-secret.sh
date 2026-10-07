#!/bin/bash
# ============ Положить ключ на сервер — с компьютера владельца ============
#
#   bash vps-secret.sh 80.78.246.6 YOOKASSA_SHOP_ID=1462757 YOOKASSA_SECRET_KEY
#
# После адреса — имена настроек. «ИМЯ=значение» означает значение по
# умолчанию: его можно принять клавишей Enter.
#
# Зачем отдельный скрипт. В Яндексе ключи добавлялись через метаданные
# машины; у обычного сервера метаданных нет, а зайти на него из чата
# нельзя — мешает VPN владельца (см. vps-start.sh). И в чат ключ класть
# нельзя: переписка — не место для секретов. Поэтому ключ вводится здесь,
# на своём компьютере, и уходит на сервер по ssh.
#
# Ключ виден, пока его вводят, — иначе не понять, вставился ли он; сразу
# после ввода экран очищается. В файлы на этом компьютере, в журнал и в
# список процессов сервера он не попадает: передаётся потоком, а не
# словом в командной строке.
#
# Для ключей ЮKassa скрипт сразу спрашивает у самой ЮKassa, принимает ли
# она их, и ждёт, пока сайт включит оплату.

set -uo pipefail

IP="${1:-}"
[ "$#" -ge 2 ] || { echo "Пример: bash vps-secret.sh 80.78.246.6 YOOKASSA_SHOP_ID YOOKASSA_SECRET_KEY"; exit 1; }
shift
case "$IP" in
  *.*.*.*) ;;
  *) echo "Первым словом нужен адрес сервера"; exit 1 ;;
esac

OPTS=(-o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=10)
run()  { ssh "${OPTS[@]}" -o BatchMode=yes "root@$IP" "$@"; }
fail() { printf '\nНЕ ПОЛУЧИЛОСЬ: %s\n' "$*"; exit 1; }
wipe() { printf '\033[2J\033[3J\033[H'; }

# ---------- Как называть настройку человеку и какой она должна быть ----------

label() {
  case "$1" in
    YOOKASSA_SHOP_ID)    echo "Номер магазина в ЮKassa (shopId)" ;;
    YOOKASSA_SECRET_KEY) echo "Секретный ключ ЮKassa" ;;
    AI_API_KEY)          echo "Ключ ИИ-провайдера" ;;
    MAIL_API_KEY)        echo "Ключ почтового сервиса" ;;
    *)                   echo "$1" ;;
  esac
}
looks_ok() {   # $1 — имя, $2 — значение
  case "$1" in
    YOOKASSA_SHOP_ID)    [[ "$2" =~ ^[0-9]{4,12}$ ]] ;;
    YOOKASSA_SECRET_KEY) [[ "$2" =~ ^(live|test)_[A-Za-z0-9_-]{16,}$ ]] ;;
    *)                   [[ "$2" != *$'\n'* ]] && [ -n "$2" ] ;;
  esac
}
hint() {
  case "$1" in
    YOOKASSA_SHOP_ID)    echo "Это число из кабинета ЮKassa, без пробелов." ;;
    YOOKASSA_SECRET_KEY) echo "Он начинается с live_ (боевой) или test_ (тестовый) и идёт одной строкой." ;;
    *)                   echo "Значение не должно быть пустым." ;;
  esac
}

# ---------- 1. Ждём сервер ----------

reach() { timeout 6 bash -c "exec 3<>/dev/tcp/$IP/22" 2>/dev/null; }
if ! reach; then
  echo
  echo "Сервер $IP отсюда не виден — мешает VPN."
  echo
  echo "    ВЫКЛЮЧИТЕ VPN. Как только сервер станет виден, я продолжу сам."
  echo
  until reach; do printf '.'; sleep 3; done
  echo
fi
run true 2>/dev/null || fail "вход по ключу не работает. Сначала запустите УСТАНОВКА-НА-СЕРВЕР.bat."
echo "Сервер виден, вход работает."

# ---------- 2. Спрашиваем значения ----------

LINES=""
for spec in "$@"; do
  name=${spec%%=*}
  def=""
  [ "$name" != "$spec" ] && def=${spec#*=}
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail "«$name» — не имя настройки"

  val=""
  prev=""
  for _ in 1 2 3 4; do
    echo
    if [ -n "$def" ]; then
      echo "$(label "$name"). Если это $def — просто нажмите Enter."
    else
      echo "$(label "$name"). Вставьте ПРАВОЙ КНОПКОЙ МЫШИ и нажмите Enter."
    fi
    IFS= read -r -p "> " val || fail "ввод прерван"
    val=${val//$'\r'/}
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    wipe
    [ -z "$val" ] && val="$def"
    if looks_ok "$name" "$val"; then
      echo "$(label "$name"): принято, символов: ${#val}."
      break
    fi
    # Проверка вида — подсказка, а не приговор: формат ключа у сервиса
    # может смениться. Ввели то же самое второй раз — значит настаивают,
    # берём; настоящую проверку всё равно делает сам сервис.
    if [ -n "$val" ] && [ "$val" = "$prev" ]; then
      echo "$(label "$name"): принято как есть, символов: ${#val}."
      break
    fi
    echo "Не похоже на правду (получено символов: ${#val}). $(hint "$name")"
    echo "Если уверены, что всё верно, — вставьте то же самое ещё раз."
    prev="$val"
    val=""
  done
  [ -n "$val" ] || fail "значение для «$(label "$name")» так и не получено"
  LINES="$LINES$name=$val"$'\n'
done

case "$LINES" in
  *YOOKASSA_SECRET_KEY=test_*)
    echo
    echo "ВНИМАНИЕ: ключ тестовый. Сайт будет принимать только пробные платежи," \
         "настоящие деньги по нему не пройдут." ;;
esac

# ---------- 3. Принимает ли ключ сама ЮKassa ----------
#
# Спрашиваем ДО записи: неверный ключ на сервере хуже, чем никакого.
# С ним сайт показывал бы кнопку оплаты, а человек, нажавший её, получал
# бы отказ — и узнали бы мы об этом от него.
#
# Спрашиваем с сервера, а не отсюда: платить будет он, и заодно видно,
# доходит ли он до ЮKassa. Значения идут потоком, и curl получает их
# потоком же (-K -), а не словом в команде.
YK=""
for spec in "$@"; do [ "${spec%%=*}" = "YOOKASSA_SECRET_KEY" ] && YK="да"; done

if [ -n "$YK" ]; then
  CHECK='f=/opt/pravofin/env; in=$(cat); id=$(printf "%s\n" "$in" | grep -m1 "^YOOKASSA_SHOP_ID=" | cut -d= -f2-); key=$(printf "%s\n" "$in" | grep -m1 "^YOOKASSA_SECRET_KEY=" | cut -d= -f2-); [ -n "$id" ] || id=$(grep -m1 "^YOOKASSA_SHOP_ID=" "$f" | cut -d= -f2-); printf "user = \"%s:%s\"\n" "$id" "$key" | curl -s -m 20 -K - -w "\nHTTP %{http_code}\n" https://api.yookassa.ru/v3/me'
  ANSWER=$(printf '%s' "$LINES" | run "$CHECK" 2>/dev/null)
  CODE=$(printf '%s\n' "$ANSWER" | sed -n 's/^HTTP //p' | tail -1)
  echo
  case "$CODE" in
    200)
      echo "ЮKassa ключ приняла."
      printf '%s' "$ANSWER" | grep -q '"test"[[:space:]]*:[[:space:]]*true' \
        && echo "  Магазин тестовый — настоящих платежей не будет." \
        || echo "  Магазин боевой."
      ;;
    401)
      LINES=""
      echo "ЮKassa ключ НЕ ПРИНЯЛА: номер магазина и ключ не подходят друг к другу."
      echo "На сервер ничего не записано. Проверьте оба значения в кабинете"
      echo "ЮKassa и запустите этот файл ещё раз."
      fail "неверная пара «магазин — ключ»" ;;
    *)
      echo "ЮKassa не ответила внятно (код ${CODE:-нет}). Ключ запишу, но он не проверен." ;;
  esac
fi

# ---------- 4. Кладём на сервер ----------
#
# Прежние строки с теми же именами убираются, чтобы ключ не оказался в
# файле дважды: какой из двух прочтёт сервер — зависело бы от случая.
# Пишем в тот же файл, а не подменяем его: так сохраняются права и
# владелец.
SAVE='set -e; umask 077; f=/opt/pravofin/env; in=$(mktemp); out=$(mktemp); cat > "$in"; keys=$(grep -oE "^[A-Z][A-Z0-9_]*" "$in" | paste -sd"|" -); [ -n "$keys" ]; { grep -vE "^($keys)=" "$f" || true; } > "$out"; cat "$in" >> "$out"; cat "$out" > "$f"; rm -f "$in" "$out"; echo "Записано на сервер."'
printf '%s' "$LINES" | run "$SAVE" || fail "записать на сервер не удалось"
LINES=""
val=""

# ---------- 5. Просим сервер подхватить сейчас ----------
#
# Сам он сделал бы это в течение пяти минут. Но человек ждёт у окна с
# выключенным VPN — пусть увидит результат сразу.
run 'setsid nohup flock -n /var/lock/pravofin.lock /opt/pravofin/bootstrap.sh >> /var/log/pravofin-setup.log 2>&1 < /dev/null & echo ok' >/dev/null 2>&1

if [ -n "$YK" ]; then
  echo
  printf 'Жду, пока сайт включит оплату'
  ON=""
  for _ in $(seq 1 30); do
    sleep 6
    printf '.'
    if run 'curl -s -m 8 http://127.0.0.1:8080/api/billing/plans' 2>/dev/null | grep -q '"enabled"[[:space:]]*:[[:space:]]*true'; then
      ON="да"
      break
    fi
  done
  echo
  if [ -n "$ON" ]; then
    echo "Оплата на сайте ВКЛЮЧЕНА."
  else
    echo "За три минуты оплата не включилась. Ключ на сервере — напишите об этом в чат."
  fi
fi

echo
echo "=============================================================="
echo "  ГОТОВО."
echo
echo "  Теперь:  1) включите VPN обратно;"
echo "           2) напишите в чат: готово."
echo "=============================================================="
