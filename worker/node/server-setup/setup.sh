#!/bin/bash
# ============ Установка и починка сервера ПравоФина ============
#
# Запускается два раза в жизни машины и потом ещё раз в пять минут:
#   1. при первом включении — из cloud-init;
#   2. по расписанию — чтобы подтянуть новый код и починить то, что
#      отвалилось.
#
# Поэтому он написан так, чтобы его можно было запускать сколько угодно
# раз подряд: всё, что уже сделано, пропускается. Это не «скрипт первой
# установки», а «привести машину в нужное состояние».
#
# Почему настройки лежат отдельными файлами рядом, а не внутри cloud-init:
# один раз мы уже потеряли вечер на том, что из конфигурации nginx по
# дороге пропала переменная $uri. Файл из репозитория попадает на диск
# байт в байт — что в git, то и на сервере.
#
# Руками:  sudo /opt/pravofin/repo/worker/node/server-setup/setup.sh

set -uo pipefail

DIR=/opt/pravofin
REPO=$DIR/repo
HERE=$REPO/worker/node/server-setup

log() { printf '[setup] %s\n' "$*"; }
die() { printf '[setup] ОШИБКА: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "запускать нужно от root: sudo $0"

CHANGED=""            # что-то поменялось и службу надо перезапустить
mark() { CHANGED="да"; }

# Кладёт файл на место, только если он отличается. Так перезапуск
# случается по делу, а не каждые пять минут просто так.
install_if_changed() {  # $1 — откуда, $2 — куда, $3 — права
  [ -f "$1" ] || die "нет файла $1"
  if [ ! -f "$2" ] || ! cmp -s "$1" "$2"; then
    install -m "$3" "$1" "$2"
    log "обновлён $2"
    mark
  fi
}

# ---------- 1. Пользователь и папки ----------

id pravofin >/dev/null 2>&1 || \
  useradd --system --create-home --home-dir "$DIR" --shell /usr/sbin/nologin pravofin
mkdir -p "$DIR/data" "$DIR/backups"

# ---------- 2. Код ----------

# Забирать код — не наша забота: этим занимается bootstrap.sh, у которого
# на такой случай три разных способа. Мы только подтягиваем свежее, если
# код лежит git-репозиторием. Приехал архивом — обновит его снова
# bootstrap, когда github.com откроется.
if [ ! -d "$REPO/.git" ]; then
  log "код лежит без git — обновлениями займётся bootstrap"
else
  BEFORE=$(git -C "$REPO" rev-parse HEAD 2>/dev/null)
  git -C "$REPO" fetch --quiet origin main 2>/dev/null && \
  git -C "$REPO" reset --hard --quiet origin/main 2>/dev/null
  AFTER=$(git -C "$REPO" rev-parse HEAD 2>/dev/null)
  if [ "$BEFORE" != "$AFTER" ]; then
    log "код обновлён до ${AFTER:0:12}"
    mark
  fi
fi

# ---------- 3. Расписание ----------
#
# Прописываем СРАЗУ, как только код оказался на диске, и до всякой
# установки.
#
# Причина дорогая: раньше это стояло в самом конце, и упавшая установка
# не повторялась никогда — машина просто оставалась мёртвой. Теперь даже
# если дальше всё сорвётся, через пять минут будет новая попытка, и любое
# исправление в репозитории доедет само.

CRON=/etc/cron.d/pravofin
NEW_CRON="SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root flock -n /var/lock/pravofin.lock $DIR/bootstrap.sh >> /var/log/pravofin-setup.log 2>&1
0 * * * * root $DIR/backup.sh >> /var/log/pravofin-backup.log 2>&1
17 * * * * root $DIR/watch-outside.sh >> /var/log/pravofin-outside.log 2>&1"
if [ ! -f "$CRON" ] || [ "$(cat "$CRON")" != "$NEW_CRON" ]; then
  printf '%s\n' "$NEW_CRON" > "$CRON"
  chmod 644 "$CRON"
  log "расписание обновлено"
fi

# ---------- 4. Системные пакеты ----------

# Ставим по одному, а не списком.
#
# Списком одна неудачная строка обрушивает всю команду, и следом не
# ставится ничего — включая nginx, без которого сайт просто не отвечает.
# По одному видно, что именно не встало, и остальное всё равно встаёт.
#
# Обязательны только git и nginx: без них сайта нет. Без certbot не будет
# HTTPS, без ufw — firewall, и это неприятно, но переживаемо: лучше
# работающий сайт с недоделками, чем мёртвая машина.

MISSING=""
for pair in "git:git" "nginx:nginx" "cc:build-essential" "sqlite3:sqlite3" "ufw:ufw" "certbot:python3-certbot-nginx"; do
  cmd=${pair%%:*}; pkg=${pair#*:}
  command -v "$cmd" >/dev/null 2>&1 || MISSING="$MISSING $pkg"
done

if [ -n "$MISSING" ]; then
  log "ставлю пакеты:$MISSING"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq || log "apt-get update не удался, пробую ставить всё равно"
  for pkg in $MISSING; do
    apt-get install -y -qq "$pkg" >/dev/null 2>&1 || log "не встал пакет $pkg"
  done
fi

for need in git nginx; do
  command -v "$need" >/dev/null 2>&1 || die "нет $need — без него сайт работать не сможет"
done

# ---------- 5. Node и npm ----------
#
# Сначала пробуем NodeSource — там свежий Node 22. Но из российского
# облака этот адрес может не открываться (мы на этом уже спотыкались:
# curl висел четыре минуты и сдавался). Тогда берём Node из обычного
# репозитория Ubuntu: там 18-я версия, её нам достаточно — весь проект
# на ней и проверялся.
#
# Главное — не остаться без npm. Пакет nodejs из Ubuntu ставит только
# node, npm идёт отдельным пакетом, и из-за этого в прошлый раз молча
# не установились зависимости.

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  command -v npm  >/dev/null 2>&1 || return 1
  local major
  major=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
  [ -n "$major" ] && [ "$major" -ge 18 ]
}

if ! node_ok; then
  log "ставлю Node…"
  export DEBIAN_FRONTEND=noninteractive

  if curl -fsSL --max-time 25 https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh 2>/dev/null; then
    log "беру Node 22 из NodeSource"
    bash /tmp/nodesource.sh >/dev/null 2>&1 || log "NodeSource не подключился"
    rm -f /tmp/nodesource.sh
    apt-get install -y -qq nodejs || true
  else
    log "NodeSource недоступен — беру Node из репозитория Ubuntu"
  fi

  # Если после NodeSource всё равно чего-то не хватает — добираем из Ubuntu.
  node_ok || apt-get install -y -qq nodejs npm || true
  node_ok || die "не удалось поставить Node с npm"
  mark
fi
log "node $(node -v), npm $(npm -v)"

# ---------- 6. Секреты ----------

[ -f "$DIR/env" ] || die "нет файла $DIR/env — машину нужно создавать заново"

# Настройки собираются из двух источников.
#
#   /opt/pravofin/env            — секреты, только на машине, в репозиторий
#                                  не попадают никогда;
#   worker/node/env-public.txt   — то, что секретом не является: адрес
#                                  сайта, список разрешённых источников.
#
# Второй накладывается поверх первого. Смысл в том, чтобы поменять адрес
# сайта можно было обычной выкладкой — не пересоздавая машину и не трогая
# секреты. Бот шлёт людям ссылки, и если там старый адрес, человек попадёт
# на страницу, которая стучится в заблокированный Cloudflare.
#
# Ключи и токены сюда класть нельзя: репозиторий открыт всему интернету.
BUILT=$(mktemp)
PUBLIC=$REPO/worker/node/env-public.txt

if [ -f "$PUBLIC" ]; then
  # Из машинных берём только те строки, которых нет в открытых:
  # так открытое значение побеждает, а остальное остаётся как было.
  OVERRIDE=$(grep -oE '^[A-Z][A-Z0-9_]*' "$PUBLIC" 2>/dev/null | sort -u)
  if [ -n "$OVERRIDE" ]; then
    grep -vE "^($(printf '%s' "$OVERRIDE" | tr '
' '|' | sed 's/|$//'))=" "$DIR/env" > "$BUILT"
  else
    cp "$DIR/env" "$BUILT"
  fi
  grep -E '^[A-Z][A-Z0-9_]*=' "$PUBLIC" >> "$BUILT"
else
  cp "$DIR/env" "$BUILT"
fi

if ! cmp -s "$BUILT" "$REPO/worker/.env"; then
  install -m 600 -o pravofin -g pravofin "$BUILT" "$REPO/worker/.env"
  log "настройки обновлены"
  mark
fi
rm -f "$BUILT"

# ---------- 7. Зависимости ----------
#
# Ставим, если их нет или если изменился список. Отдельная проверка на
# better-sqlite3: он собирается из исходников и может не собраться —
# это не повод останавливать установку, но знать об этом надо.

NEED_NPM=""
[ -d "$REPO/worker/node_modules" ] || NEED_NPM="да"
[ -n "$CHANGED" ] && NEED_NPM="да"

if [ -n "$NEED_NPM" ]; then
  log "ставлю зависимости…"
  ( cd "$REPO/worker" && npm install --omit=dev --no-audit --no-fund ) \
    || log "npm install прошёл с ошибками — смотрим, что получилось"
fi

# Права правим только когда что-то менялось: пробегать по всему дереву
# каждые пять минут незачем.
[ -n "$CHANGED" ] && chown -R pravofin:pravofin "$DIR"

# Какой драйвер базы требовать. Родной быстрее и, главное, не держит файл
# базы монопольно — с ним работают почасовые копии. Но если он не собрался,
# требовать его нельзя: сервер не запустится вовсе.
if ( cd "$REPO/worker" && node -e "require('better-sqlite3')" >/dev/null 2>&1 ); then
  NEW_DRIVER="DB_DRIVER=native"
  log "драйвер базы: родной (better-sqlite3)"
else
  NEW_DRIVER="# better-sqlite3 не собрался, работаем на запасном драйвере"
  log "ВНИМАНИЕ: better-sqlite3 не собрался — идём на запасном драйвере."
  log "         Он держит файл базы монопольно, почасовые копии работать не будут."
fi
if [ ! -f "$DIR/driver.env" ] || [ "$(cat "$DIR/driver.env")" != "$NEW_DRIVER" ]; then
  printf '%s\n' "$NEW_DRIVER" > "$DIR/driver.env"
  mark
fi

# ---------- 8. Служба и nginx ----------

install_if_changed "$HERE/bootstrap.sh"     "$DIR/bootstrap.sh"     755
install_if_changed "$HERE/pravofin.service" /etc/systemd/system/pravofin.service 644
install_if_changed "$HERE/backup.sh"        "$DIR/backup.sh"        755
install_if_changed "$HERE/check-domain.sh"  "$DIR/check-domain.sh"  755
install_if_changed "$HERE/watch-outside.sh" "$DIR/watch-outside.sh" 755
install_if_changed "$HERE/run-tests.sh"     "$DIR/run-tests.sh"     755
install_if_changed "$HERE/enable-tls.sh"    "$DIR/enable-tls.sh"    755

# Настройка nginx. Новую кладём, проверяем и, если она не прошла проверку,
# возвращаем прежнюю. Иначе сломанный файл остался бы лежать на месте: сам
# по себе он ничего не уронит, но при следующем перезапуске nginx просто
# не поднимется — и причина будет уже забыта.
NGINX_LIVE=/etc/nginx/sites-available/pravofin

# Настройку, которую доработал certbot, не трогаем.
#
# Certbot дописывает в неё прослушивание 443-го порта, пути к сертификату
# и перенаправление с http на https. Если после этого положить сверху
# исходный файл из репозитория — а установщик делает это каждые пять
# минут, — HTTPS отвалится молча и починится только следующим выпуском
# сертификата. То есть сайт станет незащищённым, и никто не заметит.
#
# Поэтому: появился сертификат — файл считается чужим. Менять его дальше
# нужно осознанно, а не мимоходом.
if grep -q 'managed by Certbot\|ssl_certificate' "$NGINX_LIVE" 2>/dev/null; then
  : # настройка под сертификатом, оставляем как есть
elif [ ! -f "$NGINX_LIVE" ] || ! cmp -s "$HERE/nginx.conf" "$NGINX_LIVE"; then
  NGINX_OLD=""
  if [ -f "$NGINX_LIVE" ]; then
    NGINX_OLD=$(mktemp)
    cp "$NGINX_LIVE" "$NGINX_OLD"
  fi

  install -m 644 "$HERE/nginx.conf" "$NGINX_LIVE"
  ln -sf "$NGINX_LIVE" /etc/nginx/sites-enabled/pravofin
  rm -f /etc/nginx/sites-enabled/default

  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx 2>/dev/null || systemctl restart nginx
    log "nginx обновлён"
    [ -n "$NGINX_OLD" ] && rm -f "$NGINX_OLD"
  else
    log "НАСТРОЙКА NGINX НЕ ПРОШЛА ПРОВЕРКУ:"
    nginx -t 2>&1 | sed 's/^/       /'
    if [ -n "$NGINX_OLD" ]; then
      cp "$NGINX_OLD" "$NGINX_LIVE"
      rm -f "$NGINX_OLD"
      log "вернул прежнюю настройку nginx"
    else
      rm -f /etc/nginx/sites-enabled/pravofin
      log "убрал сломанную настройку из включённых"
    fi
  fi
fi

# ---------- 9. Запуск ----------

systemctl daemon-reload

if ! systemctl is-enabled pravofin >/dev/null 2>&1; then
  systemctl enable pravofin >/dev/null 2>&1
  mark
fi

if [ -n "$CHANGED" ] || ! systemctl is-active pravofin >/dev/null 2>&1; then
  # Перед перезапуском проверяем, что код хотя бы разбирается: сломанный
  # синтаксис не должен уронить работающий сервис.
  if node --check "$REPO/worker/node/server.mjs" >/dev/null 2>&1; then
    systemctl restart pravofin
    log "служба перезапущена"
  else
    log "новый код не разбирается — оставляю работать прежний"
  fi
fi

# ---------- 10. Firewall ----------

if ! ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 22/tcp  >/dev/null 2>&1
  ufw allow 80/tcp  >/dev/null 2>&1
  ufw allow 443/tcp >/dev/null 2>&1
  ufw --force enable >/dev/null 2>&1
  log "firewall включён"
fi

# ---------- 11. Домен ----------

"$DIR/check-domain.sh" || true

# ---------- Перенос данных со старой базы ----------
#
# В репозитории лежит зашифрованная выгрузка с Cloudflare. Расшифровать её
# может только эта машина: ключ — RECOVERY_SECRET из её же настроек, и он
# нигде больше не встречается. В репозитории только нечитаемые байты.
#
# Переносим один раз: метка IMPORT-DATA меняется вместе с выгрузкой,
# и по ней видно, была ли эта уже применена.

ENC=$REPO/worker/node/import.sql.enc
STAMP=$REPO/worker/node/IMPORT-DATA
DONE=$DIR/import.done

if [ -f "$ENC" ] && [ -f "$STAMP" ] && [ "$(cat "$STAMP")" != "$(cat "$DONE" 2>/dev/null)" ]; then
  log "есть перенос данных, применяю"
  KEY=$(grep -m1 '^RECOVERY_SECRET=' "$DIR/env" | cut -d= -f2-)
  if [ -z "$KEY" ]; then
    log "в настройках нет RECOVERY_SECRET — расшифровать нечем"
  else
    TMP=$(mktemp)
    if PASS="$KEY" openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000          -pass env:PASS -in "$ENC" -out "$TMP" 2>/dev/null; then
      # Останавливаем службу: писать в базу, пока её держит сервер,
      # можно, но рисковать целостностью данных ради двадцати секунд
      # простоя незачем.
      systemctl stop pravofin 2>/dev/null
      cp "$DIR/data/pravofin.db" "$DIR/backups/before-import-$(date +%Y%m%d-%H%M).db" 2>/dev/null
      # Через конвейер код возврата теряется — sqlite3 может ругаться,
      # а видно будет успех sed. Поэтому пишем в файл и смотрим сами.
      # Ключ -bail останавливает на первой ошибке: половина перенесённых
      # данных хуже, чем ни одной, — по ней не понять, что уцелело.
      ERRLOG=$(mktemp)
      if sqlite3 -bail "$DIR/data/pravofin.db" < "$TMP" > "$ERRLOG" 2>&1; then
        log "данные перенесены"
      else
        log "ПЕРЕНОС НЕ УДАЛСЯ, база не тронута. Что сказал sqlite:"
        head -10 "$ERRLOG" | sed 's/^/       /'
      fi
      rm -f "$ERRLOG"
      chown pravofin:pravofin "$DIR/data/pravofin.db" 2>/dev/null
      systemctl start pravofin 2>/dev/null
      cp "$STAMP" "$DONE"
    else
      log "расшифровать выгрузку не удалось — ключ не подошёл"
    fi
    rm -f "$TMP"
  fi
fi

# ---------- Проверки по требованию ----------
#
# Сюитам нужен и сервер, и файл базы, поэтому запускать их можно только
# здесь. А зайти на машину нельзя — значит просить её об этом приходится
# через репозиторий: изменился файл RUN-TESTS, значит просят прогнать.
#
# Результат ложится на сайт отдельным файлом: это единственный канал,
# по которому с машины можно что-то прочитать.

MARK=$DIR/tests.done
WANT=$(cat "$REPO/worker/node/RUN-TESTS" 2>/dev/null)
if [ -n "$WANT" ] && [ "$WANT" != "$(cat "$MARK" 2>/dev/null)" ]; then
  log "просят прогнать проверки — запускаю, это займёт несколько минут"
  bash "$HERE/run-tests.sh" || log "проверки завершились с ошибкой"
  printf '%s
' "$WANT" > "$MARK"
  log "проверки закончены, результат в /tests-8f3a2c.txt"
fi

# ---------- Итог ----------

# Временная страница диагностики.
#
# Зайти на машину нельзя: yc compute ssh отказывает, OS Login не работает.
# Значит единственный способ что-то с неё узнать — попросить её саму
# выложить это на сайт. Файл не в git, поэтому обновление кода его не
# трогает; секретов в нём нет.
#
# Нужна ровно для одного вопроса: доходят ли до машины входящие соединения
# снаружи. Если в журнале обращений видны чужие адреса — трафик доходит и
# режется на обратном пути; если пусто — не доходит вовсе.
#
# УДАЛИТЬ, как только вопрос закроется.
DIAG="$REPO/diag-8f3a2c.txt"
{
  echo "время:        $(date -Is)"
  echo "аптайм:       $(uptime -p 2>/dev/null)"
  echo
  echo "--- кто слушает порты ---"
  ss -ltn 2>/dev/null | head -12
  echo
  echo "--- firewall ---"
  ufw status 2>/dev/null | head -10 || echo "ufw не установлен"
  echo
  echo "--- адреса машины ---"
  ip -4 addr show 2>/dev/null | grep -E 'inet ' | sed 's/^ *//'
  echo
  echo "--- сколько записей в базе ---"
  for t in users payments usage actions point_ops; do
    printf "  %-10s %s
" "$t" "$(sqlite3 "$DIR/data/pravofin.db" "SELECT COUNT(*) FROM $t" 2>&1)"
  done
  echo
  echo "--- кто есть в базе ---"
  # Почты показываем обрезанными: файл лежит на сайте и виден всем.
  sqlite3 "$DIR/data/pravofin.db"     "SELECT substr(email,1,3) || '***' || substr(email, instr(email,'@')), role, plan, length(pass_hash) FROM users"     2>&1 | sed 's/^/  /'
  echo
  echo "--- совпадает ли владелец с настройками ---"
  OWN=$(grep -m1 '^OWNER_EMAILS=' "$DIR/env" | cut -d= -f2- | cut -d, -f1 | tr -d '[:space:]')
  echo "  в настройках: $(printf '%s' "$OWN" | cut -c1-3)***$(printf '%s' "$OWN" | sed 's/.*@/@/')"
  echo "  таких строк в базе: $(sqlite3 "$DIR/data/pravofin.db" "SELECT COUNT(*) FROM users WHERE email = '$OWN'" 2>&1)"
  echo
  echo "--- что говорила установка (последние строки) ---"
  tail -40 /var/log/pravofin-setup.log 2>/dev/null | sed 's/^/  /' || echo "  журнала нет"
  echo
  echo "--- настройка nginx на диске ---"
  grep -nE 'listen|server_name|return 30|ssl_certificate |root '     /etc/nginx/sites-available/pravofin 2>/dev/null | sed 's/^/  /'
  echo "  включённые сайты: $(ls -1 /etc/nginx/sites-enabled/ 2>/dev/null | tr '
' ' ')"
  echo

  echo "--- состояние переноса ---"
  echo "  метка в репозитории: $(cat "$REPO/worker/node/IMPORT-DATA" 2>/dev/null || echo нет)"
  echo "  метка применённого:  $(cat "$DIR/import.done" 2>/dev/null || echo нет)"
  echo "  файл выгрузки:       $(wc -c < "$REPO/worker/node/import.sql.enc" 2>/dev/null || echo нет) байт"
} > "$DIAG" 2>&1
chmod 644 "$DIAG"

sleep 2
if curl -fsS -m 10 http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
  log "ГОТОВО: сервис отвечает"
else
  log "сервис пока не отвечает. Последние строки журнала:"
  journalctl -u pravofin -n 20 --no-pager 2>&1 | sed 's/^/       /'
fi
