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

const STYLE_HREF = "/css/pages-redesign.css";
let lastCompleted = false;
let confirmingReset = false;

function ensurePageStyles() {
  if (document.querySelector(`link[href="${STYLE_HREF}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  document.head.append(link);
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

/**
 * One tap on the counter. Returns true only when the target is reached, which is when the set is
 * completed and the count goes back to 0. With no limit (target 0), a tap never completes a set.
 */
export function applyTap(state, target, today = localDateKey()) {
  const current = (state.counts[state.phraseId] || 0) + 1;
  if (target > 0 && current >= target) {
    state.counts[state.phraseId] = 0;
    const existing = state.completedToday[state.phraseId];
    const sets = existing && existing.date === today ? existing.sets + 1 : 1;
    state.completedToday[state.phraseId] = { date: today, sets };
    return true;
  }
  state.counts[state.phraseId] = current;
  return false;
}

function currentPhrase(state) {
  return PHRASES.find((p) => p.id === state.phraseId) || PHRASES[0];
}

function setsCompletedToday(state, phraseId) {
  const entry = state.completedToday[phraseId];
  return entry && entry.date === localDateKey() ? entry.sets : 0;
}

function render(root, state) {
  ensurePageStyles();
  const phrase = currentPhrase(state);
  const count = state.counts[state.phraseId] || 0;
  const target = state.target;
  const sets = setsCompletedToday(state, state.phraseId);
  const displayArabic = state.phraseId === "custom" ? state.customText : phrase.arabic;
  const displayLabel = state.phraseId === "custom" ? (state.customText || "Your own phrase") : phrase.translit;
  const progress = target > 0 ? Math.min(1, count / target) : 0;
  const radius = 92;
  const circumference = 2 * Math.PI * radius;
  const dash = (circumference * progress).toFixed(2);

  root.innerHTML = `
    <section class="tb-hero">
      <h2 class="tb-title">Tasbih</h2>
    </section>

    <section class="tb-card tb-controls" aria-label="Phrase and target">
      <div class="tb-field">
        <label class="tb-label" for="tasbih-phrase-select">Phrase</label>
        <select id="tasbih-phrase-select" class="tb-select">
          ${PHRASES.map((p) => `<option value="${p.id}" ${p.id === state.phraseId ? "selected" : ""}>${escapeHtml(p.translit)}</option>`).join("")}
        </select>
      </div>
      ${state.phraseId === "custom" ? `
      <div class="tb-field">
        <label class="tb-label" for="tasbih-custom-input">Your phrase</label>
        <input type="text" id="tasbih-custom-input" class="tb-select" placeholder="Type a phrase…" value="${escapeHtml(state.customText)}" maxlength="120" />
      </div>` : ""}
      <div class="tb-field">
        <label class="tb-label" for="tasbih-target-select">Target per set</label>
        <select id="tasbih-target-select" class="tb-select">
          ${TARGETS.map((t) => `<option value="${t}" ${t === target ? "selected" : ""}>${t === 0 ? "No limit" : t}</option>`).join("")}
        </select>
      </div>
    </section>

    <section class="tb-dhikr" aria-label="Current dhikr">
      ${displayArabic ? `<p class="tb-dhikr__arabic" lang="ar" dir="rtl">${escapeHtml(displayArabic)}</p>` : ""}
      <p class="tb-dhikr__label">${escapeHtml(displayLabel)}</p>
      ${phrase.translation && state.phraseId !== "custom" ? `<p class="tb-dhikr__meaning">${escapeHtml(phrase.translation)}</p>` : ""}
    </section>

    <div class="tb-counter${lastCompleted ? " is-complete" : ""}">
      <svg class="tb-ring" viewBox="0 0 200 200" aria-hidden="true">
        <circle class="tb-ring__track" cx="100" cy="100" r="${radius}" />
        <circle class="tb-ring__progress" cx="100" cy="100" r="${radius}" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${(circumference - Number(dash)).toFixed(2)}" transform="rotate(-90 100 100)" />
      </svg>
      <button type="button" id="tasbih-tap-btn" class="tb-tap" aria-label="Count one. ${count} of ${target > 0 ? target : "no limit"} counted.">
        <span class="tb-tap__count">${count}</span>
        <span class="tb-tap__target">${target > 0 ? `of ${target}` : "no limit"}</span>
      </button>
    </div>

    <p class="tb-status" role="status">${lastCompleted ? "Target reached. Your count starts again from 0." : ""}</p>
    <p class="tb-sets">${sets > 0 ? `${sets} set${sets === 1 ? "" : "s"} completed today` : ""}</p>

    <section class="tb-reset">
      ${confirmingReset ? `
      <div class="tb-confirm" role="alertdialog" aria-label="Confirm reset">
        <p class="tb-confirm__text">Reset the current count to 0?</p>
        <div class="tb-confirm__buttons">
          <button type="button" class="tb-button tb-button--ghost" id="tasbih-cancel-reset">Cancel</button>
          <button type="button" class="tb-button tb-button--danger" id="tasbih-confirm-reset">Reset</button>
        </div>
      </div>` : `
      <button type="button" id="tasbih-reset-btn" class="tb-button tb-button--ghost">Reset count</button>`}
    </section>
  `;

  root.querySelector("#tasbih-phrase-select").addEventListener("change", (event) => {
    state.phraseId = event.target.value;
    lastCompleted = false;
    confirmingReset = false;
    writeState(state);
    render(root, state);
  });

  root.querySelector("#tasbih-custom-input")?.addEventListener("input", (event) => {
    const value = event.target.value;
    state.customText = value;
    writeState(state);
    render(root, state);
    const input = root.querySelector("#tasbih-custom-input");
    if (input) {
      input.focus();
      input.setSelectionRange(value.length, value.length);
    }
  });

  root.querySelector("#tasbih-target-select").addEventListener("change", (event) => {
    state.target = Number(event.target.value);
    lastCompleted = false;
    writeState(state);
    render(root, state);
  });

  root.querySelector("#tasbih-tap-btn").addEventListener("click", () => {
    const completed = applyTap(state, state.target);
    lastCompleted = completed;
    if (completed) vibrate([30, 60, 30, 60, 30]); // only when the target is reached
    writeState(state);
    render(root, state);
  });

  root.querySelector("#tasbih-reset-btn")?.addEventListener("click", () => {
    confirmingReset = true;
    render(root, state);
    root.querySelector("#tasbih-cancel-reset")?.focus();
  });

  root.querySelector("#tasbih-cancel-reset")?.addEventListener("click", () => {
    confirmingReset = false;
    render(root, state);
    root.querySelector("#tasbih-reset-btn")?.focus();
  });

  root.querySelector("#tasbih-confirm-reset")?.addEventListener("click", () => {
    state.counts[state.phraseId] = 0;
    lastCompleted = false;
    confirmingReset = false;
    writeState(state);
    render(root, state);
  });
}

export function initTasbih(root) {
  if (!root) return;
  const state = readState();
  render(root, state);
}
