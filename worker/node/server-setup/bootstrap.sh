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
  [ -d "$REPO" ] && mv "$REPO" "$REPO.old"
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

if ! have_repo; then
  log "кода на машине нет, добываю"
  for i in 1 2 3; do
    fetch && break
    log "попытка $i не удалась"
    [ "$i" -lt 3 ] && sleep 20
  done
elif [ ! -d "$REPO/.git" ]; then
  # Код приехал архивом — обновляться он не умеет. Как только github.com
  # начнёт открываться, тихо переходим на git и живём обычной жизнью.
  try_git && log "перешёл на git, обновления теперь быстрые"
fi

if ! have_repo; then
  log "код добыть не удалось, попробую снова через пять минут"
  exit 0
fi

exec bash "$SETUP"
