#!/bin/bash
# Выпуск сертификата. Обычно вызывается сам из check-domain.sh, но можно
# и руками:  sudo /opt/pravofin/enable-tls.sh пример.ru
set -e
DOMAIN="$1"
[ -z "$DOMAIN" ] && { echo "укажите домен: enable-tls.sh пример.ru"; exit 1; }
sed -i "s/server_name _;/server_name $DOMAIN www.$DOMAIN;/" /etc/nginx/sites-available/pravofin
nginx -t && systemctl reload nginx

# Сертификат просим сразу на два имени: голое и с www. Запись www заводят
# почти всегда, а без сертификата на неё браузер показывает страшное
# предупреждение о подделке — хуже, чем если бы сайт просто не открылся.
#
# Если www ещё не показывает на нас, certbot откажет ЦЕЛИКОМ, вместе с
# основным именем, и сайт останется без https вовсе. Поэтому при неудаче
# откатываемся на одно имя: лучше https без www, чем никакого.
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
     --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
  echo "HTTPS включён для $DOMAIN и www.$DOMAIN"
else
  echo "с www не вышло — пробую только $DOMAIN"
  sed -i "s/server_name $DOMAIN www.$DOMAIN;/server_name $DOMAIN;/" /etc/nginx/sites-available/pravofin
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  echo "HTTPS включён для $DOMAIN (без www: добавьте запись www и запустите ещё раз)"
fi
systemctl reload nginx
echo "продление сертификата настроится само"
