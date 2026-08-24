-- Бонусные баллы. Запускается один раз.
ALTER TABLE users ADD COLUMN points INTEGER NOT NULL DEFAULT 0;

-- Журнал операций: и аудит, и защита от повторного начисления через ref.
CREATE TABLE IF NOT EXISTS point_ops (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  email  TEXT NOT NULL,
  delta  INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref    TEXT UNIQUE,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_point_ops_email ON point_ops(email, at DESC);
