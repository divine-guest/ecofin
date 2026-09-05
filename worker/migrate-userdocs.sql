-- Мои документы: история созданных бумаг вместо одноразовой печати.
--
-- Раньше созданный счёт или акт жил в localStorage: терялся при чистке
-- браузера, не виден с телефона и никак не связан с учётом. Человек
-- выставлял счёт и через месяц не мог вспомнить, оплатили его или нет.
--
-- Здесь документ становится записью с номером, датой, контрагентом,
-- суммой и состоянием. Оплаченный счёт сам попадает в «Моё дело» —
-- и оттуда в расчёт налога. Это замыкает круг: библиотека документов
-- перестаёт быть генератором текста и становится учётом.
CREATE TABLE IF NOT EXISTS documents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  -- Какая организация выставила: у человека их может быть несколько,
  -- и нумерация у каждой своя. 0 — прежние реквизиты владельца.
  org_id     INTEGER NOT NULL DEFAULT 0,
  -- Чьё дело, если кабинет ведёт бухгалтер. 0 — собственное.
  client_id  INTEGER NOT NULL DEFAULT 0,
  kind       TEXT NOT NULL DEFAULT '',      -- ключ шаблона: invoice, act, …
  title      TEXT NOT NULL,
  number     TEXT NOT NULL DEFAULT '',
  doc_date   TEXT NOT NULL DEFAULT '',      -- 'ГГГГ-ММ-ДД'
  party      TEXT NOT NULL DEFAULT '',      -- контрагент
  -- Сумма в копейках целым числом — как и в учёте. Дробные рубли
  -- копят ошибку округления, и итог расходится с ручным подсчётом.
  amount     INTEGER NOT NULL DEFAULT 0,
  -- draft — черновик, issued — выставлен, paid — оплачен,
  -- cancelled — отменён.
  status     TEXT NOT NULL DEFAULT 'draft',
  content    TEXT NOT NULL DEFAULT '',
  -- Какая запись учёта создана при отметке «оплачен». Нужна, чтобы
  -- снятие отметки убрало и её: иначе выручка удвоится, а человек
  -- узнает об этом из налога.
  book_op_id INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  paid_at    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_documents_email ON documents (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents (email, status);
