-- Коды для смены забытого пароля.
--
-- Хранится не сам код, а его хэш: таблицу видит всякий, кто получил
-- доступ к базе, и код оттуда не должен читаться так же, как не читается
-- пароль. Соль не нужна — в хэш входит адрес, а сам код живёт 15 минут.
--
-- Одна строка на адрес: новый запрос затирает прежний код. Иначе
-- человек, нажавший «прислать код» трижды, получал бы три рабочих кода,
-- и каждый из них — ещё одна дверь в аккаунт.
CREATE TABLE IF NOT EXISTS password_resets (
  email     TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires   INTEGER NOT NULL,   -- unix ms, после этого код мёртв
  tries     INTEGER NOT NULL DEFAULT 0,  -- неудачных вводов; пять и код сгорает
  created   INTEGER NOT NULL
);

-- Чистка просроченных идёт по сроку, а не по адресу.
CREATE INDEX IF NOT EXISTS idx_resets_expires ON password_resets(expires);
