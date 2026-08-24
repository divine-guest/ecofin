/* ПравоФин — ограничение частоты запросов.

   Закрывает две дыры, которые не видны в обычных тестах, но дорого стоят:
   1) перебор пароля — без лимита словарь из миллиона паролей проверяется за часы;
   2) массовая регистрация — каждый бот получает бесплатные обращения к ИИ,
      то есть напрямую тратит деньги владельца сервиса.

   Счётчики живут в D1: воркер работает во множестве изолятов, и счётчик
   в памяти процесса ничего не ограничивает. */

/* Одно «ведро» — это ключ вида «действие:признак». Признаком может быть
   и IP, и email: перебор с одного адреса и перебор одного аккаунта с ботнета
   надо ловить по-разному. */
export async function hit(env, bucket, limit, windowSec) {
  const nowSec = Math.floor(Date.now() / 1000);
  const resetAt = nowSec + windowSec;

  try {
    /* Одним запросом: заводим ведро либо продлеваем истёкшее, либо считаем.
       Гонки не страшны — D1 сериализует запись, худший случай — лишний запрос. */
    const row = await env.DB.prepare(
      `INSERT INTO ratelimit (bucket, n, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET
         n = CASE WHEN ratelimit.reset_at <= ?3 THEN 1 ELSE ratelimit.n + 1 END,
         reset_at = CASE WHEN ratelimit.reset_at <= ?3 THEN ?2 ELSE ratelimit.reset_at END
       RETURNING n, reset_at`
    ).bind(bucket, resetAt, nowSec).first();

    if (!row) return { allowed: true, remaining: limit };
    return {
      allowed: row.n <= limit,
      remaining: Math.max(0, limit - row.n),
      retryAfter: Math.max(1, row.reset_at - nowSec),
    };
  } catch (e) {
    /* Если счётчик недоступен — пропускаем запрос: лучше пустить лишнего,
       чем закрыть вход всем из-за сбоя вспомогательной таблицы. */
    console.error("ratelimit", e.message);
    return { allowed: true, remaining: limit };
  }
}

export function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

/* Настройки на каждое защищаемое действие.
   perEmail нужен, чтобы ботнет с тысячи адресов не подбирал один аккаунт. */
export const LIMITS = {
  login:    { perIp: [20, 900],  perKey: [8, 900] },    // 20/15 мин с IP, 8/15 мин на аккаунт
  /* 8, а не 3-5: у мобильных операторов один внешний IP на тысячи абонентов,
     и слишком жёсткий лимит отрежет живых людей. Настоящая защита от ботоферм —
     подтверждение почты, его добавим вместе с доменом. */
  register: { perIp: [8, 3600] },
  promo:    { perIp: [10, 3600], perKey: [10, 3600] },   // защита от подбора кода
  reset:    { perIp: [10, 3600] },
};

/* Посмотреть счётчик, ничего не списывая. Нужно для входа: списывать
   попытку до проверки пароля нельзя — иначе человек, честно вошедший
   девять раз за четверть часа, окажется заблокирован. */
export async function peek(env, bucket, limit) {
  try {
    const row = await env.DB.prepare("SELECT n, reset_at FROM ratelimit WHERE bucket = ?")
      .bind(bucket).first();
    const nowSec = Math.floor(Date.now() / 1000);
    if (!row || row.reset_at <= nowSec) return { allowed: true };
    return { allowed: row.n < limit, retryAfter: Math.max(1, row.reset_at - nowSec) };
  } catch (e) {
    console.error("ratelimit peek", e.message);
    return { allowed: true };
  }
}

/* Только проверяет, не блокирован ли вход, — без списания. */
export async function checkOnly(env, request, action, key) {
  const cfg = LIMITS[action];
  if (!cfg) return null;
  if (cfg.perIp) {
    const r = await peek(env, `${action}:ip:${clientIp(request)}`, cfg.perIp[0]);
    if (!r.allowed) return r.retryAfter;
  }
  if (cfg.perKey && key) {
    const r = await peek(env, `${action}:key:${key}`, cfg.perKey[0]);
    if (!r.allowed) return r.retryAfter;
  }
  return null;
}

/* Списать неудачную попытку. Зовётся ТОЛЬКО когда пароль не подошёл. */
export async function penalize(env, request, action, key) {
  const cfg = LIMITS[action];
  if (!cfg) return;
  if (cfg.perIp) await hit(env, `${action}:ip:${clientIp(request)}`, cfg.perIp[0], cfg.perIp[1]);
  if (cfg.perKey && key) await hit(env, `${action}:key:${key}`, cfg.perKey[0], cfg.perKey[1]);
}

/* Сбросить счётчик после успешного входа: человек доказал, что он свой. */
export async function forgive(env, request, action, key) {
  const cfg = LIMITS[action];
  if (!cfg) return;
  const buckets = [];
  if (cfg.perIp) buckets.push(`${action}:ip:${clientIp(request)}`);
  if (cfg.perKey && key) buckets.push(`${action}:key:${key}`);
  for (const b of buckets) {
    await env.DB.prepare("DELETE FROM ratelimit WHERE bucket = ?").bind(b).run().catch(() => {});
  }
}

/* Возвращает null, если можно продолжать, иначе — сколько ждать секунд. */
export async function checkLimits(env, request, action, key) {
  const cfg = LIMITS[action];
  if (!cfg) return null;

  if (cfg.perIp) {
    const [limit, win] = cfg.perIp;
    const r = await hit(env, `${action}:ip:${clientIp(request)}`, limit, win);
    if (!r.allowed) return r.retryAfter;
  }
  if (cfg.perKey && key) {
    const [limit, win] = cfg.perKey;
    const r = await hit(env, `${action}:key:${key}`, limit, win);
    if (!r.allowed) return r.retryAfter;
  }
  return null;
}

/* Чистка отработавших вёдер — вызывается редко, вместе с чисткой сессий. */
export function sweep(env) {
  return env.DB.prepare("DELETE FROM ratelimit WHERE reset_at < ?")
    .bind(Math.floor(Date.now() / 1000)).run();
}
