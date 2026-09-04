#!/bin/bash
# Выпуск сертификата и настройка имён сайта.
#
#   enable-tls.sh основной.ru [зеркало1.ru зеркало2.ru ...]
#
# Первый домен — основной, на нём живёт сайт. Остальные переадресуются
# на него насовсем (301): у сайта должен быть один адрес, иначе поисковик
# видит два одинаковых сайта и делит вес между ними, а люди пересылают
# друг другу разные ссылки на одно и то же.
#
# Обычно вызывается сам из check-domain.sh, но можно и руками.
set -uo pipefail

MAIN="${1:-}"
[ -z "$MAIN" ] && { echo "укажите домен: enable-tls.sh пример.ru [зеркало.ru]"; exit 1; }
shift
ALIASES="$*"

SITE=/etc/nginx/sites-available/pravofin
REDIR=/etc/nginx/sites-available/pravofin-redirect

MY_IP=$(curl -s --max-time 5 https://api.ipify.org || true)
[ -z "$MY_IP" ] && { echo "не удалось узнать свой адрес — выхожу"; exit 1; }

# Имя годится для сертификата, только если оно уже показывает на нас.
#
# Проверять обязательно: certbot отказывает ЦЕЛИКОМ, если хоть одно имя
# из списка не подтвердилось. Один неверно настроенный псевдоним оставил
# бы без https основной домен — то есть весь сайт.
points_here() {
  local ip
  ip=$(getent hosts "$1" 2>/dev/null | awk '{print $1}' | head -1)
  [ -n "$ip" ] && [ "$ip" = "$MY_IP" ]
}

# --- Основной домен ------------------------------------------------------
NAMES="$MAIN"
SERVER_NAMES="$MAIN"
if points_here "www.$MAIN"; then
  NAMES="$NAMES www.$MAIN"
  SERVER_NAMES="$SERVER_NAMES www.$MAIN"
else
  echo "www.$MAIN пока не показывает на нас — беру только $MAIN"
fi

# server_name правим и из состояния «_», и из прежнего имени: скрипт
# должны переживать повторные запуски и смену домена.
sed -i -E "s/^(\s*)server_name .*;/\1server_name $SERVER_NAMES;/" "$SITE"

# --- Зеркала -------------------------------------------------------------
REDIR_NAMES=""
for a in $ALIASES; do
  for n in "$a" "www.$a"; do
    if points_here "$n"; then
      REDIR_NAMES="$REDIR_NAMES $n"
    else
      echo "$n не показывает на нас — пропускаю"
    fi
  done
done
REDIR_NAMES=$(echo "$REDIR_NAMES" | xargs || true)

if [ -n "$REDIR_NAMES" ]; then
  # $request_uri экранирован: это переменная nginx, а не оболочки. Без
  # экранирования сюда подставилась бы пустота, и все ссылки с зеркала
  # вели бы на главную вместо нужной страницы.
  cat > "$REDIR" <<EOF
# Зеркала: переадресация на основной домен. Файл создаётся скриптом
# enable-tls.sh, править руками нет смысла — перезапишется.
server {
  listen 80;
  listen [::]:80;
  server_name $REDIR_NAMES;
  return 301 https://$MAIN\$request_uri;
}
EOF
  ln -sf "$REDIR" /etc/nginx/sites-enabled/pravofin-redirect
  NAMES="$NAMES $REDIR_NAMES"
  echo "зеркала: $REDIR_NAMES"
else
  # Ни одно зеркало не настроено — убираем прежний файл, если он был:
  # иначе nginx будет держать server_name на имя, которого нет.
  rm -f /etc/nginx/sites-enabled/pravofin-redirect
fi

nginx -t && systemctl reload nginx

# --- Сертификат ----------------------------------------------------------
CERT_ARGS=""
for n in $NAMES; do CERT_ARGS="$CERT_ARGS -d $n"; done

echo "прошу сертификат на: $NAMES"
# --cert-name обязателен. Без него certbot при каждом расхождении списка
# имён заводит НОВЫЙ сертификат с приставкой -0001, -0002 и так далее.
# Так на сервере уже завёлся лишний «ecofin26.ru-0001» всего на одно имя.
# Опасность не в лишнем файле: certbot однажды подставит в настройку
# именно его, а он покрывает только основной домен — и зеркало отвалится
# с предупреждением о подделке.
if certbot --nginx --cert-name "$MAIN" $CERT_ARGS \
     --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
  echo "HTTPS включён для: $NAMES"
else
  # Последний рубеж: если совместная попытка не удалась, берём хотя бы
  # основной домен. Лучше сайт без зеркал, чем предупреждение о подделке
  # на главном адресе.
  echo "совместная попытка не удалась — беру только $MAIN"
  certbot --nginx --cert-name "$MAIN" -d "$MAIN" \
    --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    && echo "HTTPS включён для $MAIN"
fi

# Все переадресации ведём на нынешний основной домен.
#
# После смены имени в настройке остаются строки со старым адресом: их
# оставляет certbot, и они срабатывают, когда человек приходит по старой
# ссылке — из закладки, из истории, из давнего сообщения бота. Отправлять
# его на имя, для которого сертификата больше нет, — значит показать во
# весь экран предупреждение о поддельном сайте вместо сайта.
#
# Правим только цель переадресации, условие «если пришли по такому-то
# имени» не трогаем: оно и должно ловить старые адреса.
for f in "$SITE" "$REDIR"; do
  [ -f "$f" ] || continue
  # $request_uri пишем через класс [$]: при обычном экранировании
  # оболочка успевала подставить сюда свою пустую переменную, и
  # выражение превращалось в мусор, который молча ничего не находил.
  sed -i -E "s#return 301 https://[^\$]+[\$]request_uri;#return 301 https://$MAIN\$request_uri;#g" "$f"
done

if nginx -t; then
  systemctl reload nginx
else
  echo "настройка не прошла проверку — оставляю как было"
fi
echo "продление сертификата настроится само"
