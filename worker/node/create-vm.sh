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
#   1. Загрузите в Cloud Shell файл cloud-init.ready.yaml — кнопкой «…»
#      вверху справа или просто перетащив его в окно терминала.
#      В нём ключи уже вписаны, руками ничего вставлять не нужно.
#
#   2. Запустите этот скрипт:
#
#          curl -fsSL https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/create-vm.sh -o create-vm.sh
#          bash create-vm.sh
#
# Скрипт покажет, что собирается сделать, и спросит подтверждение.
#
# Запасной путь, если загрузка файла недоступна: положить рядом
# ~/pravofin.env с содержимым worker/.env — скрипт соберёт настройку сам.

set -euo pipefail

NAME="${VM_NAME:-pravofin}"
ZONE="${VM_ZONE:-ru-central1-b}"
CORES="${VM_CORES:-2}"
FRACTION="${VM_FRACTION:-50}"
MEMORY="${VM_MEMORY:-4}"
DISK="${VM_DISK:-40}"
PLATFORM="${VM_PLATFORM:-standard-v3}"
ENV_FILE="${ENV_FILE:-$HOME/pravofin.env}"
BASE="https://raw.githubusercontent.com/divine-guest/ecofin"
RAW="$BASE/main/worker/node/cloud-init.yaml"
API="https://api.github.com/repos/divine-guest/ecofin/commits/main"

say()  { printf '%s\n' "$*"; }
fail() { printf '\n  ОШИБКА: %s\n\n' "$*" >&2; exit 1; }

# Разбираем обычные таблицы yc, а не JSON: столбцы находим по заголовку,
# поэтому порядок колонок может меняться — ничего не сломается. Разбор
# JSON построчным grep-ом выглядел короче, но ломался от любой перемены
# в форматировании вывода.

pick_column() {   # $1 — имя колонки для поиска, $2 — имя колонки-значения, $3 — что ищем
  awk -F'|' -v want="$3" -v keycol="$1" -v valcol="$2" '
    !ki && $0 ~ keycol {
      for (i = 1; i <= NF; i++) { c = $i; gsub(/^ +| +$/, "", c)
        if (c == keycol) ki = i; if (c == valcol) vi = i }
      next
    }
    ki && vi {
      k = $ki; gsub(/^ +| +$/, "", k)
      v = $vi; gsub(/^ +| +$/, "", v)
      if (k == want && v != "") { print v; exit }
    }'
}

first_column() {  # $1 — имя колонки; отдаёт первое непустое значение
  awk -F'|' -v col="$1" '
    !ci && $0 ~ col {
      for (i = 1; i <= NF; i++) { c = $i; gsub(/^ +| +$/, "", c); if (c == col) ci = i }
      next
    }
    ci { v = $ci; gsub(/^ +| +$/, "", v); if (v != "") { print v; exit } }'
}

say ""
say "=== Создание машины для ПравоФина ==="
say ""

# ---------- Проверки до всякой работы ----------

command -v yc >/dev/null 2>&1 || fail "не нашёл команду yc — запускать нужно в Cloud Shell консоли Yandex Cloud"

# Два способа передать ключи, и оба заканчиваются одним и тем же.
#
#   1. Загрузить готовый файл cloud-init.ready.yaml прямо в Cloud Shell —
#      в нём ключи уже вписаны. Ничего вставлять руками не нужно.
#   2. Положить рядом pravofin.env с содержимым worker/.env — тогда
#      скрипт соберёт настройку сам из образца в репозитории.
#
# Первый способ надёжнее: при вставке в терминал легко потерять часть
# строк и не заметить этого.
READY_IN="${READY_FILE:-$HOME/cloud-init.ready.yaml}"
MODE=""

if [ -f "$READY_IN" ] && grep -q '^#cloud-config' "$READY_IN"; then
  MODE="ready"
  # Считаем строки только внутри блока с ключами. Простой поиск по всему
  # файлу приписывал бы сюда и обычные переменные из вложенных скриптов
  # (DIR=, STAMP=, DOMAIN=), и число выглядело бы больше настоящего.
  VARS=$(awk '
    /^  - path: \/opt\/pravofin\/env/ { inside = 1; next }
    inside && /^  - path:/            { inside = 0 }
    inside && /^      [A-Z][A-Z0-9_]*=/ { n++ }
    END { print n + 0 }' "$READY_IN")
  [ "$VARS" -ge 8 ] || fail "в $READY_IN только $VARS строк с ключами — файл загрузился не полностью"
  grep -q 'AI_API_KEY=' "$READY_IN" || fail "в $READY_IN нет AI_API_KEY — файл загрузился не полностью"
elif [ -f "$ENV_FILE" ]; then
  MODE="env"
  # Пустой или подозрительно короткий файл ключей — почти наверняка
  # неудачная вставка. Лучше остановиться сейчас, чем поднять машину
  # без ключа ИИ и искать потом, почему консультант молчит.
  VARS=$(grep -cE '^[A-Z][A-Z0-9_]*=' "$ENV_FILE" || true)
  [ "$VARS" -ge 8 ] || fail "в $ENV_FILE только $VARS переменных — вставилось не всё.

  Проще всего не вставлять руками, а загрузить готовый файл:
    1. В Cloud Shell вверху справа нажмите «…» и выберите загрузку файла
       (или просто перетащите файл в окно терминала).
    2. Загрузите cloud-init.ready.yaml — тот, что я присылал в чат.
    3. Запустите этот скрипт снова.

  Если всё же хотите вставкой — откройте редактор, он покажет,
  что получилось:
       nano ~/pravofin.env
    вставить, затем Ctrl+O, Enter, Ctrl+X
    проверить:  grep -c = ~/pravofin.env"
  grep -q '^AI_API_KEY=' "$ENV_FILE" || fail "в $ENV_FILE нет AI_API_KEY — вставилось не всё"
else
  fail "не нашёл ни $READY_IN, ни $ENV_FILE

  Самый простой путь:
    1. В Cloud Shell вверху справа нажмите «…» → загрузить файл
       (или перетащите файл в окно терминала).
    2. Загрузите cloud-init.ready.yaml — тот, что я присылал в чат.
    3. Запустите этот скрипт снова:  bash create-vm.sh"
fi

# Каталог, в котором создавать машину.
#
# В Cloud Shell он обычно уже прописан, но не всегда: у свежего облака
# настройка бывает пустой. Тогда находим каталог сами и запоминаем —
# иначе о то же самое споткнутся и все следующие команды yc.
FOLDER="${VM_FOLDER_ID:-${YC_FOLDER_ID:-}}"
[ -n "$FOLDER" ] || FOLDER=$(yc config get folder-id 2>/dev/null || true)

if [ -z "$FOLDER" ]; then
  say "Каталог в настройках не задан, ищу сам…"

  CLOUDS=$(yc resource-manager cloud list 2>/dev/null || true)
  CLOUD=$(printf '%s\n' "$CLOUDS" | first_column ID)
  [ -n "$CLOUD" ] || fail "не вижу ни одного облака.

  Обычно это значит одно из двух:
    • облако ещё не создано — откройте console.yandex.cloud, оно
      предложит создать его одной кнопкой;
    • или Cloud Shell вошёл под другим аккаунтом — тогда выполните
      yc init и выберите нужное облако.

  Вот что вернул yc:
$CLOUDS"

  FOLDERS=$(yc resource-manager folder list --cloud-id "$CLOUD" 2>/dev/null || true)
  # Каталог «default» создаётся вместе с облаком; если его переименовали
  # или удалили — берём первый попавшийся, он там обычно один.
  FOLDER=$(printf '%s\n' "$FOLDERS" | pick_column NAME ID default)
  [ -n "$FOLDER" ] || FOLDER=$(printf '%s\n' "$FOLDERS" | first_column ID)
  [ -n "$FOLDER" ] || fail "в облаке $CLOUD нет ни одного каталога.
  Создайте каталог в консоли и запустите скрипт снова.

  Вот что вернул yc:
$FOLDERS"

  FOLDER_NAME=$(printf '%s\n' "$FOLDERS" | pick_column ID NAME "$FOLDER")
  say "Нашёл каталог: ${FOLDER_NAME:-без имени} ($FOLDER)"

  # Запоминаем, чтобы дальше yc не переспрашивал.
  yc config set cloud-id  "$CLOUD"  >/dev/null 2>&1 || true
  yc config set folder-id "$FOLDER" >/dev/null 2>&1 || fail "не смог запомнить каталог: yc config set folder-id $FOLDER"
fi

# Подсеть в нужной зоне.
SUBNETS=$(yc vpc subnet list 2>/dev/null || true)
SUBNET=$(printf '%s\n' "$SUBNETS" | pick_column ZONE NAME "$ZONE")

if [ -z "$SUBNET" ]; then
  # В облаке может не быть подсети именно в этой зоне — берём любую
  # и переезжаем в её зону, вместо того чтобы останавливать человека.
  OTHER_ZONE=$(printf '%s\n' "$SUBNETS" | awk -F'|' '
    !zi && /ZONE/ { for (i=1;i<=NF;i++){c=$i; gsub(/^ +| +$/,"",c); if(c=="ZONE") zi=i} next }
    zi { z=$zi; gsub(/^ +| +$/,"",z); if (z ~ /^ru-central1-/) { print z; exit } }')
  if [ -n "$OTHER_ZONE" ]; then
    say "В зоне $ZONE подсети нет, беру $OTHER_ZONE"
    ZONE="$OTHER_ZONE"
    SUBNET=$(printf '%s\n' "$SUBNETS" | pick_column ZONE NAME "$ZONE")
  fi
fi

[ -n "$SUBNET" ] || fail "не нашёл ни одной подсети.
  Откройте в консоли раздел «Virtual Private Cloud» и создайте сеть
  по умолчанию — обычно это одна кнопка. Потом запустите скрипт снова.

  Вот что вернул yc:
$SUBNETS"

EXISTS=""
if yc compute instance get --name "$NAME" >/dev/null 2>&1; then
  EXISTS="да"
  [ "${RECREATE:-}" = "1" ] || fail "машина с именем «$NAME» уже есть.

  Если она поднялась пустой и её нужно пересоздать — запустите так:
      RECREATE=1 bash create-vm.sh
  Скрипт покажет план, где будет сказано про удаление, и спросит согласия.

  Или создайте вторую, не трогая первую:
      VM_NAME=pravofin2 bash create-vm.sh"
fi

# ---------- Собираем настройку ----------

READY=$(mktemp)

if [ "$MODE" = "ready" ]; then
  say "Беру готовую настройку: $READY_IN"
  cp "$READY_IN" "$READY"
else
  say "Забираю образец настройки из репозитория…"
  TEMPLATE=$(mktemp)

  # Через обычный адрес с «main» кеш GitHub ещё несколько минут отдаёт
  # прежнюю копию — и мы взяли бы ровно тот файл, из-за которого машина
  # уже поднялась пустой. Метка времени в адресе не спасает: кеш считает
  # по пути. Поэтому сначала спрашиваем номер последней версии, а файл
  # берём по нему — такой адрес свежий всегда.
  SHA=$(curl -fsSL --max-time 20 "$API" 2>/dev/null | grep -m1 '"sha"' | cut -d'"' -f4)
  if [ -n "$SHA" ]; then
    say "  версия ${SHA:0:12}"
    curl -fsSL "$BASE/$SHA/worker/node/cloud-init.yaml" -o "$TEMPLATE" \
      || fail "не смог скачать настройку версии $SHA"
  else
    say "  номер версии не узнал, беру обычным адресом"
    curl -fsSL "$RAW" -o "$TEMPLATE" || fail "не смог скачать $RAW"
  fi

  # Ключи уходят внутрь блока YAML с отступом в шесть пробелов —
  # без выравнивания файл не разберётся и машина поднимется пустой.
  INDENTED=$(grep -E '^[A-Z][A-Z0-9_]*=' "$ENV_FILE" | sed 's/^/      /')
  awk -v repl="$INDENTED" '
    /__WORKER_ENV__/ { print repl; next }
    { print }
  ' "$TEMPLATE" > "$READY"
  rm -f "$TEMPLATE"
fi

grep -q '__WORKER_ENV__' "$READY" && fail "не удалось подставить ключи в настройку"

# Первая строка обязана быть ровно «#cloud-config».
#
# Это не придирка. cloud-init смотрит только на самую первую строку:
# если там что-то другое — хоть комментарий, хоть пустая строка, — он
# молча пропускает весь файл. Машина поднимается чистой Ubuntu, ошибки
# нигде не видно, и выясняется это только через полчаса поисков.
# Один раз мы так уже потеряли машину, поэтому проверяем здесь.
FIRST=$(head -1 "$READY" | tr -d '\r')
[ "$FIRST" = "#cloud-config" ] || fail "первая строка настройки — «$FIRST», а должна быть «#cloud-config».
  Без этого cloud-init пропустит файл и машина поднимется пустой."

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
if [ -n "$EXISTS" ]; then
  say ""
  say "  ВНИМАНИЕ: существующая машина «$NAME» будет СНАЧАЛА УДАЛЕНА."
  say "  Всё, что на ней есть, пропадёт вместе с ней."
fi
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
if [ -n "$EXISTS" ]; then
  say "Удаляю старую машину…"
  yc compute instance delete --name "$NAME" || fail "не смог удалить машину «$NAME»"
fi

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

rm -f "$READY"

IP=$(yc compute instance list 2>/dev/null | pick_column NAME "EXTERNAL IP" "$NAME" || true)

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
