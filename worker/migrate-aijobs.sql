-- Фоновые задачи ИИ.
-- Запускается один раз; повторный запуск безвреден.
--
-- Зачем: раньше ответ ИИ жил только в открытой вкладке. Перешёл на другую
-- страницу — запрос оборвался, а вопрос пропал, потому что в историю он
-- записывался только вместе с ответом. Теперь вопрос сразу становится
-- задачей на сервере: страница может закрыться, ответ всё равно дождётся.

CREATE TABLE IF NOT EXISTS ai_jobs (
  id         TEXT PRIMARY KEY,                  -- случайный, отдаётся браузеру
  email      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'chat',      -- chat | tool
  prompt     TEXT NOT NULL,                     -- что спросил человек (без контекста)
  status     TEXT NOT NULL DEFAULT 'pending',   -- pending | done | error
  answer     TEXT,
  error      TEXT,
  created_at INTEGER NOT NULL,
  done_at    INTEGER
);

-- Ищем незавершённые задачи человека при открытии любой страницы.
CREATE INDEX IF NOT EXISTS idx_ai_jobs_email ON ai_jobs (email, created_at DESC);
