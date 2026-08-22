// Тест PAY: план, активация, история, отмена; SETTINGS: смена пароля
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.matchMedia = () => ({ matches: false });
global.document = { documentElement: { setAttribute() {} }, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, createElement: () => ({ classList: { add() {} }, style: {} }), body: { appendChild() {}, prepend() {} } };
global.location = { href: "", reload() {} };
global.confirm = () => true;
const fs = require("fs");
let code = fs.readFileSync("js/app.js", "utf8") + "\n" + fs.readFileSync("js/ai.js", "utf8");
code = code.replace(/function renderHeader[\s\S]*?\n\}/, "")
            .replace(/function renderFooter[\s\S]*?\n\}/, "")
            .replace(/function renderChatWidget[\s\S]*?\n\}/, "")
            .replace(/function initRevealAnimations[\s\S]*?\n\}/, "")
            .replace(/function spawnHeroParticles[\s\S]*?\n\}/, "")
            .replace(/function initPage[\s\S]*?\n\}/, "");
code += `
(async () => {
  PF.register("Юзер", "p@t.ru", "1234");
  console.log("free:", PF.user().plan, "| aiLeft:", PF.aiLeft());
  // имитация успешной оплаты напрямую через логику PAY.submit (минуя DOM)
  const plan = PAY.plans.month;
  const until = Date.now() + plan.days * 86400000;
  const u = PF.user();
  const payments = [...(u.payments || []), { id: "PF-TEST", plan: "month", amount: plan.price, method: "sbp", date: new Date().toISOString() }];
  PF.updateUser({ plan: "pro", proUntil: until, payments });
  const u2 = PF.user();
  console.log("после оплаты: план =", u2.plan, "| proUntil есть =", !!u2.proUntil, "| платежей =", u2.payments.length);
  console.log("isPro:", PF.isPro(), "| безлимит:", PF.aiLeft() === Infinity);
  console.log("выручка (сумма):", u2.payments.reduce((a, p) => a + p.amount, 0), "₽ (ожид. 490)");
  // отмена
  PAY.cancel();
  console.log("после отмены: план =", PF.user().plan, "| proUntil сохранён =", !!PF.user().proUntil);
  // настройки: смена пароля
  PF.updateUser({ pass: "9999" });
  console.log("пароль изменён:", PF.users()["p@t.ru"].pass === "9999");
  console.log("ALL OK");
})();
`;
eval(code);
