#!/bin/bash
# ============ Запуск установки на новом сервере — с компьютера владельца ============
#
#   bash vps-start.sh 80.78.246.6
#
# Зачем отдельный скрипт. Компьютер владельца выходит в интернет через
# VPN, и с этого выхода российский хостинг не виден вовсе: ни сайт
# хостера, ни сам сервер. Значит зайти на сервер можно только в те
# минуты, когда VPN выключен, — а в эти минуты помощник в чате недоступен.
# Поэтому всё, что нужно сделать на сервере, собрано в один запуск,
# который проходит без подсказок и занимает меньше минуты.
#
# Что делает:
#   1. ждёт, пока сервер станет виден (то есть пока выключат VPN);
#   2. разрешает вход по ключу этого компьютера — пароль root спрашивает
#      один раз, сам его нигде не сохраняет;
#   3. передаёт на сервер ключи из worker/.env, bootstrap.sh и установщик;
#   4. запускает установку на сервере в фоне и выходит.
#
# Установка идёт дальше сама, минут десять; соединение для неё уже не
# нужно, VPN можно включать обратно.
#
# Ключи едут по ssh прямо с этого компьютера на сервер. В репозиторий,
# в чат и на экран они не попадают.

set -uo pipefail

IP="${1:-}"
HERE=$(cd "$(dirname "$0")" && pwd)
ENVF="$HERE/../.env"
KEY="$HOME/.ssh/id_ed25519"
STAGE=/root/ecofin-install
STATUS="${TMP:-/tmp}/ecofin-vps-start.status"
OPTS=(-o ConnectTimeout=12 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=10)

# Отметки о пройденных шагах — отдельным файлом. По нему потом видно,
# докуда дошло, даже если окно терминала уже закрыли.
step() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*" >> "$STATUS"; }
fail() { printf '\nНЕ ПОЛУЧИЛОСЬ: %s\n' "$*"; step "ОШИБКА: $*"; exit 1; }

case "$IP" in
  --check)
    # Проверка без единого действия: читается ли русский текст в этом
    # окне и виден ли сервер. Адрес — вторым словом.
    IP="${2:-}"
    echo "Проверка: русский текст читается."
    if [ -n "$IP" ] && timeout 6 bash -c "exec 3<>/dev/tcp/$IP/22" 2>/dev/null; then
      echo "Сервер $IP отсюда виден."
    else
      echo "Сервер ${IP:-(адрес не указан)} отсюда не виден."
    fi
    exit 0 ;;
  *.*.*.*) ;;
  *) echo "Укажите адрес сервера: bash vps-start.sh 80.78.246.6"; exit 1 ;;
esac

: > "$STATUS"
step "запуск для $IP"

[ -f "$HERE/install-vps.sh" ]            || fail "рядом нет install-vps.sh"
[ -f "$HERE/server-setup/bootstrap.sh" ] || fail "рядом нет server-setup/bootstrap.sh"

if [ ! -f "$KEY" ]; then
  mkdir -p "$HOME/.ssh"
  ssh-keygen -q -t ed25519 -N "" -C "ecofin" -f "$KEY" || fail "не удалось создать ключ"
  echo "Создан ключ этого компьютера."
fi
PUB=$(tr -d '\r\n' < "$KEY.pub")
[ -n "$PUB" ] || fail "открытая часть ключа пуста"

# ---------- 1. Ждём сервер ----------

reach() { timeout 6 bash -c "exec 3<>/dev/tcp/$IP/22" 2>/dev/null; }

if ! reach; then
  echo
  echo "Сервер $IP отсюда не виден — мешает VPN."
  echo
  echo "    ВЫКЛЮЧИТЕ VPN. Больше ничего делать не нужно:"
  echo "    как только сервер станет виден, я продолжу сам."
  echo
  until reach; do printf '.'; sleep 3; done
  echo
fi
echo "Сервер виден."
step "сервер виден"

# ---------- 2. Вход по ключу ----------

run() { ssh "${OPTS[@]}" -o BatchMode=yes "root@$IP" "$@"; }

if run true 2>/dev/null; then
  echo "Вход по ключу уже работает."
else
  # Пароль спрашиваем сами и показываем при вводе.
  #
  # Обычная строка ssh при вводе не показывает ничего — ни букв, ни
  # звёздочек. Человек вставляет пароль, видит пустоту и решает, что
  # окно зависло: первый запуск на этом и остановился. Поэтому читаем
  # пароль обычной строкой, говорим, сколько символов получили, и сразу
  # очищаем экран.
  #
  # До ssh пароль доходит через переменную этого окна и маленькую
  # программу-подсказчика (SSH_ASKPASS). На диск он не пишется, в файл
  # отметок не попадает, после входа переменная стирается.
  ASK=$(mktemp)
  printf '%s\n' '#!/bin/sh' 'printf "%s\n" "$ECOFIN_PW"' > "$ASK"
  chmod 700 "$ASK"
  ADD="umask 077; mkdir -p ~/.ssh; grep -qxF '$PUB' ~/.ssh/authorized_keys 2>/dev/null || echo '$PUB' >> ~/.ssh/authorized_keys"

  echo
  echo "Нужен пароль пользователя root от сервера."
  echo "Он в письме от рег.ру или в карточке сервера в личном кабинете."
  echo
  echo "Вставьте его сюда ПРАВОЙ КНОПКОЙ МЫШИ и нажмите Enter."
  echo "Пароль будет виден, пока вы его вводите, — так понятно, что он"
  echo "вставился. Сразу после Enter экран очистится."

  OK=""
  for _ in 1 2 3; do
    echo
    IFS= read -r -p "Пароль root: " ECOFIN_PW || { rm -f "$ASK"; fail "ввод прерван"; }
    # Письмо и браузер охотно отдают пароль с пробелом или переводом
    # строки на конце — срезаем, иначе верный пароль не подойдёт.
    ECOFIN_PW=${ECOFIN_PW//$'\r'/}
    ECOFIN_PW="${ECOFIN_PW#"${ECOFIN_PW%%[![:space:]]*}"}"
    ECOFIN_PW="${ECOFIN_PW%"${ECOFIN_PW##*[![:space:]]}"}"
    printf '\033[2J\033[3J\033[H'
    if [ -z "$ECOFIN_PW" ]; then
      echo "Пусто: ничего не вставилось. Попробуйте ещё раз."
      continue
    fi
    echo "Принял, символов: ${#ECOFIN_PW}. Пробую войти…"

    export ECOFIN_PW
    ERR=$(mktemp)
    if SSH_ASKPASS="$ASK" SSH_ASKPASS_REQUIRE=force DISPLAY="${DISPLAY:-:0}" \
         ssh "${OPTS[@]}" -o LogLevel=ERROR -o PubkeyAuthentication=no \
             -o PreferredAuthentications=password,keyboard-interactive \
             -o NumberOfPasswordPrompts=1 "root@$IP" "$ADD" < /dev/null 2> "$ERR"; then
      OK="да"
    fi
    export -n ECOFIN_PW
    ECOFIN_PW=""

    if [ -n "$OK" ]; then rm -f "$ERR"; break; fi
    if grep -qiE 'change your password|password change required|expired' "$ERR"; then
      echo "Сервер требует сначала сменить пароль. Это делается один раз в консоли"
      echo "сервера в личном кабинете рег.ру; после смены запустите этот файл снова."
    elif grep -qi 'permission denied' "$ERR"; then
      echo "Сервер пароль не принял. Проверьте, что скопировали его целиком."
    else
      echo "Войти не удалось: $(head -c 300 "$ERR" | tr '\n' ' ')"
    fi
    rm -f "$ERR"
  done
  rm -f "$ASK"

  [ -n "$OK" ] || fail "пароль не подошёл. Сбросьте его в карточке сервера в кабинете рег.ру и запустите ещё раз."
  run true || fail "сервер не принял ключ"
  echo "Пароль больше не понадобится: вход теперь по ключу этого компьютера."
fi
step "вход по ключу работает"

# ---------- 3. Передаём файлы ----------

# Переводы строк срезаем: на Windows файл может оказаться с \r, и на
# сервере первая же строка «#!/bin/bash\r» не запустится.
put() { tr -d '\r' < "$1" | run "umask 077; cat > '$2'"; }

run "mkdir -p $STAGE && chmod 700 $STAGE"                    || fail "не создалась папка на сервере"
put "$HERE/server-setup/bootstrap.sh" "$STAGE/bootstrap.sh"  || fail "не передался bootstrap.sh"
put "$HERE/install-vps.sh"            "$STAGE/install-vps.sh" || fail "не передался установщик"

if [ -f "$ENVF" ]; then
  # Только строки вида КЛЮЧ=значение: комментарий или пустая строка
  # в настройках сервера валит его запуск.
  grep -E '^[A-Z][A-Z0-9_]*=' "$ENVF" | tr -d '\r' | run "umask 077; cat > '$STAGE/env'" \
    || fail "не передались ключи"
  echo "Ключи переданы: $(grep -cE '^[A-Z][A-Z0-9_]*=' "$ENVF") настроек."
else
  echo "ВНИМАНИЕ: файла worker/.env нет — сервер поднимется без ключей."
fi

# Доехало ли целым. Оборванная передача дала бы половину скрипта.
run "bash -n $STAGE/install-vps.sh && bash -n $STAGE/bootstrap.sh" \
  || fail "файлы доехали повреждёнными — запустите ещё раз"
step "файлы на сервере"

# ---------- 4. Запускаем установку ----------

# setsid и nohup отвязывают установку от этого соединения: она должна
# пережить и закрытое окно, и включённый обратно VPN.
run "setsid nohup bash $STAGE/install-vps.sh > /var/log/pravofin-install.log 2>&1 < /dev/null & sleep 4; tail -2 /var/log/pravofin-install.log" \
  || fail "установка не запустилась"
step "установка запущена"

echo
echo "=============================================================="
echo "  ГОТОВО. Установка идёт на сервере сама, около десяти минут."
echo
echo "  Теперь:  1) включите VPN обратно;"
echo "           2) напишите в чат: готово."
echo "=============================================================="
