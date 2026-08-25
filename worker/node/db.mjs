/* ============ Прослойка: D1 поверх обычного SQLite ============

   Зачем она существует. Весь серверный код написан под Cloudflare D1:
   250 с лишним запросов вида env.DB.prepare(sql).bind(...).first().
   Переезд на российский сервер мог означать переписывание всего этого.

   Но D1 — это и есть SQLite: тот же движок, тот же диалект, та же схема.
   Значит переписывать ничего не нужно — достаточно повторить четыре
   метода, которыми пользуется код:

       .first()  — 65 вызовов, вернуть первую строку или null
       .run()    — 89 вызовов, выполнить и вернуть число изменений
       .all()    — 24 вызова, вернуть { results: [...] }
       .batch()  —  6 вызовов, выполнить пачку одной транзакцией

   Больше ничего из Cloudflare код не использует: ни KV, ни R2, ни
   Durable Objects, ни HTMLRewriter, ни request.cf. Проверено обходом
   всех файлов worker/src.

   Драйвер выбирается сам: на сервере лучше native better-sqlite3, а
   если его нет (не собрался, нет компилятора) — берётся node-sqlite3-wasm,
   который работает везде и не требует сборки. Код выше не замечает
   разницы.                                                            */

import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, "..");

/* ---------- Драйверы ---------- */

/* Оба драйвера умеют одно и то же, но по-разному: better-sqlite3 берёт
   параметры россыпью, wasm — массивом, и у wasm выражения нужно
   освобождать вручную. Прячем это здесь. */

async function nativeDriver(file) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(file);
  const cache = new Map();
  const stmt = sql => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  return {
    name: "better-sqlite3",
    get: (sql, p) => stmt(sql).get(...p),
    all: (sql, p) => stmt(sql).all(...p),
    run: (sql, p) => stmt(sql).run(...p),
    exec: sql => db.exec(sql),
    close: () => db.close(),
  };
}

async function wasmDriver(file) {
  /* Пакет собран как CommonJS, поэтому из модуля он приходит целиком
     в default, а именованного экспорта нет. Берём оба варианта. */
  const mod = await import("node-sqlite3-wasm");
  const Database = mod.Database || mod.default?.Database;
  if (!Database) throw new Error("node-sqlite3-wasm: не нашёл Database");
  const db = new Database(file);
  const cache = new Map();
  const stmt = sql => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  return {
    name: "node-sqlite3-wasm",
    get: (sql, p) => stmt(sql).get(p),
    all: (sql, p) => stmt(sql).all(p),
    run: (sql, p) => stmt(sql).run(p),
    exec: sql => db.exec(sql),
    close: () => {
      for (const s of cache.values()) { try { s.finalize(); } catch {} }
      cache.clear();
      db.close();
    },
  };
}

async function pickDriver(file) {
  try { return await nativeDriver(file); }
  catch (e) {
    /* Не ошибка, а нормальный запасной путь: на машине без компилятора
       native-модуль не соберётся, и это не повод не запускаться. */
    console.warn("better-sqlite3 недоступен (" + e.message.split("\n")[0] + "), беру node-sqlite3-wasm");
    return await wasmDriver(file);
  }
}

/* ---------- Подготовка значений ----------

   D1 принимает undefined и молча превращает его в NULL, а драйверы
   SQLite на нём падают. Разница вылезла бы в бою на редком пути,
   поэтому нормализуем здесь. */
function clean(values) {
  return values.map(v => {
    if (v === undefined) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v instanceof Date) return v.getTime();
    return v;
  });
}

/* ---------- Выражение ---------- */

class Stmt {
  constructor(driver, sql, values = []) {
    this.driver = driver;
    this.sql = sql;
    this.values = values;
  }

  /* bind возвращает НОВОЕ выражение, а не меняет текущее: так же ведёт
     себя D1, и на это опирается batch — там выражения складывают
     в массив и выполняют позже. */
  bind(...values) {
    return new Stmt(this.driver, this.sql, clean(values));
  }

  async first() {
    const row = this.driver.get(this.sql, this.values);
    return row === undefined ? null : row;
  }

  async all() {
    const rows = this.driver.all(this.sql, this.values);
    return { success: true, results: rows || [], meta: {} };
  }

  async run() {
    const r = this.driver.run(this.sql, this.values) || {};
    return {
      success: true,
      meta: {
        changes: r.changes ?? 0,
        last_row_id: Number(r.lastInsertRowid ?? 0),
        rows_written: r.changes ?? 0,
      },
    };
  }

  /* Внутреннее: выполнить внутри уже открытой транзакции. */
  _exec() {
    const r = this.driver.run(this.sql, this.values) || {};
    return { success: true, meta: { changes: r.changes ?? 0, last_row_id: Number(r.lastInsertRowid ?? 0) } };
  }
}

/* ---------- База ---------- */

class Db {
  constructor(driver) { this.driver = driver; }

  prepare(sql) { return new Stmt(this.driver, sql); }

  /* Пачка выполняется одной транзакцией: у D1 это гарантия, и на неё
     опирается, например, удаление аккаунта — там семь удалений подряд,
     и остановка на середине оставила бы половину данных. */
  async batch(statements) {
    this.driver.exec("BEGIN");
    try {
      const out = statements.map(s => s._exec());
      this.driver.exec("COMMIT");
      return out;
    } catch (e) {
      try { this.driver.exec("ROLLBACK"); } catch {}
      throw e;
    }
  }

  async exec(sql) { this.driver.exec(sql); return { count: 1 }; }
}

/* ---------- Открытие ---------- */

/* file — путь к файлу базы. ':memory:' годится для проверок. */
export async function openDatabase(file) {
  const driver = await pickDriver(file);

  /* WAL: читатели не блокируют писателя и наоборот. Без него при
     нескольких одновременных посетителях чтение вставало бы в очередь
     за каждой записью. busy_timeout — чтобы редкая одновременная
     запись подождала, а не упала с «database is locked». */
  if (file !== ":memory:") driver.exec("PRAGMA journal_mode = WAL");
  driver.exec("PRAGMA busy_timeout = 5000");
  driver.exec("PRAGMA foreign_keys = ON");
  driver.exec("PRAGMA synchronous = NORMAL");

  const db = new Db(driver);
  db.driverName = driver.name;
  db.close = () => driver.close();
  return db;
}

/* ---------- Схема и миграции ----------

   Тот же порядок, что и при выкатке на Cloudflare: сначала schema.sql,
   потом migrate-*.sql по алфавиту, по одному выражению.

   Комментарии срезаем ДО разбиения по «;» — точка с запятой внутри
   комментария иначе рвёт выражение пополам. На этом уже спотыкались.  */
const HARMLESS = /duplicate column|already exists|no such index/i;

function statements(sql) {
  return sql
    /* Сначала выравниваем переносы строк. Без этого на файле с виндовыми
       \r\n регулярка ниже молча не срабатывает: точка в регулярных
       выражениях не совпадает с \r, поэтому «конец строки» оказывается
       не там, где кажется. Комментарий остаётся внутри выражения, точка
       с запятой из него рвёт выражение пополам — и схема не применяется.
       Ровно эти грабли уже были при ручных миграциях. */
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(line => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);
}

export async function applySchema(db, dir = WORKER) {
  const files = ["schema.sql", ...(await readdir(dir)).filter(f => /^migrate.*\.sql$/.test(f)).sort()];
  let applied = 0, skipped = 0;

  for (const f of files) {
    let sql;
    try { sql = await readFile(join(dir, f), "utf8"); }
    catch { continue; }
    for (const s of statements(sql)) {
      try { await db.exec(s); applied++; }
      catch (e) {
        if (HARMLESS.test(e.message)) { skipped++; continue; }
        throw new Error(`${f}: ${e.message}\n${s.slice(0, 120)}`);
      }
    }
  }
  return { files: files.length, applied, skipped };
}
