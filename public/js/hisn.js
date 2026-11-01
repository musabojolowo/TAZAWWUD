// ============================================================================
// TAZAWWUD — Hisn al-Muslim (Fortress of the Muslim)
// ----------------------------------------------------------------------------
// A du'a / adhkar compilation by Sa'id bin Ali bin Wahf al-Qahtani. It is NOT
// a hadith collection, so it has its own module, its own data source and its
// own UI, and is deliberately kept out of the hadith reader (hadith.js only
// links to it).
//
// Source: wafaaelmaandy/Hisn-Muslim-Json (husn_en.json) — Arabic text with
// English meaning and transliteration, ~267 supplications in ~132 chapters.
// Served through jsDelivr (with a raw.githubusercontent.com fallback), the
// same CDN pattern the hadith module uses.
//
// No supplication text is written or edited in this app: everything shown is
// read from the source file at runtime. The parser below is tolerant about
// field names (the dataset's own keys are uppercase) and refuses to render
// anything if the file doesn't contain recognisable content, rather than
// showing a partial or garbled result.
// ============================================================================

import { fetchJsonWithFallback } from "./error-boundary.js";

// Branch names are tried in order. The repository's default branch is not
// verified, so both common names are included.
const SOURCES = [
  // Our own copy, served from this site. Source: OpenDua (CC BY 4.0). See the About page.
  "/data/hisn-duas.json",
];
const FETCH_TIMEOUT = 60000;

let cachedBook = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

/** Escapes, then turns line breaks into <br> so multi-line du'as keep their layout. */
function multiline(value) {
  return escapeHtml(String(value ?? "").trim()).replace(/\r?\n/g, "<br>");
}

function pick(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

// ----------------------------------------------------------------------------
// Data
// ----------------------------------------------------------------------------

/**
 * Turns the source file into [{ id, title, items: [{ arabic, transliteration,
 * translation, repeat }] }]. Throws if nothing recognisable is found.
 */
function normalizeBook(payload) {
  let categories = payload;
  if (!Array.isArray(categories)) {
    categories = Object.values(payload || {}).find(Array.isArray) || [];
  }

  const book = categories.map((category, index) => {
    const rawItems = pick(category, ["TEXT", "text", "items", "adhkar", "duas"]);
    const list = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
    const items = list
      .map((item) => (typeof item === "string" ? { ARABIC_TEXT: item } : item))
      .map((item) => ({
        arabic: String(pick(item, ["ARABIC_TEXT", "arabic", "ar", "text_ar"])),
        transliteration: String(pick(item, ["LANGUAGE_ARABIC_TRANSLATED_TEXT", "transliteration"])),
        translation: String(pick(item, ["TRANSLATED_TEXT", "translation", "english", "en", "text_en"])),
        repeat: Number(pick(item, ["REPEAT", "repeat"])) || 0,
      }))
      .filter((item) => item.arabic || item.translation);

    return {
      id: pick(category, ["ID", "id"]) || index + 1,
      title: String(pick(category, ["TITLE", "title", "name", "category"]) || `Chapter ${index + 1}`),
      items,
    };
  }).filter((category) => category.items.length > 0);

  if (!book.length) {
    throw new Error("Hisn al-Muslim source did not contain recognisable content.");
  }
  return book;
}

async function loadBook() {
  if (cachedBook) return cachedBook;

  let lastError = null;
  for (const url of SOURCES) {
    try {
      const result = await fetchJsonWithFallback(url, {
        cacheKey: "hisn:husn_en",
        timeout: FETCH_TIMEOUT,
        validate: (value) => Boolean(value) && typeof value === "object",
      });
      cachedBook = normalizeBook(result.data);
      return cachedBook;
    } catch (error) {
      lastError = error;
      console.warn(`[TAZAWWUD] Hisn al-Muslim source failed (${url}):`, error.message);
    }
  }
  throw lastError || new Error("Hisn al-Muslim is unavailable.");
}

// ----------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------

function backButton(id, label) {
  return `
    <button type="button" class="reader-back-btn" id="${id}">
      <span class="material-symbols-rounded icon" aria-hidden="true">arrow_back</span>
      ${label}
    </button>
  `;
}

/** The note at the bottom of this page has been removed. */
function attributionMarkup() {
  return "";
}

function renderLoading(container, meta, onBack) {
  container.innerHTML = `
    ${backButton("hisn-back", "All Collections")}
    <div class="hisn-status" role="status">Loading ${escapeHtml(meta.nameEn)}…</div>
  `;
  container.querySelector("#hisn-back")?.addEventListener("click", onBack);
}

function renderError(container, meta, onBack, onRetry) {
  container.innerHTML = `
    ${backButton("hisn-back", "All Collections")}
    <div class="hisn-status hisn-status--error" role="alert">
      <p>Couldn't load ${escapeHtml(meta.nameEn)} right now. Please check your connection and try again.</p>
      <button type="button" class="btn-retry">Retry</button>
    </div>
  `;
  container.querySelector("#hisn-back")?.addEventListener("click", onBack);
  container.querySelector(".btn-retry")?.addEventListener("click", onRetry);
}

function renderChapterList(container, meta, book, onBack, filter = "") {
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? book.filter((chapter) => chapter.title.toLowerCase().includes(needle))
    : book;

  container.innerHTML = `
    ${backButton("hisn-back", "All Collections")}
    <header class="hisn-header">
      <h2 class="hisn-header__title">
        <span class="hisn-header__ar" lang="ar" dir="rtl">${escapeHtml(meta.nameAr)}</span>
        ${escapeHtml(meta.nameEn)}
      </h2>
      <p class="hisn-header__sub">${book.length} chapters of supplications and remembrances</p>
    </header>
    <label class="surah-search" for="hisn-search">
      <span class="material-symbols-rounded icon" aria-hidden="true">search</span>
      <input type="search" id="hisn-search" placeholder="Search chapters…" autocomplete="off" value="${escapeHtml(filter)}" />
    </label>
    <ol class="hisn-chapters">
      ${visible.map((chapter) => `
        <li>
          <button type="button" class="hisn-chapter" data-id="${escapeHtml(chapter.id)}">
            <span class="hisn-chapter__title">${escapeHtml(chapter.title)}</span>
            <span class="hisn-chapter__count">${chapter.items.length}</span>
          </button>
        </li>
      `).join("") || `<li class="hisn-status">No chapters match "${escapeHtml(filter)}".</li>`}
    </ol>
    ${attributionMarkup()}
  `;

  container.querySelector("#hisn-back")?.addEventListener("click", onBack);

  const input = container.querySelector("#hisn-search");
  input?.addEventListener("input", () => {
    const value = input.value;
    renderChapterList(container, meta, book, onBack, value);
    const next = container.querySelector("#hisn-search");
    next?.focus();
    next?.setSelectionRange(value.length, value.length);
  });

  container.querySelectorAll(".hisn-chapter").forEach((button) => {
    button.addEventListener("click", () => {
      const chapter = book.find((entry) => String(entry.id) === button.dataset.id);
      if (chapter) renderChapter(container, meta, book, chapter, onBack, filter);
    });
  });
}

const LEVEL_KEY = "tazawwud:hisn-level";
const LEVELS = [
  { id: "arabic", label: "Arabic only" },
  { id: "translit", label: "Arabic and transliteration" },
  { id: "full", label: "Arabic, transliteration and translation" },
];

function readLevel() {
  const saved = globalThis.localStorage?.getItem(LEVEL_KEY);
  return LEVELS.some((l) => l.id === saved) ? saved : "full";
}

function levelSelect(current) {
  return `<label class="hisn-level">Reading level
    <select data-hisn-level>${LEVELS.map((l) => `<option value="${l.id}" ${l.id === current ? "selected" : ""}>${l.label}</option>`).join("")}</select>
  </label>`;
}

function renderChapter(container, meta, book, chapter, onBack, filter) {
  const level = readLevel();
  container.innerHTML = `
    ${backButton("hisn-back-chapters", "All Chapters")}
    <h3 class="hisn-chapter-heading">${escapeHtml(chapter.title)}</h3>
    ${levelSelect(level)}
    <div class="hisn-duas">
      ${chapter.items.map((item, index) => `
        <article class="hisn-dua">
          ${item.arabic ? `<p class="hisn-dua__arabic" lang="ar" dir="rtl">${multiline(item.arabic)}</p>` : ""}
          ${level !== "arabic" && item.transliteration ? `<p class="hisn-dua__translit">${multiline(item.transliteration)}</p>` : ""}
          ${level === "full" && item.translation ? `<p class="hisn-dua__translation">${multiline(item.translation)}</p>` : ""}
          <p class="hisn-dua__meta">
            <span>${index + 1} / ${chapter.items.length}</span>
            ${item.repeat > 1 ? `<span class="hisn-dua__repeat">Repeat ${item.repeat}×</span>` : ""}
            ${item.arabic ? `<button type="button" class="dhikr-listen-button" data-hisn-listen="${index}" aria-label="Listen to this dua">Listen</button>` : ""}
          </p>
        </article>
      `).join("")}
    </div>
    ${attributionMarkup()}
  `;
  container.querySelector("#hisn-back-chapters")?.addEventListener("click", () =>
    renderChapterList(container, meta, book, onBack, filter)
  );
  container.querySelector("[data-hisn-level]")?.addEventListener("change", (event) => {
    globalThis.localStorage?.setItem(LEVEL_KEY, event.target.value);
    renderChapter(container, meta, book, chapter, onBack, filter);
  });
  container.querySelectorAll("[data-hisn-listen]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = chapter.items[Number(button.dataset.hisnListen)];
      speakArabic(item?.arabic || "", button);
    });
  });
  container.scrollIntoView?.({ block: "start" });
}

/**
 * Reads the Arabic dua aloud with the phone's own Arabic voice. Free, and needs no recording.
 * If the phone has no Arabic voice, the button says so.
 */
function speakArabic(text, button) {
  if (!text || !("speechSynthesis" in window)) {
    button.textContent = "Not available";
    button.disabled = true;
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ar-SA";
  utterance.rate = 0.85;
  button.textContent = "Playing…";
  utterance.onend = () => { button.textContent = "Listen"; };
  utterance.onerror = () => { button.textContent = "Listen"; };
  window.speechSynthesis.speak(utterance);
}

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------

/**
 * Opens the Hisn al-Muslim section inside `container`.
 * @param {HTMLElement} container
 * @param {{nameAr: string, nameEn: string, onBack: () => void}} options
 */
export async function openHisnMuslim(container, { nameAr, nameEn, onBack }) {
  const meta = { nameAr, nameEn };
  renderLoading(container, meta, onBack);
  try {
    const book = await loadBook();
    renderChapterList(container, meta, book, onBack);
  } catch (error) {
    console.error("[TAZAWWUD] Hisn al-Muslim failed to load:", error);
    renderError(container, meta, onBack, () => openHisnMuslim(container, { nameAr, nameEn, onBack }));
  }
}
