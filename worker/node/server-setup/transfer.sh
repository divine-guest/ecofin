#!/bin/bash
# ============ Переезд базы и ключей с одной машины на другую ============
#
# Зачем отдельный механизм. На старую машину зайти нельзя, на новую —
# только в те минуты, когда у владельца выключен VPN. Значит перенести
# данные руками некому: машины должны договориться сами.
#
# Как это устроено. В репозитории появляется файл worker/node/TRANSFER
# из двух строк: метка переноса и адрес новой машины. Его видят обе
# машины, и каждая понимает свою роль по собственному адресу:
#
#   адрес не мой   — я СТАРАЯ: снимаю копию базы, складываю рядом ключи,
#                    шифрую и выкладываю на свой сайт; потом окликаю
#                    новую машину, чтобы она узнала, откуда забирать;
#   адрес мой      — я НОВАЯ: нахожу оклик в журнале nginx, забираю файл,
#                    проверяю подпись, расшифровываю и ставлю базу на место.
#
# Чем защищено. Обе машины знают один и тот же RECOVERY_SECRET — он
# приехал на них из одного файла и нигде не опубликован. Из него:
#   • шифрование (AES-256, тот же способ, что у резервных копий);
#   • подпись файла — новая машина не примет подменённый или
#     повреждённый по дороге;
#   • имя файла на сайте — его не угадать и не найти в репозитории.
# Если секреты на машинах разные, перенос не пройдёт и скажет об этом,
# а не поставит на место мусор.
#
# Что едет: копия базы (VACUUM INTO — целостная на работающей базе),
# файл ключей и ключи, добавленные позже через метаданные машины.
# Ключи с новой машины не затираются: из старого файла берётся только
# то, чего на новой нет; добавленное владельцем позже — побеждает.
#
# Перенос окончен — файл TRANSFER убирается из репозитория, и старая
# машина сама стирает выложенное.
#
# Вызывается из setup.sh при каждом заходе. Всё, что уже сделано,
# пропускается.

set -uo pipefail

DIR="${PRAVOFIN_DIR:-/opt/pravofin}"
REPO="${PRAVOFIN_REPO:-$DIR/repo}"
MARK="$REPO/worker/node/TRANSFER"
ENVF="$DIR/env"
DB="$DIR/data/pravofin.db"

log() { printf '[transfer] %s\n' "$*"; }

# ---------- Переноса нет ----------

if [ ! -f "$MARK" ]; then
  # Старая машина убирает за собой, как только просьба снята.
  rm -f "$REPO"/transfer-*.bin "$REPO"/transfer-*.sig 2>/dev/null
  exit 0
fi

ID=$(grep -vE '^[[:space:]]*(#|$)' "$MARK" | sed -n 1p | tr -d '[:space:]')
DEST=$(grep -vE '^[[:space:]]*(#|$)' "$MARK" | sed -n 2p | tr -d '[:space:]')

[[ "$ID" =~ ^[A-Za-z0-9_-]{6,40}$ ]]               || { log "в файле TRANSFER нет метки — пропускаю"; exit 0; }
[[ "$DEST" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]     || { log "в файле TRANSFER нет адреса новой машины — пропускаю"; exit 0; }

# ---------- Кто я ----------
#
# Без своего адреса роль не определить, а угадывать нельзя: новая машина,
# принявшая себя за старую, выложила бы наружу пустую базу, а старая,
# принявшая себя за новую, ждала бы саму себя.
MY_IP="${TRANSFER_MY_IP:-}"
for url in https://api.ipify.org https://ipv4.icanhazip.com https://ifconfig.me/ip; do
  [ -n "$MY_IP" ] && break
  MY_IP=$(curl -s --max-time 8 "$url" 2>/dev/null | tr -d '[:space:]')
  [[ "$MY_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || MY_IP=""
done
[ -n "$MY_IP" ] || { log "не смог узнать свой адрес — попробую в следующий раз"; exit 0; }

KEY=$(grep -m1 '^RECOVERY_SECRET=' "$ENVF" 2>/dev/null | cut -d= -f2- | tr -d '\r')
[ -n "$KEY" ] || { log "в настройках нет RECOVERY_SECRET — шифровать и проверять нечем"; exit 0; }

hmac() { openssl dgst -sha256 -hmac "$KEY" -r "$@" | cut -d' ' -f1; }

NAME=$(printf 'transfer:%s' "$ID" | hmac | cut -c1-32)
[ "${#NAME}" = "32" ] || { log "не удалось вычислить имя файла — нет openssl?"; exit 0; }
BIN="transfer-$NAME.bin"
SIG="transfer-$NAME.sig"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# =====================================================================
#  СТАРАЯ МАШИНА: выложить
# =====================================================================

if [ "$MY_IP" != "$DEST" ]; then
  OUT_DONE="$DIR/transfer-out.done"

  # Выкладываем заново, если файла на месте нет: обновление кода архивом
  # подменяет папку сайта целиком, и выложенное пропадает вместе с ней.
  if [ "$(cat "$OUT_DONE" 2>/dev/null)" != "$ID" ] || [ ! -s "$REPO/$BIN" ] || [ ! -s "$REPO/$SIG" ]; then
    [ -f "$DB" ] || { log "базы на этой машине нет — отдавать нечего"; exit 0; }

    if ! sqlite3 "$DB" "VACUUM INTO '$TMP/pravofin.db'" 2> "$TMP/err"; then
      log "копия базы не снялась: $(head -c 200 "$TMP/err")"
      exit 0
    fi
    USERS=$(sqlite3 "$TMP/pravofin.db" "SELECT COUNT(*) FROM users" 2>/dev/null)

    cp "$ENVF" "$TMP/env"
    # Ключи, которые владелец добавлял позже через метаданные машины
    # (эквайринг, почта). В файле их нет — без этого шага они остались бы
    # на старой машине, а новая поднялась бы без оплаты.
    curl -fsS --max-time 5 -H "Metadata-Flavor: Google" \
      "http://169.254.169.254/computeMetadata/v1/instance/attributes/extra-env" \
      > "$TMP/extra-env" 2>/dev/null || : > "$TMP/extra-env"
    printf 'id=%s\nfrom=%s\nwhen=%s\nusers=%s\n' "$ID" "$MY_IP" "$(date -Is)" "${USERS:-?}" > "$TMP/info"

    tar czf "$TMP/bundle.tgz" -C "$TMP" pravofin.db env extra-env info \
      || { log "архив не собрался"; exit 0; }
    PASS="$KEY" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:PASS \
      -in "$TMP/bundle.tgz" -out "$TMP/$BIN" 2>/dev/null \
      || { log "зашифровать не удалось — наружу ничего не выкладываю"; exit 0; }
    hmac "$TMP/$BIN" > "$TMP/$SIG"

    install -m 644 "$TMP/$BIN" "$REPO/$BIN"
    install -m 644 "$TMP/$SIG" "$REPO/$SIG"
    printf '%s\n' "$ID" > "$OUT_DONE"
    log "выгрузка готова: пользователей ${USERS:-?}, размер $(wc -c < "$REPO/$BIN") байт"
  fi

  # Оклик. Новая машина не знает наш адрес — он мог смениться, — поэтому
  # сообщаем его сами: обращение останется у неё в журнале nginx вместе
  # с адресом, с которого пришло. Повторяем каждый заход: оклик дешёвый,
  # а пропустить его нельзя.
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://$DEST/transfer-hello-$ID" 2>/dev/null)
  case "$code" in
    2*|3*|4*) log "новая машина окликнута ($DEST)" ;;
    *)        log "новая машина $DEST не ответила на оклик — попробую снова" ;;
  esac
  exit 0
fi

# =====================================================================
#  НОВАЯ МАШИНА: забрать
# =====================================================================

IN_DONE="$DIR/transfer-in.done"
[ "$(cat "$IN_DONE" 2>/dev/null)" = "$ID" ] && exit 0

# Кто нас окликал. Свежие — первыми; свой адрес и петлю отбрасываем.
if [ -n "${TRANSFER_SRC:-}" ]; then
  CANDS="$TRANSFER_SRC"
else
  CANDS=$(cat /var/log/nginx/access.log.1 /var/log/nginx/access.log 2>/dev/null \
    | grep -F "GET /transfer-hello-$ID" | awk '{print $1}' \
    | grep -E '^[0-9]{1,3}(\.[0-9]{1,3}){3}$' | grep -vxF -e "$MY_IP" -e "127.0.0.1" \
    | tac | awk '!seen[$0]++' | head -5)
fi
if [ -z "$CANDS" ]; then
  log "жду старую машину: она ещё не объявилась"
  exit 0
fi

HOSTN=$(grep -vE '^[[:space:]]*(#|$)' "$REPO/worker/node/domain.txt" 2>/dev/null | head -1 | tr -d '[:space:]')

# Старая машина отвечает по имени сайта и под сертификатом на это имя,
# а имя уже может показывать на другой адрес. Поэтому говорим curl
# прямо, куда идти за этим именем. Запасные пути — на случай истёкшего
# сертификата или настройки без него: подлинность всё равно проверяет
# подпись, а не соединение.
fetch() {   # $1 — адрес, $2 — имя файла, $3 — куда положить
  if [ -n "${TRANSFER_FETCH_DIR:-}" ]; then
    cp "$TRANSFER_FETCH_DIR/$2" "$3" 2>/dev/null
    return
  fi
  if [ -n "$HOSTN" ]; then
    curl -fsS  --max-time 120 --resolve "$HOSTN:443:$1" "https://$HOSTN/$2" -o "$3" 2>/dev/null && return 0
    curl -fsSk --max-time 120 --resolve "$HOSTN:443:$1" "https://$HOSTN/$2" -o "$3" 2>/dev/null && return 0
    curl -fsS  --max-time 120 -H "Host: $HOSTN" "http://$1/$2" -o "$3" 2>/dev/null && return 0
  fi
  curl -fsS --max-time 120 "http://$1/$2" -o "$3" 2>/dev/null
}

GOOD=""
for SRC in $CANDS; do
  rm -f "$TMP/in.bin" "$TMP/in.sig"
  if ! fetch "$SRC" "$SIG" "$TMP/in.sig" || ! fetch "$SRC" "$BIN" "$TMP/in.bin"; then
    log "с адреса $SRC файл не скачался: выгрузка ещё не готова или секреты на машинах разные"
    continue
  fi
  WANT=$(tr -d '[:space:]' < "$TMP/in.sig")
  HAVE=$(hmac "$TMP/in.bin")
  if [ -z "$WANT" ] || [ "$WANT" != "$HAVE" ]; then
    log "с адреса $SRC пришёл файл с чужой подписью — не беру"
    continue
  fi
  GOOD="$SRC"
  break
done
[ -n "$GOOD" ] || exit 0

mkdir -p "$TMP/x"
if ! PASS="$KEY" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:PASS \
       -in "$TMP/in.bin" -out "$TMP/bundle.tgz" 2>/dev/null; then
  log "расшифровать не удалось — ключ не подошёл"
  exit 0
fi
# Распаковываем только те четыре имени, которые ждём: архив пришёл
# снаружи, и ничего лишнего он положить на диск не должен.
tar xzf "$TMP/bundle.tgz" -C "$TMP/x" pravofin.db env extra-env info 2>/dev/null \
  || { log "архив не распаковался"; exit 0; }

CHECK=$(sqlite3 "$TMP/x/pravofin.db" "PRAGMA integrity_check" 2>&1 | head -1)
USERS=$(sqlite3 "$TMP/x/pravofin.db" "SELECT COUNT(*) FROM users" 2>/dev/null)
if [ "$CHECK" != "ok" ]; then
  log "пришедшая база не прошла проверку целостности ($CHECK) — не ставлю"
  exit 0
fi
if ! [[ "${USERS:-}" =~ ^[0-9]+$ ]] || [ "$USERS" = "0" ]; then
  log "в пришедшей базе нет пользователей — не ставлю, свою не трогаю"
  exit 0
fi

# ---------- Ставим базу ----------
#
# Службу останавливаем: подменять файл под работающим сервером нельзя.
# Прежнюю базу не выбрасываем — кладём рядом с копиями.
log "ставлю базу со старой машины ($GOOD): пользователей $USERS"
systemctl stop pravofin 2>/dev/null || true
mkdir -p "$DIR/backups" "$DIR/data"
if [ -f "$DB" ]; then
  cp "$DB" "$DIR/backups/before-transfer-$(date +%Y%m%d-%H%M%S).db" 2>/dev/null \
    || log "прежнюю базу сохранить не удалось"
fi
# Журнал прежней базы убираем вместе с ней: оставшись рядом с новым
# файлом, он был бы применён к чужим данным.
rm -f "$DB-wal" "$DB-shm"
cp "$TMP/x/pravofin.db" "$DB"
chmod 600 "$DB"
chown pravofin:pravofin "$DB" 2>/dev/null || true

# ---------- Ключи ----------

merge_env() {   # $1 — откуда; $2 — «missing» (только недостающее) или «override»
  local line k v cur
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    k=${line%%=*}
    v=${line#*=}
    [[ "$k" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
    [ "$k" != "$line" ] || continue
    [ -n "$v" ] || continue
    cur=$(grep -m1 "^$k=" "$ENVF" 2>/dev/null | cut -d= -f2- | tr -d '\r')
    if [ -z "$cur" ] || { [ "$2" = "override" ] && [ "$cur" != "$v" ]; }; then
      grep -v "^$k=" "$ENVF" > "$TMP/env.new" 2>/dev/null || true
      printf '%s\n' "$line" >> "$TMP/env.new"
      # Пишем в тот же файл, а не подменяем его: так сохраняются права
      # и владелец, выставленные при установке.
      cat "$TMP/env.new" > "$ENVF"
      # В журнал — только имя: значение и есть секрет.
      if [ -z "$cur" ]; then log "ключ добавлен: $k"; else log "ключ обновлён: $k"; fi
    fi
  done < "$1"
}
merge_env "$TMP/x/env" missing
merge_env "$TMP/x/extra-env" override

systemctl start pravofin 2>/dev/null || true
printf '%s\n' "$ID" > "$IN_DONE"
log "ПЕРЕНОС ЗАВЕРШЁН: база и ключи со старой машины на месте"
