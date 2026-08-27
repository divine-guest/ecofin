#!/bin/bash
# Почасовая копия базы.
#
# VACUUM INTO делает целостную копию на работающей базе, в отличие от
# обычного копирования файла: при копировании можно поймать середину
# записи и получить битый файл.
set -e
DIR=/opt/pravofin/backups
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M)
sqlite3 /opt/pravofin/data/pravofin.db "VACUUM INTO '$DIR/pravofin-$STAMP.db'"
gzip -f "$DIR/pravofin-$STAMP.db"
# Держим двое суток почасовых копий.
ls -1t "$DIR"/pravofin-*.db.gz | tail -n +49 | xargs -r rm --
