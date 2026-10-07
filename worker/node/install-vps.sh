#!/bin/bash
# ============ Первая установка на обычный сервер ============
#
# Для сервера, созданного не в Yandex Cloud, а у обычного хостера
# (с 07.10.2026 — рег.ру). Делает то же, что в Яндексе делал cloud-init:
# кладёт на машину ключи, скрипт добычи кода и расписание. Дальше всё
# как прежде: bootstrap.sh раз в пять минут тянет код, setup.sh приводит
# машину в порядок. Выкатка остаётся обычным git push.
#
# Запускается один раз, от root. Повторный запуск безвреден: всё, что
# уже есть, остаётся как было — в первую очередь файл с ключами.
#
# Два способа запуска.
#
#   1. С компьютера владельца — vps-start.sh. Он кладёт рядом с этим
#      файлом ключи из worker/.env и bootstrap.sh, а потом запускает его.
#      Ключи идут по ssh и нигде больше не появляются.
#
#   2. Прямо на сервере, если с компьютера до него не достучаться:
#        curl -fsSL https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node/install-vps.sh | bash
#      Ключей в этом случае нет: сайт поднимется, но без ИИ и оплаты,
#      а ключи придётся вписать в /opt/pravofin/env руками.
#
# Весь код лежит в функции и вызывается последней строкой. При запуске
# через «curl | bash» оборванная закачка иначе выполнила бы половину
# файла — например, поставила бы расписание, но не положила ключи.

set -uo pipefail

# Откуда нас запустили. Имя файла известно только при запуске с диска;
# при запуске из потока его нет, и рядом искать нечего.
SELF="${BASH_SOURCE[0]:-}"
STAGE=""
if [ -n "$SELF" ] && [ -f "$SELF" ]; then
  STAGE=$(cd "$(dirname "$SELF")" 2>/dev/null && pwd)
fi

main() {
  local DIR=/opt/pravofin
  local REPO=$DIR/repo
  local LOG=/var/log/pravofin-setup.log
  local RAW=https://raw.githubusercontent.com/divine-guest/ecofin/main/worker/node
  local CDN=https://cdn.jsdelivr.net/gh/divine-guest/ecofin@main/worker/node

  [ "$(id -u)" = "0" ] || { echo "запускать нужно от root"; exit 1; }
  command -v apt-get >/dev/null 2>&1 || { echo "нужна Ubuntu или Debian: без apt установка не пойдёт"; exit 1; }

  touch "$LOG"
  log() { printf '[install] %s\n' "$*" | tee -a "$LOG"; }
  die() { log "ОШИБКА: $*"; exit 1; }

  log "начинаю первую установку, $(date -Is)"

  # ---------- Одна установка за раз ----------
  #
  # Тот же замок, что у расписания. Пока он у нас, запуск по расписанию
  # тихо пропускается (у него flock -n), и два установщика не лезут в
  # одни и те же файлы. Если машина уже настроена и установка идёт прямо
  # сейчас — ждём её, а не падаем.
  exec 9>/var/lock/pravofin.lock
  flock -w 1200 9 || die "другая установка идёт дольше двадцати минут — разберитесь с ней сначала"

  # ---------- 1. Самое необходимое ----------
  #
  # Только то, без чего не добыть код и не запустить расписание.
  # Остальное — nginx, Node, сборку — ставит setup.sh.
  #
  # Ожидание замка обязательно: свежая машина первые минуты сама
  # обновляет пакеты и держит apt занятым. Без ожидания установка
  # падала бы на ровном месте именно при первом запуске.
  export DEBIAN_FRONTEND=noninteractive
  local APT="apt-get -o DPkg::Lock::Timeout=300"
  local need="" pair cmd pkg
  for pair in "git:git" "curl:curl" "crontab:cron" "openssl:openssl" "flock:util-linux"; do
    cmd=${pair%%:*}; pkg=${pair#*:}
    command -v "$cmd" >/dev/null 2>&1 || need="$need $pkg"
  done
  [ -f /etc/ssl/certs/ca-certificates.crt ] || need="$need ca-certificates"

  if [ -n "$need" ]; then
    log "ставлю пакеты:$need"
    $APT update -qq || log "apt-get update не удался, пробую ставить всё равно"
    for pkg in $need; do
      $APT install -y -qq "$pkg" >/dev/null 2>&1 || log "не встал пакет $pkg"
    done
  fi
  command -v curl >/dev/null 2>&1 || die "нет curl — код скачать нечем"
  systemctl enable --now cron >/dev/null 2>&1 || true

  # ---------- 2. Папка ----------
  #
  # Создаём сами и с правами 755. Если оставить это useradd из setup.sh,
  # на свежей Ubuntu домашняя папка выйдет с правами 750, nginx не сможет
  # в неё зайти — и сайт будет отвечать 403 на каждую страницу.
  mkdir -p "$DIR"
  chmod 755 "$DIR"

  # ---------- 3. Ключи ----------
  if [ -f "$DIR/env" ]; then
    log "файл с ключами уже на месте — не трогаю"
  elif [ -n "$STAGE" ] && [ -s "$STAGE/env" ]; then
    install -m 600 -o root -g root "$STAGE/env" "$DIR/env"
    log "ключи положены, настроек: $(grep -cE '^[A-Z][A-Z0-9_]*=' "$DIR/env")"
  else
    # Без файла setup.sh останавливается совсем. Поэтому кладём
    # заготовку: два секрета, которые машина может придумать сама, —
    # и говорим вслух, чего не хватает.
    {
      echo "AI_BASE_URL=https://api.aitunnel.ru/v1"
      echo "RECOVERY_SECRET=$(openssl rand -hex 16)"
      echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 16)"
    } > "$DIR/env"
    chmod 600 "$DIR/env"
    log "ВНИМАНИЕ: ключей не передали. Сайт поднимется, но без ИИ, оплаты и владельца."
    log "          Вписать их нужно в $DIR/env строками вида КЛЮЧ=значение."
  fi
  # Переданную копию убираем: ключам незачем лежать в двух местах.
  if [ -n "$STAGE" ] && [ -f "$STAGE/env" ]; then
    shred -u "$STAGE/env" 2>/dev/null || rm -f "$STAGE/env"
  fi

  # ---------- 4. Скрипт, который добывает код ----------
  local got="" url
  if [ -n "$STAGE" ] && [ -s "$STAGE/bootstrap.sh" ]; then
    cp "$STAGE/bootstrap.sh" "$DIR/bootstrap.sh.new" && got="передан вместе с установщиком"
  fi
  if [ -z "$got" ]; then
    for url in "$RAW/server-setup/bootstrap.sh" "$CDN/server-setup/bootstrap.sh"; do
      if curl -fsSL --max-time 40 "$url" -o "$DIR/bootstrap.sh.new" 2>/dev/null; then
        got="скачан"
        break
      fi
    done
  fi
  [ -n "$got" ] || die "не удалось получить bootstrap.sh: GitHub отсюда не открылся. Запустите установку ещё раз через несколько минут."

  # Проверяем, что пришёл именно скрипт. Вместо него легко получить
  # страницу с ошибкой, и тогда расписание каждые пять минут запускало
  # бы мусор, а машина молча стояла бы без кода.
  sed -i 's/\r$//' "$DIR/bootstrap.sh.new"
  if head -1 "$DIR/bootstrap.sh.new" | grep -q '^#!/bin/bash' && bash -n "$DIR/bootstrap.sh.new" 2>/dev/null; then
    install -m 755 "$DIR/bootstrap.sh.new" "$DIR/bootstrap.sh"
    rm -f "$DIR/bootstrap.sh.new"
    log "bootstrap.sh на месте ($got)"
  else
    rm -f "$DIR/bootstrap.sh.new"
    die "вместо bootstrap.sh пришло что-то другое"
  fi

  # ---------- 5. Расписание ----------
  #
  # Раньше всего остального: если дальше что-то сорвётся, через пять
  # минут машина попробует снова сама. Полное расписание — с копиями и
  # наблюдением — потом допишет setup.sh; существующее не трогаем.
  if [ ! -f /etc/cron.d/pravofin ]; then
    printf '%s\n' \
      'SHELL=/bin/bash' \
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
      '*/5 * * * * root flock -n /var/lock/pravofin.lock /opt/pravofin/bootstrap.sh >> /var/log/pravofin-setup.log 2>&1' \
      > /etc/cron.d/pravofin
    chmod 644 /etc/cron.d/pravofin
    log "расписание прописано"
  fi

  # ---------- 6. Код ----------
  log "добываю код…"
  FETCH_ONLY=1 bash "$DIR/bootstrap.sh" 2>&1 | tee -a "$LOG"

  if [ ! -f "$REPO/worker/node/server-setup/setup.sh" ]; then
    log "код пока не скачался: GitHub не открылся. Машина будет пробовать сама раз в пять минут."
    exit 0
  fi

  # Проверки на новой машине сами не запускаются.
  #
  # Файл RUN-TESTS в репозитории — просьба прогнать сюиты, обращённая к
  # той машине, которая работала на момент просьбы. Новая машина приняла
  # бы её на свой счёт и первым делом завела бы в свежей базе десятки
  # проверочных аккаунтов. Нужен прогон — меняется RUN-TESTS, как обычно.
  if [ ! -f "$DIR/tests.done" ] && [ -f "$REPO/worker/node/RUN-TESTS" ]; then
    cp "$REPO/worker/node/RUN-TESTS" "$DIR/tests.done"
  fi

  # ---------- 7. Всё остальное ----------
  log "ставлю всё остальное — это пять-десять минут"
  bash "$DIR/bootstrap.sh" 2>&1 | tee -a "$LOG"

  # ---------- Итог ----------
  sleep 3
  local api="НЕ ОТВЕЧАЕТ" code ip
  curl -fsS -m 10 http://127.0.0.1:8080/api/health >/dev/null 2>&1 && api="отвечает"
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1/ 2>/dev/null)
  ip=$(curl -s --max-time 8 https://api.ipify.org 2>/dev/null)
  log "ИТОГ: служба $api, главная страница — код ${code:-нет ответа}, адрес машины ${ip:-неизвестен}"
}

main "$@"
