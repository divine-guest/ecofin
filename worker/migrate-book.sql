-- ЭкоФин — «Моё дело»: учёт поступлений и трат по делу.
--
-- Зачем это в базе, а не в браузере.
--
-- Дневник трат (js в expenses.html) живёт в localStorage и синхронизируется
-- через общий механизм прогресса. Для личных расходов на еду этого хватает.
-- Здесь другое: это учёт выручки, из которого считается налог, и данные за
-- несколько лет. Их нельзя потерять при чистке браузера и надо видеть
-- с любого устройства — иначе человек не станет им пользоваться всерьёз,
-- а именно всерьёз он и нужен.

CREATE TABLE IF NOT EXISTS book_ops (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  day        TEXT NOT NULL,                     -- 'ГГГГ-ММ-ДД'
  kind       TEXT NOT NULL,                     -- 'income' | 'expense'
  -- Суммы в копейках целым числом. Дробные рубли в JavaScript копят
  -- ошибку округления, и годовой итог начинает расходиться с ручным
  -- подсчётом на рубль-другой. Для налоговой книги это недопустимо.
  amount     INTEGER NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  party      TEXT NOT NULL DEFAULT '',          -- контрагент
  note       TEXT NOT NULL DEFAULT '',
  -- От кого поступило. На НПД ставка зависит именно от этого: 4% с физлиц
  -- и 6% с юрлиц и ИП. Без этого поля налог самозанятому не посчитать.
  payer      TEXT NOT NULL DEFAULT 'company',   -- 'person' | 'company'
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_book_ops_email ON book_ops (email, day DESC);

-- Профиль дела. Держим прямо в users: он один на человека, и отдельная
-- таблица ради четырёх полей заставила бы каждый запрос делать соединение.
ALTER TABLE users ADD COLUMN biz_form    TEXT    DEFAULT '';   -- ip | ooo | self
ALTER TABLE users ADD COLUMN biz_regime  TEXT    DEFAULT '';   -- npd | usn6 | usn15 | psn | ausn | eshn | osno
ALTER TABLE users ADD COLUMN biz_workers INTEGER DEFAULT 0;
-- Потенциальный доход по патенту: его устанавливает регион, вывести
-- из выручки нельзя, поэтому спрашиваем один раз и запоминаем.
ALTER TABLE users ADD COLUMN biz_psn     INTEGER DEFAULT 0;
