// ============================================================================
// TAZAWWUD — Tasbih / Dhikr counter
// ----------------------------------------------------------------------------
// A free-form tap counter for general dhikr — distinct from the fixed
// Morning/Evening Adhkar routine in adhkar.js (which has its own per-item
// counters tied to specific texts/repeat counts as part of that routine).
// This is a standalone tool: pick a phrase (or type your own), pick a
// target, tap to count. Nothing here is fetched from a network — it's pure
// local state — so there is no reliability/offline concern to design for.
// ============================================================================

import { escapeHtml } from "./html-utils.js";

const STORAGE_KEY = "tazawwud:tasbih";

const PHRASES = [
  { id: "subhanallah", arabic: "سُبْحَانَ اللَّهِ", translit: "SubhanAllah", translation: "Glory be to Allah" },
  { id: "alhamdulillah", arabic: "الْحَمْدُ لِلَّهِ", translit: "Alhamdulillah", translation: "All praise is due to Allah" },
  { id: "allahuakbar", arabic: "اللَّهُ أَكْبَرُ", translit: "Allahu Akbar", translation: "Allah is the Greatest" },
  { id: "lailahaillallah", arabic: "لَا إِلَٰهَ إِلَّا اللَّهُ", translit: "La ilaha illallah", translation: "There is no god but Allah" },
  { id: "astaghfirullah", arabic: "أَسْتَغْفِرُ اللَّهَ", translit: "Astaghfirullah", translation: "I seek forgiveness from Allah" },
  { id: "lahawla", arabic: "لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ", translit: "La hawla wala quwwata illa billah", translation: "There is no power nor strength except with Allah" },
  { id: "custom", arabic: "", translit: "Custom", translation: "Your own phrase" },
];

const TARGETS = [33, 99, 100, 0]; // 0 = no limit

const DEFAULT_STATE = {
  phraseId: "subhanallah",
  customText: "",
  target: 33,
  counts: {}, // { [phraseId]: currentCount }
  completedToday: {}, // { [phraseId]: { date: "YYYY-M-D", sets: N } }
};

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function readState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (stored && typeof stored === "object") {
      return { ...DEFAULT_STATE, ...stored, counts: stored.counts || {}, completedToday: stored.completedToday || {} };
    }
  } catch (error) {
    console.warn("[TAZAWWUD] Could not read Tasbih state:", error);
  }
  return { ...DEFAULT_STATE };
}

function writeState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("[TAZAWWUD] Could not save Tasbih state:", error);
  }
}

function vibrate(pattern) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Unsupported/denied — silently ignore, counting still works fine.
    }
  }
}

function currentPhrase(state) {
  return PHRASES.find((p) => p.id === state.phraseId) || PHRASES[0];
}

function setsCompletedToday(state, phraseId) {
  const entry = state.completedToday[phraseId];
  return entry && entry.date === localDateKey() ? entry.sets : 0;
}

function render(root, state) {
  const phrase = currentPhrase(state);
  const count = state.counts[state.phraseId] || 0;
  const target = state.target;
  const sets = setsCompletedToday(state, state.phraseId);
  const displayArabic = state.phraseId === "custom" ? state.customText : phrase.arabic;
  const displayLabel = state.phraseId === "custom" ? (state.customText || "Your own phrase") : phrase.translit;

  root.innerHTML = `
    <header class="tasbih-header">
      <h2 class="tasbih-header__title">Tasbih</h2>
      <p class="tasbih-header__subtitle">A simple dhikr counter. Taps are saved only on this device.</p>
    </header>

    <div class="tasbih-controls">
      <label for="tasbih-phrase-select">Phrase</label>
      <select id="tasbih-phrase-select" class="salah-select">
        ${PHRASES.map((p) => `<option value="${p.id}" ${p.id === state.phraseId ? "selected" : ""}>${escapeHtml(p.translit)}</option>`).join("")}
      </select>
      ${state.phraseId === "custom" ? `
        <input type="text" id="tasbih-custom-input" class="salah-select" placeholder="Type a phrase…" value="${escapeHtml(state.customText)}" maxlength="120" />
      ` : ""}

      <label for="tasbih-target-select">Target per set</label>
      <select id="tasbih-target-select" class="salah-select">
        ${TARGETS.map((t) => `<option value="${t}" ${t === target ? "selected" : ""}>${t === 0 ? "No limit" : t}</option>`).join("")}
      </select>
    </div>

    <div class="tasbih-display">
      ${displayArabic ? `<p class="tasbih-display__arabic" lang="ar" dir="rtl">${escapeHtml(displayArabic)}</p>` : ""}
      <p class="tasbih-display__label">${escapeHtml(displayLabel)}</p>
    </div>

    <button type="button" id="tasbih-tap-btn" class="tasbih-tap-btn" aria-label="Count">
      <span class="tasbih-tap-btn__count">${count}</span>
      ${target > 0 ? `<span class="tasbih-tap-btn__target">of ${target}</span>` : ""}
    </button>

    <div class="tasbih-footer">
      <p class="tasbih-footer__sets">${sets > 0 ? `${sets} set${sets === 1 ? "" : "s"} completed today` : ""}</p>
      <button type="button" id="tasbih-reset-btn" class="salah-button salah-button--secondary">Reset count</button>
    </div>
  `;

  root.querySelector("#tasbih-phrase-select").addEventListener("change", (event) => {
    state.phraseId = event.target.value;
    writeState(state);
    render(root, state);
  });

  root.querySelector("#tasbih-custom-input")?.addEventListener("input", (event) => {
    const value = event.target.value;
    state.customText = value;
    writeState(state);
    // Full re-render (keeps the Arabic-styled preview in sync), but restore
    // focus/cursor position so typing isn't interrupted.
    render(root, state);
    const input = root.querySelector("#tasbih-custom-input");
    if (input) {
      input.focus();
      input.setSelectionRange(value.length, value.length);
    }
  });

  root.querySelector("#tasbih-target-select").addEventListener("change", (event) => {
    state.target = Number(event.target.value);
    writeState(state);
    render(root, state);
  });

  root.querySelector("#tasbih-tap-btn").addEventListener("click", () => {
    const current = (state.counts[state.phraseId] || 0) + 1;
    if (state.target > 0 && current >= state.target) {
      state.counts[state.phraseId] = 0;
      const today = localDateKey();
      const existing = state.completedToday[state.phraseId];
      const sets = existing && existing.date === today ? existing.sets + 1 : 1;
      state.completedToday[state.phraseId] = { date: today, sets };
      vibrate([30, 60, 30, 60, 30]);
    } else {
      state.counts[state.phraseId] = current;
      vibrate(10);
    }
    writeState(state);
    render(root, state);
  });

  root.querySelector("#tasbih-reset-btn").addEventListener("click", () => {
    if (!window.confirm("Reset the current count to 0?")) return;
    state.counts[state.phraseId] = 0;
    writeState(state);
    render(root, state);
  });
}

export function initTasbih(root) {
  if (!root) return;
  const state = readState();
  render(root, state);
}
