#!/bin/bash
# ============ Создание машины из Cloud Shell ============
#
# Зачем этот скрипт. В форме создания ВМ поле «Значение» у метаданных —
# однострочное, а настройка занимает две с половиной сотни строк, и
# вставить её туда нельзя. Cloud Shell — обычный терминал, там всё
# вставляется, и заодно машина создаётся с правильными параметрами:
# без видеокарты, с нужным образом и с уже вписанной настройкой.
#
# Как пользоваться (в Cloud Shell консоли Yandex Cloud):
#
#   1. Создайте файл с ключами — откройте у себя worker/.env,
#      скопируйте его целиком и вставьте между строками:
#
#          cat > ~/pravofin.env << 'PRAVOFIN'
#          ...сюда вставить содержимое worker/.env...
#          PRAVOFIN
#
#   2. Запустите этот скрипт:
#
#          curl -fsSL https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/create-vm.sh -o create-vm.sh
#          bash create-vm.sh
#
# Скрипт покажет, что собирается сделать, и спросит подтверждение.

set -euo pipefail

NAME="${VM_NAME:-pravofin}"
ZONE="${VM_ZONE:-ru-central1-b}"
CORES="${VM_CORES:-2}"
FRACTION="${VM_FRACTION:-50}"
MEMORY="${VM_MEMORY:-4}"
DISK="${VM_DISK:-40}"
PLATFORM="${VM_PLATFORM:-standard-v3}"
ENV_FILE="${ENV_FILE:-$HOME/pravofin.env}"
RAW="https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/cloud-init.yaml"

say()  { printf '%s\n' "$*"; }
fail() { printf '\n  ОШИБКА: %s\n\n' "$*" >&2; exit 1; }

say ""
say "=== Создание машины для ПравоФина ==="
say ""

# ---------- Проверки до всякой работы ----------

command -v yc >/dev/null 2>&1 || fail "не нашёл команду yc — запускать нужно в Cloud Shell консоли Yandex Cloud"

[ -f "$ENV_FILE" ] || fail "не нашёл файл $ENV_FILE
  Сначала создайте его: скопируйте содержимое worker/.env и выполните
      cat > ~/pravofin.env << 'PRAVOFIN'
      ...вставить...
      PRAVOFIN"

# Пустой или подозрительно короткий файл ключей — почти наверняка
# неудачная вставка. Лучше остановиться сейчас, чем поднять машину
# без ключа ИИ и искать потом, почему консультант молчит.
VARS=$(grep -cE '^[A-Z][A-Z0-9_]*=' "$ENV_FILE" || true)
[ "$VARS" -ge 8 ] || fail "в $ENV_FILE только $VARS переменных — похоже, вставилось не всё"
grep -q '^AI_API_KEY=' "$ENV_FILE" || fail "в $ENV_FILE нет AI_API_KEY — вставилось не всё"

FOLDER=$(yc config get folder-id 2>/dev/null || true)
[ -n "$FOLDER" ] || fail "не понял, в каком каталоге работать: yc config get folder-id ничего не вернул"

# Подсеть в нужной зоне. Берём первую подходящую: в новом облаке она одна.
SUBNET=$(yc vpc subnet list --format json 2>/dev/null \
  | grep -B4 "\"zone_id\": \"$ZONE\"" \
  | grep '"name"' | head -1 | cut -d'"' -f4 || true)
[ -n "$SUBNET" ] || fail "не нашёл подсеть в зоне $ZONE — создайте сеть по умолчанию в разделе VPC"

if yc compute instance get --name "$NAME" >/dev/null 2>&1; then
  fail "машина с именем «$NAME» уже есть.
  Удалить:  yc compute instance delete --name $NAME
  Или задать другое имя:  VM_NAME=pravofin2 bash create-vm.sh"
fi

# ---------- Собираем настройку ----------

say "Забираю образец настройки из репозитория…"
TEMPLATE=$(mktemp)
curl -fsSL "$RAW" -o "$TEMPLATE" || fail "не смог скачать $RAW"

READY=$(mktemp)
# Ключи уходят внутрь блока YAML с отступом в шесть пробелов —
# без выравнивания файл не разберётся и машина поднимется пустой.
INDENTED=$(grep -E '^[A-Z][A-Z0-9_]*=' "$ENV_FILE" | sed 's/^/      /')
awk -v repl="$INDENTED" '
  /__WORKER_ENV__/ { print repl; next }
  { print }
' "$TEMPLATE" > "$READY"

grep -q '__WORKER_ENV__' "$READY" && fail "не удалось подставить ключи в настройку"

# ---------- Показываем и спрашиваем ----------

say ""
say "Что будет создано:"
say "  имя машины     $NAME"
say "  каталог        $FOLDER"
say "  зона           $ZONE"
say "  подсеть        $SUBNET"
say "  платформа      $PLATFORM   (обычная, БЕЗ видеокарты)"
say "  ядра           $CORES, гарантированная доля ${FRACTION}%"
say "  память         $MEMORY ГБ"
say "  диск           SSD $DISK ГБ"
say "  образ          Ubuntu 24.04 LTS"
say "  доступ         OS Login (ключи не нужны)"
say "  ключей внутри  $VARS"
say ""
say "Ориентировочно это около 2 300 ₽ в месяц."
say "Если в списке выше есть слово GPU или число ядер больше двух — не соглашайтесь."
say ""
printf "Создавать? [да/нет]: "
read -r ANSWER
case "$ANSWER" in
  да|Да|ДА|yes|y|Y) ;;
  *) say "Отменено, ничего не создано."; exit 0 ;;
esac

# ---------- Создаём ----------

say ""
say "Создаю машину…"
yc compute instance create \
  --name "$NAME" \
  --hostname "$NAME" \
  --zone "$ZONE" \
  --platform "$PLATFORM" \
  --cores "$CORES" \
  --core-fraction "$FRACTION" \
  --memory "${MEMORY}GB" \
  --create-boot-disk type=network-ssd,size="${DISK}GB",image-folder-id=standard-images,image-family=ubuntu-2404-lts \
  --network-interface subnet-name="$SUBNET",nat-ip-version=ipv4 \
  --metadata-from-file user-data="$READY" \
  --metadata enable-oslogin=true \
  --async=false

rm -f "$TEMPLATE" "$READY"

IP=$(yc compute instance get --name "$NAME" --format json \
  | grep -A3 one_to_one_nat | grep '"address"' | head -1 | cut -d'"' -f4 || true)

say ""
say "=== Машина создана ==="
say ""
if [ -n "$IP" ]; then
  say "  Публичный адрес: $IP"
  say ""
  say "  Подождите 5–7 минут — машина сама ставит Node, nginx и поднимает сервис."
  say "  Потом откройте в браузере:"
  say ""
  say "      http://$IP/api/health"
  say ""
  say "  Должно ответить: {\"ok\":true, ... \"db\":true}"
  say ""
  say "  Если не отвечает — посмотрите, на чём запнулось:"
  say "      yc compute instance get-serial-port-output --name $NAME | tail -50"
else
  say "  Машина создана, но публичный адрес не определился."
  say "  Посмотрите его в консоли или командой: yc compute instance get --name $NAME"
fi
say ""
say "  Удалить, если что-то пошло не так:  yc compute instance delete --name $NAME"
say ""
