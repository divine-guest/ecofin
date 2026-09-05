-- Несколько своих организаций, а не одна.
--
-- Реквизиты сделали одним набором — ошибка проектирования, которую
-- заметил владелец. У человека бывает ИП и ООО одновременно. Фирму
-- закрывают и открывают новую. Реквизиты меняются: переезд, смена
-- банка, смена наименования.
--
-- С одним набором всё это упирается в тупик: прежние реквизиты надо
-- затирать руками, а если понадобится документ от старой фирмы —
-- восстанавливать по памяти.
--
-- Имя файла с двойкой намеренно: миграции применяются по алфавиту, и
-- «orgs» встал бы ПЕРЕД «requisites» — то есть попытался бы изменить
-- таблицу doc_numbers раньше, чем она создана. Такая ошибка не входит
-- в список безобидных, и сервер просто не поднялся бы.
--
-- Прежние колонки users.req_* НЕ удаляем: в них уже могут лежать
-- введённые реквизиты, и первая организация заводится из них сама.

CREATE TABLE IF NOT EXISTS my_orgs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',   -- как человек её называет: «ИП», «ООО Ромашка»
  name       TEXT NOT NULL DEFAULT '',
  inn        TEXT NOT NULL DEFAULT '',
  ogrn       TEXT NOT NULL DEFAULT '',
  kpp        TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  bank       TEXT NOT NULL DEFAULT '',
  bik        TEXT NOT NULL DEFAULT '',
  account    TEXT NOT NULL DEFAULT '',
  corr       TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  signer     TEXT NOT NULL DEFAULT '',
  post       TEXT NOT NULL DEFAULT '',
  archived   INTEGER NOT NULL DEFAULT 0, -- закрытая фирма: не предлагается, но остаётся
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orgs_email ON my_orgs (email, archived, id);

-- Какая организация подставляется сейчас. Ноль — ни одной.
ALTER TABLE users ADD COLUMN active_org INTEGER NOT NULL DEFAULT 0;

-- Нумерация — по организации, а не по человеку.
--
-- Иначе счета двух своих фирм получают общую сквозную нумерацию: у ИП
-- счета 1, 3, 7, у ООО — 2, 4, 5. Для налоговой это выглядит как
-- пропущенные счета, и объясняться придётся долго.
--
-- Ключ таблицы приходится пересоздавать: в SQLite первичный ключ не
-- меняется. Прежние строки переносим с org_id = 0 — так уже выданные
-- номера не начнутся заново, и человек не выставит счёт с номером,
-- который у него уже был.
CREATE TABLE IF NOT EXISTS doc_numbers2 (
  email   TEXT NOT NULL,
  org_id  INTEGER NOT NULL DEFAULT 0,
  kind    TEXT NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  year    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email, org_id, kind)
);

INSERT OR IGNORE INTO doc_numbers2 (email, org_id, kind, last_no, year)
SELECT email, 0, kind, last_no, year FROM doc_numbers;
