-- Напоминания, уведомления и привязка Telegram.
-- Запускается один раз; повторный запуск вернёт «duplicate column» — это нормально.

ALTER TABLE users ADD COLUMN tg_chat_id TEXT;
ALTER TABLE users ADD COLUMN tg_username TEXT;
ALTER TABLE users ADD COLUMN tg_linked_at INTEGER;
-- Часовой пояс нужен, чтобы «за 3 дня до срока» считалось по времени человека,
-- а не по UTC: во Владивостоке это разные сутки.
ALTER TABLE users ADD COLUMN tz_offset INTEGER NOT NULL DEFAULT 3;

CREATE TABLE IF NOT EXISTS reminders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  title       TEXT NOT NULL,
  due         TEXT NOT NULL,                       -- 'YYYY-MM-DD'
  repeat_rule TEXT NOT NULL DEFAULT 'once',        -- once | monthly | quarterly | yearly
  notify_days TEXT NOT NULL DEFAULT '3,1,0',       -- за сколько дней предупреждать
  channel     TEXT NOT NULL DEFAULT 'site',        -- site | telegram | both
  note        TEXT,
  source      TEXT NOT NULL DEFAULT 'user',        -- user | calendar (налоговый календарь)
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_email ON reminders(email, due);
CREATE INDEX IF NOT EXISTS idx_reminders_due   ON reminders(due) WHERE active = 1;

-- Что уже отправлено. Отдельная таблица, а не поле в reminders: у одного
-- напоминания несколько отправок (за 3 дня, за 1 день, в день срока),
-- и повторяющееся напоминание проходит этот круг каждый период.
CREATE TABLE IF NOT EXISTS reminder_sent (
  reminder_id INTEGER NOT NULL,
  due         TEXT NOT NULL,
  offset_days INTEGER NOT NULL,
  sent_at     INTEGER NOT NULL,
  PRIMARY KEY (reminder_id, due, offset_days)
);

-- Лента уведомлений в кабинете. Живёт независимо от Telegram: человек
-- может не подключать бота и всё равно всё видеть на сайте.
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  kind       TEXT NOT NULL DEFAULT 'reminder',     -- reminder | billing | system
  link       TEXT,
  created_at INTEGER NOT NULL,
  read_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notif_email ON notifications(email, created_at DESC);

-- Одноразовые коды привязки Telegram: человек нажимает кнопку в кабинете,
-- получает код и отправляет его боту. Код живёт 15 минут.
CREATE TABLE IF NOT EXISTS tg_link_codes (
  code       TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
