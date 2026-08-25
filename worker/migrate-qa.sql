-- Публичная лента вопросов и ответов.
-- Запускается один раз; повторный запуск безвреден.
--
-- Зачем: каждый ответ консультанта сейчас виден одному человеку и
-- исчезает. Опубликованный — работает дальше: отвечает следующему, кто
-- искал то же самое, и приводит людей из поиска. Контент растёт сам,
-- без участия владельца.
--
-- Публикация только по согласию автора и только после проверки: в
-- вопросы люди вставляют суммы, имена и реквизиты. Имя автора не
-- хранится и не показывается вовсе.

CREATE TABLE IF NOT EXISTS public_qa (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,        -- кто предложил; наружу не отдаётся
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  topic       TEXT NOT NULL DEFAULT 'Общее',
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | published | rejected
  useful      INTEGER NOT NULL DEFAULT 0,       -- сколько раз отметили «помогло»
  views       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER,
  decided_by  TEXT
);

CREATE INDEX IF NOT EXISTS idx_qa_status ON public_qa (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_author ON public_qa (email, created_at DESC);

-- Кто какой ответ уже отметил полезным: иначе счётчик накручивается
-- обновлением страницы.
CREATE TABLE IF NOT EXISTS qa_useful (
  qa_id  INTEGER NOT NULL,
  email  TEXT NOT NULL,
  at     INTEGER NOT NULL,
  PRIMARY KEY (qa_id, email)
);
