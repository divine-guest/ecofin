#!/bin/bash
# Читает домен из репозитория и, когда тот начнёт показывать на нас,
# выпускает сертификат. Пока домена нет или он показывает не сюда —
# тихо ничего не делает и пробует снова через пять минут.
set -e
FILE=/opt/pravofin/repo/worker/node/domain.txt
[ -f "$FILE" ] || exit 0
DOMAIN=$(grep -vE '^\s*(#|$)' "$FILE" | head -1 | tr -d '[:space:]')
[ -z "$DOMAIN" ] && exit 0

# Уже выпущен — выходим: certbot сам продлевает по расписанию.
[ -d "/etc/letsencrypt/live/$DOMAIN" ] && exit 0

MY_IP=$(curl -s --max-time 5 https://api.ipify.org || true)
DOMAIN_IP=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
if [ -z "$DOMAIN_IP" ] || [ "$MY_IP" != "$DOMAIN_IP" ]; then
  echo "домен $DOMAIN пока показывает на '$DOMAIN_IP', а мы '$MY_IP' — жду"
  exit 0
fi

echo "домен $DOMAIN показывает на нас, выпускаю сертификат"
/opt/pravofin/enable-tls.sh "$DOMAIN"
