#!/bin/bash
# ============ Как машина достаёт свой код ============
#
# Этот файл — единственное, что попадает на машину не из репозитория:
# он приезжает внутри cloud-init и дальше живёт сам по себе. Поэтому он
# намеренно маленький и меняться не должен.
#
# Зачем он вообще нужен. Из российского облака github.com открывается не
# всегда: в первый раз код скачался за две секунды, во второй git ждал
# соединения 134 секунды и сдался. Машина осталась без кода, без
# установщика и без единого шанса это исправить — чинить было нечем.
#
# Что делает: любыми доступными способами добывает код и запускает
# установщик. Не вышло — молча уходит, потому что через пять минут его
# позовут снова. Пробовать раз в пять минут бесконечно надёжнее, чем
# один раз, но с самым лучшим адресом.
#
# Способы идут по убыванию удобства:
#   1. git — обычный, после него работают быстрые обновления;
#   2. codeload — архивом, это другой адрес и он может открыться,
#      когда основной не отвечает;
#   3. api.github.com — тоже архивом, третий независимый адрес.

set -uo pipefail

DIR=/opt/pravofin
REPO=$DIR/repo
SETUP=$REPO/worker/node/server-setup/setup.sh
OWNER=divine-guest
NAME=ecofin
BRANCH=main

log() { printf '[bootstrap] %s\n' "$*"; }

have_repo() { [ -f "$SETUP" ]; }

# Скачиваем всегда рядом и подменяем целиком. Иначе оборванная закачка
# оставила бы половину сайта, и это было бы хуже, чем ничего.
swap_in() {
  [ -f "$REPO.new/worker/node/server-setup/setup.sh" ] || return 1
  rm -rf "$REPO.old"
  if [ -d "$REPO" ]; then
    mv "$REPO" "$REPO.old"
    # Зависимости переносим, а не скачиваем заново: их установка занимает
    # две минуты и требует сборки из исходников. Список зависимостей меняется
    # раз в полгода, а обновления приходят каждые пять минут.
    [ -d "$REPO.old/worker/node_modules" ] && \
      mv "$REPO.old/worker/node_modules" "$REPO.new/worker/node_modules"
  fi
  mv "$REPO.new" "$REPO"
  rm -rf "$REPO.old"
}

try_git() {
  command -v git >/dev/null 2>&1 || return 1
  rm -rf "$REPO.new"
  # Ограничение по времени обязательно: без него git висит две минуты,
  # а запусков раз в пять минут.
  timeout 90 git clone --depth 1 "https://github.com/$OWNER/$NAME.git" "$REPO.new" >/dev/null 2>&1 || return 1
  swap_in
}

try_tar() {   # $1 — адрес архива
  rm -rf "$REPO.new"
  mkdir -p "$REPO.new"
  curl -fsSL --max-time 120 "$1" 2>/dev/null | tar xz -C "$REPO.new" --strip-components=1 2>/dev/null || return 1
  swap_in
}

fetch() {
  try_git && { log "код взят через git"; return 0; }
  try_tar "https://codeload.github.com/$OWNER/$NAME/tar.gz/refs/heads/$BRANCH" \
    && { log "код взят архивом с codeload"; return 0; }
  try_tar "https://api.github.com/repos/$OWNER/$NAME/tarball/$BRANCH" \
    && { log "код взят архивом через api"; return 0; }
  rm -rf "$REPO.new"
  return 1
}

# Свежий ли код на машине.
#
# Спрашиваем у GitHub номер последней версии и сравниваем со своим. Это
# один короткий запрос, его можно делать хоть каждые пять минут. И, что
# важнее, он идёт на другой адрес, чем git: бывает, что git не проходит,
# а этот отвечает.
remote_sha() {
  curl -fsSL --max-time 20 "https://api.github.com/repos/$OWNER/$NAME/commits/$BRANCH" 2>/dev/null \
    | grep -m1 '"sha"' | cut -d'"' -f4
}

local_sha() {
  if [ -d "$REPO/.git" ]; then git -C "$REPO" rev-parse HEAD 2>/dev/null
  else cat "$REPO/.version" 2>/dev/null; fi
}

# Обновление. Сначала git — он быстрый и качает только разницу. Не вышло —
# идём архивом.
#
# Раньше здесь был только git, и это оказалось дырой: когда github.com
# переставал открываться, обновления замирали молча. Машина продолжала
# работать на старом коде, а мы пятнадцать минут ждали изменений, которые
# никогда бы не приехали.
refresh() {
  if [ -d "$REPO/.git" ]; then
    if timeout 60 git -C "$REPO" fetch --quiet origin "$BRANCH" 2>/dev/null &&
       git -C "$REPO" reset --hard --quiet "origin/$BRANCH" 2>/dev/null; then
      return 0
    fi
    log "git не прошёл, пробую архивом"
  fi

  local sha; sha=$(remote_sha)
  [ -n "$sha" ] || { log "номер версии узнать не удалось, оставляю как есть"; return 1; }

  try_tar "https://codeload.github.com/$OWNER/$NAME/tar.gz/$sha" \
    || try_tar "https://api.github.com/repos/$OWNER/$NAME/tarball/$sha" \
    || { log "архив скачать не удалось, оставляю как есть"; return 1; }

  printf '%s\n' "$sha" > "$REPO/.version"
  log "обновлено архивом до ${sha:0:12}"
}

if ! have_repo; then
  log "кода на машине нет, добываю"
  for i in 1 2 3; do
    fetch && break
    log "попытка $i не удалась"
    [ "$i" -lt 3 ] && sleep 20
  done
else
  BEFORE=$(local_sha)
  REMOTE=$(remote_sha)
  # Сверяем до скачивания: обычно версия та же, и тратить на это трафик
  # каждые пять минут незачем.
  if [ -n "$REMOTE" ] && [ "$REMOTE" != "$BEFORE" ]; then
    log "есть версия свежее (${REMOTE:0:12}), обновляюсь"
    refresh || true
  elif [ -z "$REMOTE" ]; then
    # GitHub не ответил вовсе — пробуем обновиться вслепую, вдруг git пройдёт.
    refresh >/dev/null 2>&1 || true
  fi
fi

if ! have_repo; then
  log "код добыть не удалось, попробую снова через пять минут"
  exit 0
fi

exec bash "$SETUP"
