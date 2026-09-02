/* ============ ЭкоФин — прогресс между устройствами ============

   На странице входа написано: «войдите теми же почтой и паролем с
   телефона — подписка, документы и прогресс будут на месте».
   Для подписки и расчётов это было правдой, а для «Копилки», уроков,
   практикума и дневника трат — нет: они лежали в localStorage.

   Человек копил серию дней на телефоне, открывал сайт на компьютере —
   серия ноль. Серия и есть тот ежедневный крючок, ради которого сюда
   возвращаются, и он рвался при первом переходе на другое устройство.

   Правило слияния одно на все виды: ДАННЫЕ ТОЛЬКО ПРИБАВЛЯЮТСЯ.
   Отметки дней объединяются, пройденные уроки объединяются, лучший
   результат берётся больший, записи трат объединяются по своему
   времени создания. При таком правиле неважно, что пришло первым, и
   работа с двух устройств одновременно ничего не затирает.

   Почему слияние на клиенте, а не на сервере: правила разные для
   каждого вида, а сервер не должен знать, что «Копилка» — это набор
   дат. Он хранит и отдаёт, решает клиент.                            */

const PROGRESS = {
  /* Ключ на сервере → как он называется в localStorage.
     Функция, потому что в имени ключа есть почта. */
  MAP: {
    habits:   u => "pf_habits_" + u,
    courses:  u => "pf_course_" + u,
    scores:   u => "pf_scores_" + u,
    read:     u => "pf_read_" + u,
    expenses: u => "pf_exp_" + u,
    prefs:    u => "pf_prefs_" + u,
  },

  pulled: false,
  timers: {},

  email() { const u = (typeof PF !== "undefined") && PF.user(); return u ? u.email : ""; },
  localKey(key) {
    const e = this.email();
    return e ? this.MAP[key](e) : "";
  },

  read(key) {
    const k = this.localKey(key);
    if (!k) return null;
    try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; }
  },
  write(key, value) {
    const k = this.localKey(key);
    if (k) localStorage.setItem(k, JSON.stringify(value));
  },

  /* ---------- Слияние ---------- */

  /* Объединение множеств: даты «Копилки», прочитанные статьи. */
  mergeSet(a, b) {
    return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])].sort();
  },

  merge(key, local, remote) {
    if (local == null) return remote;
    if (remote == null) return local;

    switch (key) {
      case "read":
        return this.mergeSet(local, remote);

      /* {money: [даты], ...} — объединяем каждый список привычек. */
      case "habits": {
        const out = { ...remote, ...local };
        for (const k of new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])) {
          out[k] = this.mergeSet(local[k], remote[k]);
        }
        return out;
      }

      /* {курс: [номера уроков]} — пройденный урок не может «непройтись». */
      case "courses": {
        const out = {};
        for (const k of new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])) {
          out[k] = this.mergeSet(local[k], remote[k]).map(Number).sort((x, y) => x - y);
        }
        return out;
      }

      /* {игра: очки} — берём лучший результат. */
      case "scores": {
        const out = { ...remote };
        for (const k of Object.keys(local || {})) {
          out[k] = Math.max(Number(local[k]) || 0, Number(out[k]) || 0);
        }
        return out;
      }

      /* {items: [...], limit: N}. Записи объединяем по своему номеру;
         у старых записей номера нет — тогда считаем одинаковыми те,
         что совпали датой, суммой и категорией.

         Удаление побеждает: запись, помеченную удалённой хоть на одном
         устройстве, обратно не воскрешаем. Без этого стёртая на
         компьютере трата возвращалась бы с телефона, который о её
         удалении ещё не знает. */
      case "expenses": {
        const seen = new Map();
        for (const it of [...(remote.items || []), ...(local.items || [])]) {
          if (!it) continue;
          const id = it.id || `${it.date}|${it.sum}|${it.cat}`;
          const was = seen.get(id);
          seen.set(id, was && was.del ? was : it);
        }
        const items = [...seen.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        return { items, limit: Number(local.limit) || Number(remote.limit) || 0 };
      }

      /* Настройки: свежее побеждает, но ключи не теряются. */
      default:
        return { ...remote, ...local };
    }
  },

  /* ---------- Обмен с сервером ---------- */

  /* Забрать всё и слить с тем, что уже есть в браузере.
     Зовётся один раз при загрузке страницы, после подтверждения сессии. */
  async pull() {
    if (typeof API === "undefined" || !this.email()) return;
    let items;
    try { items = (await API.progress.all()).items || {}; }
    catch { return; }

    const changed = [];
    for (const key of Object.keys(this.MAP)) {
      const remote = items[key] ? items[key].data : null;
      const local = this.read(key);
      const merged = this.merge(key, local, remote);
      if (merged == null) continue;
      this.write(key, merged);
      /* Локально было больше, чем на сервере, — вернём разницу.
         Сравнение строкой грубое, но здесь этого достаточно:
         лишняя отправка стоит одного запроса, потерянные дни — доверия. */
      if (JSON.stringify(merged) !== JSON.stringify(remote)) changed.push(key);
    }
    this.pulled = true;
    for (const key of changed) this.push(key, 0);
    if (changed.length) document.dispatchEvent(new CustomEvent("pf:progress"));
  },

  /* Отправить одно состояние. С задержкой: за одно занятие человек
     отмечает и снимает отметку по нескольку раз, и слать запрос на
     каждое нажатие — расточительно. */
  push(key, delay = 1200) {
    if (typeof API === "undefined" || !this.email() || !this.MAP[key]) return;
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(() => {
      const data = this.read(key);
      if (data == null) return;
      API.progress.put(key, data).catch(() => {});
    }, delay);
  },

  /* Сохранить и сразу отправить — то, что зовут страницы. */
  save(key, value) {
    this.write(key, value);
    this.push(key);
  },
};

/* Синхронизация начинается только после того, как сервер подтвердил
   сессию: до этого мы не знаем, чей это прогресс, и слили бы чужой
   с гостевым. */
document.addEventListener("pf:ready", ({ detail }) => {
  if (detail && detail.user) PROGRESS.pull();
});

/* Уходя со страницы, дописываем то, что не успело уйти по таймеру:
   иначе отметка последнего дня терялась при быстром закрытии вкладки.

   keepalive, а не sendBeacon: маячку нельзя задать заголовки, а токен
   мы принципиально не кладём никуда, кроме Authorization. */
window.addEventListener("pagehide", () => {
  if (typeof API === "undefined" || !API.token()) return;
  for (const key of Object.keys(PROGRESS.timers)) {
    if (!PROGRESS.timers[key]) continue;
    clearTimeout(PROGRESS.timers[key]);
    PROGRESS.timers[key] = null;
    const data = PROGRESS.read(key);
    if (data == null) continue;
    try {
      fetch(API.BASE + "/api/progress", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + API.token() },
        body: JSON.stringify({ key, data }),
      }).catch(() => {});
    } catch {}
  }
});
