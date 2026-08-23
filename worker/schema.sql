-- ПравоФин — схема базы (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  pass_hash     TEXT NOT NULL,         -- PBKDF2-SHA256, формат: итерации:соль_b64:хэш_b64
  avatar        TEXT DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  plan          TEXT NOT NULL DEFAULT 'free',   -- 'free' | 'pro'
  pro_until     INTEGER,               -- unix ms; NULL = бессрочно (для админов)
  tool_uses     INTEGER NOT NULL DEFAULT 0,     -- израсходовано пробных запусков инструментов
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  referred_by   TEXT,                  -- email пригласившего, ставится один раз
  referral_paid INTEGER NOT NULL DEFAULT 0   -- награда за это приглашение уже выдана
);
CREATE INDEX IF NOT EXISTS idx_users_referred ON users(referred_by);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,         -- SHA-256 от выданного клиенту токена
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_email   ON sessions(email);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Счётчики расхода по дням: и для лимита ИИ, и для антифрода
CREATE TABLE IF NOT EXISTS usage (
  email TEXT NOT NULL,
  day   TEXT NOT NULL,                 -- 'YYYY-MM-DD' по МСК
  kind  TEXT NOT NULL,                 -- 'ai' | 'tool' | 'analyze'
  n     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email, day, kind)
);

CREATE TABLE IF NOT EXISTS payments (
  id           TEXT PRIMARY KEY,       -- id платежа у эквайера или 'manual-<ts>'
  email        TEXT NOT NULL,
  amount       INTEGER NOT NULL,       -- в рублях
  plan         TEXT NOT NULL,          -- 'month' | 'year'
  source       TEXT NOT NULL,          -- 'yookassa' | 'manual' | 'promo'
  status       TEXT NOT NULL,          -- 'pending' | 'succeeded' | 'canceled'
  granted_by   TEXT,                   -- email админа для source='manual'
  created_at   INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payments_email  ON payments(email);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Журнал действий: и для кабинета пользователя, и для аудита админских выдач
CREATE TABLE IF NOT EXISTS actions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  email   TEXT NOT NULL,
  text    TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_actions_email ON actions(email, at DESC);

-- Счётчики частоты запросов: защита от перебора пароля и массовой регистрации.
-- Хранятся в базе, а не в памяти: воркер работает во множестве изолятов.
CREATE TABLE IF NOT EXISTS ratelimit (
  bucket   TEXT PRIMARY KEY,   -- 'login:ip:1.2.3.4', 'login:key:user@mail'
  n        INTEGER NOT NULL,
  reset_at INTEGER NOT NULL    -- unix-секунды
);
CREATE INDEX IF NOT EXISTS idx_ratelimit_reset ON ratelimit(reset_at);
