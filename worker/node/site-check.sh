#!/bin/bash
# ============ Открывается ли сайт с компьютера владельца ============
#
#   bash site-check.sh [домен] [адрес сервера]
#
# Зачем. Снаружи сайт проверяют посторонние сервисы, и по ним он может
# работать во всём мире — а у владельца в браузере не открываться. Из
# чата это не разобрать: компьютер владельца выходит через VPN, с
# которого сервер не виден вовсе, а при выключенном VPN нет связи с
# помощником. Поэтому проверку делает сам компьютер, по шагам, и пишет
# вывод простыми словами.
#
# Что проверяется, по порядку от сети к браузеру:
#   • через какую страну компьютер выходит в интернет — выключен ли VPN;
#   • во что превращается имя сайта (адрес в памяти компьютера);
#   • доходит ли соединение до сервера: порты 443, 80 и 22;
#   • открывается ли сайт по имени и в обход имени;
#   • включён ли в Windows прокси — браузер ходит через него, а эта
#     проверка нет, и тогда «здесь открывается, в браузере нет».
#
# Подробности ложатся в файл «проверка-сайта.txt» рядом с проектом:
# секретов в нём нет, его можно показать в чате.
#
# Переменные не называются LINES и COLUMNS: это служебные имена bash,
# и в окне консоли он сам их переписывает (см. vps-secret.sh).

set -uo pipefail

DOMAIN="${1:-ecofin26.ru}"
IP="${2:-80.78.246.6}"
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
OUT="$ROOT/проверка-сайта.txt"

: > "$OUT"
note() { printf '%s\n' "$*" >> "$OUT"; }
say()  { printf '%s\n' "$*"; note "$*"; }

note "Проверка сайта $DOMAIN, $(date '+%d.%m.%Y %H:%M:%S')"
note ""

# ---------- 1. Через какую страну выходим ----------

country() {
  local c
  c=$(curl -s -m 8 https://ipinfo.io/country 2>/dev/null | tr -d '[:space:]')
  [[ "$c" =~ ^[A-Z]{2}$ ]] || c=$(curl -s -m 8 https://ifconfig.co/country-iso 2>/dev/null | tr -d '[:space:]')
  [[ "$c" =~ ^[A-Z]{2}$ ]] && printf '%s' "$c"
}

WHERE=$(country)
if [ -z "${SITE_CHECK_NOWAIT:-}" ] && [ -n "$WHERE" ] && [ "$WHERE" != "RU" ]; then
  echo
  echo "Сейчас компьютер выходит в интернет через страну: $WHERE — VPN включён."
  echo
  echo "    ВЫКЛЮЧИТЕ VPN. Как только он выключится, я продолжу сам."
  echo "    (Если VPN уже выключен — нажмите Enter, проверю как есть.)"
  echo
  until [ "$WHERE" = "RU" ]; do
    if read -r -t 4 _; then break; fi
    printf '.'
    WHERE=$(country)
  done
  echo
fi
ME=$(curl -s -m 8 https://ipinfo.io/org 2>/dev/null | head -c 80)
say "Выход в интернет: страна ${WHERE:-не определилась}, провайдер: ${ME:-не определился}"

# ---------- 2. Во что превращается имя ----------

# Спрашиваем у самой Windows — тем же путём, каким спрашивает браузер.
# nslookup для этого хуже: он первым печатает адрес сервера имён, и при
# неудаче этот адрес легко принять за ответ.
SEEN=$(powershell -NoProfile -Command "(Resolve-DnsName '$DOMAIN' -Type A -ErrorAction SilentlyContinue | Where-Object { \$_.IPAddress } | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r[:space:]')
[[ "$SEEN" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || SEEN=""
if [ "$SEEN" = "$IP" ]; then
  say "Имя $DOMAIN → $SEEN — верно."
else
  say "Имя $DOMAIN → ${SEEN:-не определилось} — а должно быть $IP."
fi

# ---------- 3. Доходит ли соединение ----------

port() { timeout 7 bash -c "exec 3<>/dev/tcp/$IP/$1" 2>/dev/null && echo "открыт" || echo "НЕ ОТВЕЧАЕТ"; }
P443=$(port 443); P80=$(port 80); P22=$(port 22)
say "Сервер $IP: порт 443 (сайт) — $P443, порт 80 — $P80, порт 22 — $P22."

# ---------- 4. Открывается ли сайт ----------

fetch() {   # остальное — аргументы curl; печатает «код адрес секунды» и причину
  local res err
  err=$(mktemp)
  res=$(curl -sS -m 15 -o /dev/null -w '%{http_code} %{remote_ip} %{time_total}' "$@" 2> "$err")
  # Из сообщения берём только латиницу и цифры: русский текст Windows
  # приходит в её собственной кодировке и в файле превращается в кашу.
  printf '%s | %s' "$res" "$(head -c 300 "$err" | tr -cd 'A-Za-z0-9_:(). -' | cut -c1-140)"
  rm -f "$err"
}

# Проверку отзыва сертификата отключаем, как это делают браузеры.
#
# curl в Windows по умолчанию перед каждым соединением спрашивает у
# удостоверяющего центра, не отозван ли сертификат, и без ответа не
# соединяется вовсе. У части российских провайдеров этот запрос не
# проходит (CRYPT_E_REVOCATION_OFFLINE) — и первая версия проверки
# объявляла «сайт отвечает не так», хотя Chrome, Edge и Firefox такой
# запрос не делают и сайт открывают. Строгий вариант оставлен отдельной
# строкой — для сведения, на вывод он не влияет.
BY_NAME=$(fetch --ssl-no-revoke "https://$DOMAIN/")
BY_IP=$(fetch --ssl-no-revoke --resolve "$DOMAIN:443:$IP" "https://$DOMAIN/")
API=$(fetch --ssl-no-revoke "https://$DOMAIN/api/health")
STRICT=$(fetch "https://$DOMAIN/")
CTRL=$(fetch --ssl-no-revoke "https://ya.ru/")
note ""
note "по имени:            $BY_NAME"
note "в обход имени:       $BY_IP"
note "служба сайта:        $API"
note "с проверкой отзыва:  $STRICT"
note "для сравнения ya.ru: $CTRL"

CODE_NAME=${BY_NAME%% *}
CODE_IP=${BY_IP%% *}
CODE_CTRL=${CTRL%% *}

# ---------- Чистый браузер ----------
#
# Edge есть на каждой Windows. Запускаем его без окна и с пустым
# профилем: ни расширений, ни памяти, ни прежних ошибок. Открыл — значит
# сеть и сайт в порядке, а мешает что-то в обычном браузере владельца.
EDGE=""
for p in "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
         "/c/Program Files/Microsoft/Edge/Application/msedge.exe"; do
  [ -x "$p" ] && { EDGE="$p"; break; }
done
CLEAN="нет Edge"
if [ -n "$EDGE" ]; then
  PROF="$(cygpath -w "${TMP:-/tmp}")\\ecofin-edge-check"
  DOM=$(timeout 45 "$EDGE" --headless=new --disable-gpu --no-first-run \
          "--user-data-dir=$PROF" --virtual-time-budget=9000 --dump-dom "https://$DOMAIN/" 2>/dev/null)
  # Узнаём свою страницу по ссылке на саму себя: латиница, кодировка
  # вывода на неё не влияет.
  if printf '%s' "$DOM" | grep -q "rel=\"canonical\" href=\"https://$DOMAIN/\""; then
    CLEAN="открыл"
  else
    CLEAN="НЕ ОТКРЫЛ (получено символов: ${#DOM})"
  fi
  rm -rf "$(cygpath -u "$PROF")" 2>/dev/null
fi
note "чистый браузер Edge: $CLEAN"

MINE=$(reg query 'HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' //v ProgId 2>/dev/null | tr -d '\r' | awk '/ProgId/ {print $NF}')
case "$MINE" in
  ChromeHTML*)  MINE_NAME="Chrome" ;;
  MSEdgeHTM*)   MINE_NAME="Edge" ;;
  Yandex*)      MINE_NAME="Яндекс Браузер" ;;
  Firefox*)     MINE_NAME="Firefox" ;;
  Opera*)       MINE_NAME="Opera" ;;
  *)            MINE_NAME="ваш браузер" ;;
esac
note "браузер по умолчанию: ${MINE:-не определился}"

# ---------- 5. Прокси в Windows ----------

REGKEY='HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
PROXY_ON=$(reg query "$REGKEY" //v ProxyEnable 2>/dev/null | tr -d '\r' | grep -oE '0x[0-9a-f]+' | tail -1)
PROXY_TO=$(reg query "$REGKEY" //v ProxyServer 2>/dev/null | tr -d '\r' | awk '/ProxyServer/ {print $NF}')
PROXY_PAC=$(reg query "$REGKEY" //v AutoConfigURL 2>/dev/null | tr -d '\r' | awk '/AutoConfigURL/ {print $NF}')
note ""
note "прокси Windows: включён=${PROXY_ON:-нет данных} адрес=${PROXY_TO:-нет} автонастройка=${PROXY_PAC:-нет}"

# ---------- Вывод ----------

echo
echo "=============================================================="
if [ "$CODE_NAME" = "200" ]; then
  say "ВЫВОД: с этого компьютера сайт ОТКРЫВАЕТСЯ (ответ 200)."
  if [ "${PROXY_ON:-0x0}" = "0x1" ] || [ -n "$PROXY_PAC" ]; then
    say "Но в Windows включён прокси (${PROXY_TO:-$PROXY_PAC}). Браузер ходит через"
    say "него, а не напрямую — скорее всего, это остаток VPN, и мешает он."
  elif [ "$CLEAN" = "открыл" ]; then
    say "Чистый браузер без расширений и без памяти его тоже открыл."
    say "Значит, если $MINE_NAME сайт не открывает, мешает сам $MINE_NAME:"
    say "расширение (VPN, блокировщик рекламы) или то, что он запомнил раньше."
  else
    say "Но чистый браузер его не открыл ($CLEAN) — пришлите этот вывод в чат."
  fi
elif [ "$CODE_IP" = "200" ]; then
  say "ВЫВОД: сервер отвечает, но компьютер идёт не туда: имя сайта у него"
  say "ведёт на ${SEEN:-неизвестный адрес}, а не на $IP. Это старая запись в памяти,"
  say "она сменится сама; быстрее — перезагрузить компьютер и роутер."
elif [ "$P443" != "открыт" ] && [ "$P22" = "открыт" ]; then
  say "ВЫВОД: до сервера соединение доходит, но именно сайт (порт 443)"
  say "ваш провайдер не пропускает. Сервер исправен — мешает сеть по дороге."
elif [ "$P443" != "открыт" ] && [ "$CODE_CTRL" != "200" ] && [ "$CODE_CTRL" != "302" ] && [ "$CODE_CTRL" != "301" ]; then
  say "ВЫВОД: с этого компьютера сейчас не открывается вообще ничего —"
  say "даже ya.ru. Дело не в сайте, а в подключении к интернету."
elif [ "$P443" != "открыт" ]; then
  say "ВЫВОД: до сервера соединение не доходит совсем, хотя интернет есть."
  if [ "${WHERE:-}" != "RU" ]; then
    say "Компьютер выходит через страну ${WHERE:-?} — похоже, VPN всё ещё включён."
  else
    say "Мешает сеть между вами и сервером. Сервер исправен."
  fi
else
  say "ВЫВОД: соединение есть, но сайт ответил не так, как должен:"
  say "  $BY_NAME"
fi
echo "=============================================================="
echo

# Напоследок открываем сайт в обычном браузере владельца — пока VPN ещё
# выключен. Что он там увидит, и есть ответ на вопрос «открывается ли»;
# если ошибку — её текст скажет больше, чем все проверки выше.
if [ -z "${SITE_CHECK_NOWAIT:-}" ]; then
  echo "Сейчас сайт откроется в вашем браузере ($MINE_NAME)."
  echo "Если вместо сайта будет ошибка — сделайте снимок экрана с ней."
  cmd //c start "" "https://$DOMAIN/" >/dev/null 2>&1
  echo
fi

echo "Подробности записаны в файл «проверка-сайта.txt» в папке ecofin."
echo "Потом включите VPN и напишите в чат, что увидели."
