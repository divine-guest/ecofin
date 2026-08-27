#!/bin/bash
# Выпуск сертификата. Обычно вызывается сам из check-domain.sh, но можно
# и руками:  sudo /opt/pravofin/enable-tls.sh пример.ru
set -e
DOMAIN="$1"
[ -z "$DOMAIN" ] && { echo "укажите домен: enable-tls.sh пример.ru"; exit 1; }
sed -i "s/server_name _;/server_name $DOMAIN;/" /etc/nginx/sites-available/pravofin
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
systemctl reload nginx
echo "HTTPS включён для $DOMAIN, продление сертификата настроится само"
