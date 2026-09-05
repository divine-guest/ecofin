-- Партнёрские предложения: настраиваются в админке, а не в коде.
--
-- Ссылка, наименование рекламодателя и токен erid лежали прямо в
-- js/partners.js. Чтобы включить партнёрку, владельцу нужно было
-- открыть файл с кодом, вписать три поля и выкатить сайт. Он не
-- разработчик — значит, отложит, и заготовка так и останется
-- заготовкой. А это единственный доход, который не требует ни
-- подписчиков, ни его времени.
--
-- Тексты предложений остаются в коде: они часть содержания сайта.
-- Здесь — только то, что приходит из партнёрского договора и меняется
-- без нас: ссылка, рекламодатель, маркировка, включено или нет.
CREATE TABLE IF NOT EXISTS partner_offers (
  id         TEXT PRIMARY KEY,          -- совпадает с id в js/partners.js
  url        TEXT NOT NULL DEFAULT '',
  advertiser TEXT NOT NULL DEFAULT '',  -- наименование и ИНН из договора
  erid       TEXT NOT NULL DEFAULT '',  -- токен маркировки от ОРД
  enabled    INTEGER NOT NULL DEFAULT 0,
  clicks     INTEGER NOT NULL DEFAULT 0,
  shows      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
