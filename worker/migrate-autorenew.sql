-- Автопродление подписки.
--
-- Зачем: разовый платёж даёт около четверти повторных оплат, автосписание —
-- три четверти. Это разница между разовой продажей и доходом, который идёт сам.
--
-- Как устроено: при первой оплате мы просим ЮKassa сохранить способ оплаты
-- (save_payment_method). В ответ приходит payment_method_id — по нему можно
-- списывать дальше без участия человека. Он и лежит в auto_method.
--
-- auto_renew = 1 по умолчанию, но списание возможно только когда есть
-- auto_method. То есть у людей, оплативших до появления этой возможности,
-- ничего внезапно не спишется.

ALTER TABLE users ADD COLUMN auto_renew INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN auto_method TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN auto_plan TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN auto_last INTEGER;

-- Быстро находить, кого пора продлевать.
CREATE INDEX IF NOT EXISTS idx_users_renew ON users(pro_until);
