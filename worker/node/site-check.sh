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
  res=$(curl -sS -m 20 -o /dev/null -w '%{http_code} %{remote_ip} %{time_total}' "$@" 2> "$err")
  printf '%s | %s' "$res" "$(head -c 200 "$err" | tr '\r\n' '  ')"
  rm -f "$err"
}

BY_NAME=$(fetch "https://$DOMAIN/")
BY_IP=$(fetch --resolve "$DOMAIN:443:$IP" "https://$DOMAIN/")
API=$(fetch "https://$DOMAIN/api/health")
CTRL=$(fetch "https://ya.ru/")
note ""
note "по имени:          $BY_NAME"
note "в обход имени:     $BY_IP"
note "служба сайта:      $API"
note "для сравнения ya.ru: $CTRL"

CODE_NAME=${BY_NAME%% *}
CODE_IP=${BY_IP%% *}
CODE_CTRL=${CTRL%% *}

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
  else
    say "Значит, дело в браузере: он помнит старый адрес или старую ошибку."
    say "Откройте сайт в окне инкогнито: Ctrl+Shift+N, затем https://$DOMAIN"
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
echo "Подробности записаны в файл «проверка-сайта.txt» в папке ecofin."
echo "Включите VPN и напишите в чат: проверил."
