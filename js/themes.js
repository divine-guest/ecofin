/* ============ ПравоФин — темы оформления ============

   Палитры не подобраны на глаз: каждая тема задана несколькими опорными
   числами, а все её цвета посчитаны по единым правилам генератором
   (scratchpad/gen_themes.py). Поэтому ни в одной теме не может оказаться
   нечитаемой пары — контраст проверен по WCAG при выпуске.

   Тема и режим (светлый/тёмный) независимы, как в Telegram: человек
   выбирает и палитру, и время суток отдельно.                        */

const THEMES = {
  "default": {
    "light": {
      "bg": "#f4f8f8",
      "bg-2": "#ebf2f1",
      "surface": "#fefefe",
      "surface-2": "#f1f6f5",
      "text": "#12211f",
      "muted": "#4f726e",
      "border": "#d2e0de",
      "primary": "#0b7f73",
      "primary-2": "#0d7f9b",
      "accent": "#0b7f73",
      "grad-primary": "linear-gradient(135deg, #0b7f73 0%, #0d7f9b 100%)",
      "grad-hero": "linear-gradient(155deg, #0d1c1a 0%, #056158 48%, #0a5c71 100%)"
    },
    "dark": {
      "bg": "#0b1615",
      "bg-2": "#0f1d1b",
      "surface": "#132321",
      "surface-2": "#1a2e2b",
      "text": "#e9f2f1",
      "muted": "#97bab5",
      "border": "#26403d",
      "primary": "#2ae5d2",
      "primary-2": "#45c7e8",
      "accent": "#2ae5d2",
      "grad-primary": "linear-gradient(135deg, #2ae5d2 0%, #45c7e8 100%)",
      "grad-hero": "linear-gradient(155deg, #060e0d 0%, #04443d 48%, #074150 100%)"
    },
    "title": "Как у сервиса"
  },
  "graphite": {
    "light": {
      "bg": "#f5f6f7",
      "bg-2": "#eceef0",
      "surface": "#fefefe",
      "surface-2": "#f2f3f5",
      "text": "#14191f",
      "muted": "#575f6b",
      "border": "#d5d8dd",
      "primary": "#45515f",
      "primary-2": "#515770",
      "accent": "#45515f",
      "grad-primary": "linear-gradient(135deg, #45515f 0%, #515770 100%)",
      "grad-hero": "linear-gradient(155deg, #0e131b 0%, #28323e 48%, #333747 100%)"
    },
    "dark": {
      "bg": "#0c1015",
      "bg-2": "#10151b",
      "surface": "#151a21",
      "surface-2": "#1d232b",
      "text": "#eaedf0",
      "muted": "#9ea7b3",
      "border": "#2a313c",
      "primary": "#7692b2",
      "primary-2": "#8992bd",
      "accent": "#7692b2",
      "grad-primary": "linear-gradient(135deg, #7692b2 0%, #8992bd 100%)",
      "grad-hero": "linear-gradient(155deg, #070a0d 0%, #1c232c 48%, #242732 100%)"
    },
    "title": "Графит"
  },
  "ocean": {
    "light": {
      "bg": "#f4f7f8",
      "bg-2": "#ebf0f2",
      "surface": "#fefefe",
      "surface-2": "#f1f5f6",
      "text": "#111d22",
      "muted": "#4e6a74",
      "border": "#d1dce0",
      "primary": "#116c88",
      "primary-2": "#1457a3",
      "accent": "#116c88",
      "grad-primary": "linear-gradient(135deg, #116c88 0%, #1457a3 100%)",
      "grad-hero": "linear-gradient(155deg, #0c181d 0%, #084a5e 48%, #0d3a6d 100%)"
    },
    "dark": {
      "bg": "#0b1317",
      "bg-2": "#0e191d",
      "surface": "#121f23",
      "surface-2": "#19292e",
      "text": "#e8eff2",
      "muted": "#95b1bb",
      "border": "#253a41",
      "primary": "#37bde6",
      "primary-2": "#5399ea",
      "accent": "#37bde6",
      "grad-primary": "linear-gradient(135deg, #37bde6 0%, #5399ea 100%)",
      "grad-hero": "linear-gradient(155deg, #060c0e 0%, #063442 48%, #0a294d 100%)"
    },
    "title": "Глубокая вода"
  },
  "forest": {
    "light": {
      "bg": "#f4f8f6",
      "bg-2": "#ebf2ee",
      "surface": "#fefefe",
      "surface-2": "#f1f6f3",
      "text": "#122118",
      "muted": "#4f725e",
      "border": "#d2e0d8",
      "primary": "#207941",
      "primary-2": "#27916e",
      "accent": "#207941",
      "grad-primary": "linear-gradient(135deg, #207941 0%, #27916e 100%)",
      "grad-hero": "linear-gradient(155deg, #0d1c13 0%, #12542a 48%, #1a6149 100%)"
    },
    "dark": {
      "bg": "#0b1610",
      "bg-2": "#0f1d15",
      "surface": "#132319",
      "surface-2": "#1a2e22",
      "text": "#e9f2ec",
      "muted": "#97baa5",
      "border": "#264031",
      "primary": "#40dd7a",
      "primary-2": "#5ae2b5",
      "accent": "#40dd7a",
      "grad-primary": "linear-gradient(135deg, #40dd7a 0%, #5ae2b5 100%)",
      "grad-hero": "linear-gradient(155deg, #060e0a 0%, #0d3b1e 48%, #124434 100%)"
    },
    "title": "Хвойный"
  },
  "sand": {
    "light": {
      "bg": "#f8f7f4",
      "bg-2": "#f2efeb",
      "surface": "#fefefe",
      "surface-2": "#f6f4f1",
      "text": "#221b11",
      "muted": "#74654e",
      "border": "#e0dad1",
      "primary": "#955823",
      "primary-2": "#ae8f29",
      "accent": "#955823",
      "grad-primary": "linear-gradient(135deg, #955823 0%, #ae8f29 100%)",
      "grad-hero": "linear-gradient(155deg, #1d160c 0%, #563110 48%, #635117 100%)"
    },
    "dark": {
      "bg": "#17120b",
      "bg-2": "#1d170e",
      "surface": "#231c12",
      "surface-2": "#2e2619",
      "text": "#f2eee8",
      "muted": "#bbac95",
      "border": "#413625",
      "primary": "#e69956",
      "primary-2": "#eace71",
      "accent": "#e69956",
      "grad-primary": "linear-gradient(135deg, #e69956 0%, #eace71 100%)",
      "grad-hero": "linear-gradient(155deg, #0e0b06 0%, #3c220b 48%, #463a10 100%)"
    },
    "title": "Песчаник"
  },
  "indigo": {
    "light": {
      "bg": "#f4f5f8",
      "bg-2": "#ebecf2",
      "surface": "#fefefe",
      "surface-2": "#f1f2f6",
      "text": "#121421",
      "muted": "#4f5472",
      "border": "#d2d4e0",
      "primary": "#2d42be",
      "primary-2": "#4f39d0",
      "accent": "#2d42be",
      "grad-primary": "linear-gradient(135deg, #2d42be 0%, #4f39d0 100%)",
      "grad-hero": "linear-gradient(155deg, #0d0f1c 0%, #101b56 48%, #231763 100%)"
    },
    "dark": {
      "bg": "#0b0c16",
      "bg-2": "#0f111d",
      "surface": "#131523",
      "surface-2": "#1a1c2e",
      "text": "#e9eaf2",
      "muted": "#979cba",
      "border": "#262940",
      "primary": "#7a8beb",
      "primary-2": "#9a8cee",
      "accent": "#7a8beb",
      "grad-primary": "linear-gradient(135deg, #7a8beb 0%, #9a8cee 100%)",
      "grad-hero": "linear-gradient(155deg, #06070e 0%, #0b133c 48%, #191046 100%)"
    },
    "title": "Индиго"
  },
  "plum": {
    "light": {
      "bg": "#f7f4f8",
      "bg-2": "#f0ebf1",
      "surface": "#fefefe",
      "surface-2": "#f5f1f6",
      "text": "#1e1221",
      "muted": "#6a5170",
      "border": "#dcd3df",
      "primary": "#853399",
      "primary-2": "#b03ba4",
      "accent": "#853399",
      "grad-primary": "linear-gradient(135deg, #853399 0%, #b03ba4 100%)",
      "grad-hero": "linear-gradient(155deg, #190d1c 0%, #441650 48%, #5c1f56 100%)"
    },
    "dark": {
      "bg": "#140b16",
      "bg-2": "#1a0f1c",
      "surface": "#1f1322",
      "surface-2": "#291a2d",
      "text": "#f0e9f1",
      "muted": "#b299b8",
      "border": "#3a273f",
      "primary": "#c973de",
      "primary-2": "#e48bdb",
      "accent": "#c973de",
      "grad-primary": "linear-gradient(135deg, #c973de 0%, #e48bdb 100%)",
      "grad-hero": "linear-gradient(155deg, #0c070e 0%, #301038 48%, #41163d 100%)"
    },
    "title": "Слива"
  },
  "clay": {
    "light": {
      "bg": "#f8f5f4",
      "bg-2": "#f2eceb",
      "surface": "#fefefe",
      "surface-2": "#f6f2f1",
      "text": "#211512",
      "muted": "#72564f",
      "border": "#e0d5d2",
      "primary": "#a9422d",
      "primary-2": "#c17633",
      "accent": "#a9422d",
      "grad-primary": "linear-gradient(135deg, #a9422d 0%, #c17633 100%)",
      "grad-hero": "linear-gradient(155deg, #1c100d 0%, #541d12 48%, #613b1a 100%)"
    },
    "dark": {
      "bg": "#160d0b",
      "bg-2": "#1d120f",
      "surface": "#231613",
      "surface-2": "#2e1e1a",
      "text": "#f2eae9",
      "muted": "#ba9e97",
      "border": "#402b26",
      "primary": "#e78774",
      "primary-2": "#ebba8e",
      "accent": "#e78774",
      "grad-primary": "linear-gradient(135deg, #e78774 0%, #ebba8e 100%)",
      "grad-hero": "linear-gradient(155deg, #0e0806 0%, #3b140d 48%, #442a12 100%)"
    },
    "title": "Терракота"
  },
  "steel": {
    "light": {
      "bg": "#f4f6f8",
      "bg-2": "#eceff1",
      "surface": "#fefefe",
      "surface-2": "#f2f4f5",
      "text": "#131b20",
      "muted": "#53636e",
      "border": "#d3dade",
      "primary": "#395c74",
      "primary-2": "#435789",
      "accent": "#395c74",
      "grad-primary": "linear-gradient(135deg, #395c74 0%, #435789 100%)",
      "grad-hero": "linear-gradient(155deg, #0d161b 0%, #1f3647 48%, #283452 100%)"
    },
    "dark": {
      "bg": "#0c1116",
      "bg-2": "#10171c",
      "surface": "#141c22",
      "surface-2": "#1b252c",
      "text": "#e9eef1",
      "muted": "#9aabb6",
      "border": "#28353e",
      "primary": "#6aa1c8",
      "primary-2": "#8097d0",
      "accent": "#6aa1c8",
      "grad-primary": "linear-gradient(135deg, #6aa1c8 0%, #8097d0 100%)",
      "grad-hero": "linear-gradient(155deg, #070b0e 0%, #152632 48%, #1d253a 100%)"
    },
    "title": "Сталь"
  },
  "moss": {
    "light": {
      "bg": "#f6f8f4",
      "bg-2": "#eef1eb",
      "surface": "#fefefe",
      "surface-2": "#f3f6f1",
      "text": "#182112",
      "muted": "#5e7051",
      "border": "#d8dfd3",
      "primary": "#4f7231",
      "primary-2": "#47883a",
      "accent": "#4f7231",
      "grad-primary": "linear-gradient(135deg, #4f7231 0%, #47883a 100%)",
      "grad-hero": "linear-gradient(155deg, #131c0d 0%, #314a1c 48%, #2d5625 100%)"
    },
    "dark": {
      "bg": "#10160b",
      "bg-2": "#141c0f",
      "surface": "#192213",
      "surface-2": "#222d1a",
      "text": "#ecf1e9",
      "muted": "#a5b899",
      "border": "#313f27",
      "primary": "#90cc5c",
      "primary-2": "#83d373",
      "accent": "#90cc5c",
      "grad-primary": "linear-gradient(135deg, #90cc5c 0%, #83d373 100%)",
      "grad-hero": "linear-gradient(155deg, #090e07 0%, #233413 48%, #203d1a 100%)"
    },
    "title": "Мох"
  }
};

/* Применяем всю палитру, а не один акцент: тема меняет фон, поверхности,
   текст, границы и градиенты — иначе это просто перекрашенная кнопка. */
function applyThemePalette(id, mode) {
  const t = THEMES[id] || THEMES.default;
  const side = t[mode === "dark" ? "dark" : "light"];
  const r = document.documentElement;
  for (const [k, v] of Object.entries(side)) r.style.setProperty("--" + k, v);
  r.setAttribute("data-palette", id);
}

function clearThemePalette() {
  const r = document.documentElement;
  const any = THEMES.default.light;
  for (const k of Object.keys(any)) r.style.removeProperty("--" + k);
  r.removeAttribute("data-palette");
}

/* Список для окна выбора: название и три цвета для миниатюры. */
function themeList() {
  return Object.entries(THEMES).map(([id, t]) => ({
    id,
    title: t.title,
    light: { bg: t.light.bg, surface: t.light.surface, accent: t.light.accent },
    dark: { bg: t.dark.bg, surface: t.dark.surface, accent: t.dark.accent },
  }));
}
