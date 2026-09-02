-- Несколько дел в одном кабинете: тариф «Бухгалтер».
--
-- Бухгалтер ведёт двадцать ИП и продаёт нам одного себя. Это самый
-- выгодный клиент сервиса: он приводит два десятка дел, платит за всех
-- сразу и уходит труднее всех — потому что переносить учёт двадцати
-- человек никто не станет.
--
-- Собственный учёт владельца кабинета остаётся тем же самым: у его
-- операций client_id = 0. Так старые записи работают без переноса,
-- а человек, который не бухгалтер, вообще не замечает, что появились
-- какие-то клиенты.

CREATE TABLE IF NOT EXISTS clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner      TEXT NOT NULL,           -- почта того, кто ведёт
  name       TEXT NOT NULL,
  inn        TEXT NOT NULL DEFAULT '',
  form       TEXT NOT NULL DEFAULT '',   -- ip | ooo | self
  regime     TEXT NOT NULL DEFAULT '',   -- npd | usn6 | usn15 | psn | ausn | eshn | osno
  workers    INTEGER NOT NULL DEFAULT 0,
  psn        INTEGER NOT NULL DEFAULT 0, -- потенциальный доход по патенту
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_owner ON clients (owner, name);

-- К какому делу относится операция. 0 — собственное дело владельца
-- кабинета: значение по умолчанию, поэтому все прежние записи остаются
-- на своих местах и переносить ничего не нужно.
ALTER TABLE book_ops ADD COLUMN client_id INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_book_client ON book_ops (email, client_id, day DESC);
