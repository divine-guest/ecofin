-- Сохранённые расчёты в кабинете.
-- Запускается один раз; повторный запуск безвреден.
--
-- Зачем: человек считает налоговую нагрузку, закрывает вкладку — и всё
-- пропадает. Через месяц он считает то же самое заново. Сохранённый
-- расчёт возвращает его в кабинет и делает калькулятор частью сервиса,
-- а не разовым виджетом.

CREATE TABLE IF NOT EXISTS saved_calcs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  kind       TEXT NOT NULL,        -- какой калькулятор
  title      TEXT NOT NULL,        -- как назвал человек
  inputs     TEXT NOT NULL,        -- что вводил, json
  summary    TEXT NOT NULL,        -- главный итог одной строкой
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saved_email ON saved_calcs (email, created_at DESC);
