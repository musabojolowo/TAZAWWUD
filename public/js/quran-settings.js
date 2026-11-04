// ============================================================================
// TAZAWWUD - Quran reading settings sheet.
// Settings are saved on the device, and applied to the Quran pages straight away.
// Word by word, tajweed and Mushaf type are shown as "coming soon": their data
// is not yet available.
// ============================================================================

const KEYS = {
  view: "tazawwud:quran-view",
  arabic: "tazawwud:quran-arabic-size",
  translationSize: "tazawwud:quran-translation-size",
  showTranslation: "tazawwud:quran-show-translation",
  showTafsir: "tazawwud:quran-show-tafsir",
  translation: "tazawwud:quran-translation",
};

const DEFAULTS = {
  view: "surah",
  arabic: 28,
  translationSize: 14,
  showTranslation: true,
  showTafsir: true,
};

const VIEWS = [
  { id: "surah", label: "Surah" },
  { id: "page", label: "Page" },
  { id: "juz", label: "Juz" },
  { id: "hizb", label: "Hizb" },
  { id: "ruku", label: "Ruku" },
];

function readNumber(key, fallback, min, max) {
  const value = Number(globalThis.localStorage?.getItem(key));
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function readBool(key, fallback) {
  const value = globalThis.localStorage?.getItem(key);
  return value === null ? fallback : value === "1";
}

export function readQuranSettings() {
  const storage = globalThis.localStorage;
  const view = storage?.getItem(KEYS.view);
  return {
    view: VIEWS.some((v) => v.id === view) ? view : DEFAULTS.view,
    arabic: readNumber(KEYS.arabic, DEFAULTS.arabic, 20, 40),
    translationSize: readNumber(KEYS.translationSize, DEFAULTS.translationSize, 12, 20),
    showTranslation: readBool(KEYS.showTranslation, DEFAULTS.showTranslation),
    showTafsir: readBool(KEYS.showTafsir, DEFAULTS.showTafsir),
    translation: storage?.getItem(KEYS.translation) || "",
  };
}

function saveQuranSetting(key, value) {
  try {
    globalThis.localStorage?.setItem(KEYS[key], typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  } catch {
    // storage blocked: the setting still applies for this visit
  }
}

/** Applies the saved settings to the whole document. Safe to call often. */
export function applyQuranSettings() {
  const s = readQuranSettings();
  const root = document.documentElement;
  root.style.setProperty("--quran-arabic-size", `${s.arabic}px`);
  root.style.setProperty("--quran-translation-size", `${s.translationSize}px`);
  document.body.classList.toggle("quran-hide-translation", !s.showTranslation);
  document.body.classList.toggle("quran-hide-tafsir", !s.showTafsir);
  return s;
}

/**
 * Opens the settings sheet. `translations` is the list of translation editions
 * offered (passed in so this module does not import the reader).
 */
export function openQuranSettings(options = {}) {
  const { translations = [], reciters = [], currentTranslation, currentReciter, onTranslationChange, onReciterChange } = options;
  if (document.querySelector(".quran-sheet-overlay")) return;
  const s = readQuranSettings();
  const translationValue = currentTranslation || translations[0]?.code;
  const overlay = document.createElement("div");
  overlay.className = "quran-sheet-overlay";
  overlay.innerHTML = `
    <div class="quran-sheet" role="dialog" aria-modal="true" aria-labelledby="quran-sheet-title">
      <div class="quran-sheet__head">
        <h2 id="quran-sheet-title">Reading settings</h2>
        <button type="button" class="quran-chip" data-sheet-close>Done</button>
      </div>

      <fieldset class="quran-sheet__group">
        <legend>View</legend>
        ${VIEWS.map((v) => `<label class="quran-sheet__option"><input type="radio" name="quran-view" value="${v.id}" ${s.view === v.id ? "checked" : ""}/> ${v.label}</label>`).join("")}
      </fieldset>

      <fieldset class="quran-sheet__group">
        <legend>Content</legend>
        <label class="quran-sheet__option"><input type="checkbox" checked disabled /> Arabic <span>(always on)</span></label>
        <label class="quran-sheet__option"><input type="checkbox" data-setting="showTranslation" ${s.showTranslation ? "checked" : ""}/> Translation</label>
        <label class="quran-sheet__option"><input type="checkbox" data-setting="showTafsir" ${s.showTafsir ? "checked" : ""}/> Tafsir</label>
        <label class="quran-sheet__option quran-sheet__option--soon"><input type="checkbox" disabled /> Word by word <span>Coming soon</span></label>
        <label class="quran-sheet__option quran-sheet__option--soon"><input type="checkbox" disabled /> Tajweed <span>Coming soon</span></label>
      </fieldset>

      <fieldset class="quran-sheet__group">
        <legend>Reciter</legend>
        <select data-setting="reciter" aria-label="Reciter">
          ${reciters.map((r) => `<option value="${r.id}" ${r.id === currentReciter ? "selected" : ""}>${r.label}</option>`).join("")}
        </select>
      </fieldset>

      <fieldset class="quran-sheet__group">
        <legend>Translation</legend>
        <select data-setting="translation" aria-label="Translation">
          ${translations.map((t) => `<option value="${t.code}" ${t.code === translationValue ? "selected" : ""}>${t.label}</option>`).join("")}
        </select>
      </fieldset>

      <fieldset class="quran-sheet__group">
        <legend>Font</legend>
        <label class="quran-sheet__range">Arabic size <input type="range" min="20" max="40" step="1" value="${s.arabic}" data-setting="arabic" /> <output>${s.arabic}</output></label>
        <label class="quran-sheet__range">Translation size <input type="range" min="12" max="20" step="1" value="${s.translationSize}" data-setting="translationSize" /> <output>${s.translationSize}</output></label>
        <label class="quran-sheet__option quran-sheet__option--soon"><input type="radio" disabled /> Mushaf type <span>Coming soon</span></label>
      </fieldset>
    </div>`;
  document.body.append(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-sheet-close]")) close();
  });
  overlay.addEventListener("change", (event) => {
    const el = event.target;
    if (el.name === "quran-view") saveQuranSetting("view", el.value);
    if (el.dataset.setting === "translation") {
      if (onTranslationChange) onTranslationChange(el.value);
      return;
    }
    if (el.dataset.setting === "reciter") {
      if (onReciterChange) onReciterChange(el.value);
      return;
    }
    if (el.dataset.setting) {
      const key = el.dataset.setting;
      if (el.type === "checkbox") saveQuranSetting(key, el.checked);
      else if (el.type === "range") {
        el.nextElementSibling.textContent = el.value;
        saveQuranSetting(key, Number(el.value));
      } else saveQuranSetting(key, el.value);
      applyQuranSettings();
    }
  });
  overlay.addEventListener("input", (event) => {
    const el = event.target;
    if (el.type === "range" && el.dataset.setting) {
      el.nextElementSibling.textContent = el.value;
      saveQuranSetting(el.dataset.setting, Number(el.value));
      applyQuranSettings();
    }
  });
  document.addEventListener("keydown", function onKey(event) {
    if (event.key === "Escape" && overlay.isConnected) {
      close();
      document.removeEventListener("keydown", onKey);
    }
  });
}
