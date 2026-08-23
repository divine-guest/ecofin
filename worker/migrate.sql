-- Догоняющая миграция для базы, созданной до реферальной программы.
-- D1 не умеет ADD COLUMN IF NOT EXISTS, поэтому запускается отдельно
-- и один раз; повторный запуск вернёт ошибку «duplicate column» — это нормально.
ALTER TABLE users ADD COLUMN referred_by TEXT;
ALTER TABLE users ADD COLUMN referral_paid INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_referred ON users(referred_by);
