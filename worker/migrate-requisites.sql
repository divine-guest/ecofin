-- Реквизиты и контрагенты: один раз ввёл — работает во всех документах.
--
-- До сих пор в библиотеке было пятьдесят шаблонов, и в каждом человек
-- набирал свои реквизиты заново: наименование, ИНН, адрес, банк. Для
-- счёта, который выставляют дважды в неделю, это означало, что проще
-- держать свой файл в Word, чем ходить к нам.
--
-- Отсюда же берётся ощущение «сервисов мало». Их не мало — они не
-- связаны. Пятьдесят несвязанных шаблонов человек воспринимает как один
-- шаблон, который приходится каждый раз заполнять с нуля.
--
-- Реквизиты живут на самом пользователе, а не отдельной таблицей: они
-- у него одни, и запрос за ними уже и так идёт при каждом входе.

ALTER TABLE users ADD COLUMN req_name    TEXT NOT NULL DEFAULT '';  -- ИП Иванов И. И. / ООО «Ромашка»
ALTER TABLE users ADD COLUMN req_inn     TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN req_ogrn    TEXT NOT NULL DEFAULT '';  -- ОГРН или ОГРНИП
ALTER TABLE users ADD COLUMN req_kpp     TEXT NOT NULL DEFAULT '';  -- только у организаций
ALTER TABLE users ADD COLUMN req_address TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN req_bank    TEXT NOT NULL DEFAULT '';  -- наименование банка
ALTER TABLE users ADD COLUMN req_bik     TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN req_account TEXT NOT NULL DEFAULT '';  -- расчётный счёт
ALTER TABLE users ADD COLUMN req_corr    TEXT NOT NULL DEFAULT '';  -- корреспондентский счёт
ALTER TABLE users ADD COLUMN req_phone   TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN req_signer  TEXT NOT NULL DEFAULT '';  -- кто подписывает
ALTER TABLE users ADD COLUMN req_post    TEXT NOT NULL DEFAULT '';  -- должность подписанта

-- Контрагенты: те, с кем человек работает не в первый раз.
--
-- Ключевое отличие от таблицы clients: та про чужой учёт, который ведёт
-- бухгалтер, а эта — про вторую сторону в собственных документах. Их
-- легко перепутать, поэтому разные таблицы: у одного и того же человека
-- контрагент может быть и клиентом, и наоборот, и объединять их значило
-- бы навязывать связь, которой нет.
CREATE TABLE IF NOT EXISTS counterparties (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  inn        TEXT NOT NULL DEFAULT '',
  kpp        TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  bank       TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  used_at    INTEGER NOT NULL DEFAULT 0,   -- когда последний раз подставляли
  created_at INTEGER NOT NULL
);

-- Сортируем по последнему использованию: тот, с кем работали вчера,
-- нужен чаще того, кого завели полгода назад и забыли.
CREATE INDEX IF NOT EXISTS idx_cp_owner ON counterparties (email, used_at DESC);

-- Сквозная нумерация документов.
--
-- Номер счёта обязан расти и не повторяться: два счёта с одним номером —
-- это спор с контрагентом и вопрос на проверке. Человек, который держит
-- нумерацию в голове, рано или поздно ошибается, и узнаёт об этом через
-- полгода при сверке.
CREATE TABLE IF NOT EXISTS doc_numbers (
  email   TEXT NOT NULL,
  kind    TEXT NOT NULL,               -- schet | nakladnaya | akt | ...
  last_no INTEGER NOT NULL DEFAULT 0,
  year    INTEGER NOT NULL DEFAULT 0,  -- нумерация начинается заново каждый год
  PRIMARY KEY (email, kind)
);
