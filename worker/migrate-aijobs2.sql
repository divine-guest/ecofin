-- Восстановление зависших задач ИИ.
-- Запускается один раз; повторный запуск вернёт «duplicate column» — это нормально.
--
-- Зачем: ctx.waitUntil() доделывает работу после ответа браузеру, но это не
-- гарантия. Если исполнение оборвалось, задача оставалась в статусе pending
-- навсегда: ни ответа, ни ошибки — человек ждёт вечно.
--
-- Теперь задача хранит всё нужное для повторного запуска, а опрос со стороны
-- браузера подхватывает её, если прошлая попытка не отчиталась вовремя.

ALTER TABLE ai_jobs ADD COLUMN context TEXT;       -- что уходит модели (с историей)
ALTER TABLE ai_jobs ADD COLUMN system TEXT;        -- системная подсказка
ALTER TABLE ai_jobs ADD COLUMN max_tokens INTEGER; -- длина ответа
ALTER TABLE ai_jobs ADD COLUMN claimed_at INTEGER; -- когда началась текущая попытка
ALTER TABLE ai_jobs ADD COLUMN tries INTEGER NOT NULL DEFAULT 0;
