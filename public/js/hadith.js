// ============================================================================
// TAZAWWUD — Hadith Module (Phase 6: Multi-Collection Hadith System)
// ----------------------------------------------------------------------------
// Free data source, no key: fawazahmed0/hadith-api, served statically via
// jsDelivr CDN — the same CDN pattern already used for tafsir. Confirmed
// live during development (real fetches, not assumed):
//   - Edition text/grades:  /editions/{lang}-{book}.min.json
//   - Per-hadith:           /editions/{lang}-{book}/{hadithnumber}.json
//   - Collection metadata:  /info.json (per-book chapter names, counts —
//     this file is very large across ALL books combined, so it is never
//     fetched whole; per-book chapter/section names are instead read from
//     the SAME full-edition fetch used for hadith text, via its embedded
//     `metadata.sections` map — one request serves both text and chapters).
//
// FETCH STRATEGY (deliberate, given real file sizes):
// A full collection (e.g. all of Sahih al-Bukhari) is genuinely large —
// thousands of hadiths. Rather than a lightweight-but-incomplete partial
// fetch, this loads one collection's full English + Arabic text ONCE when
// the user opens it, caches it in memory, and does zero further network
// calls while browsing chapters or hadiths within that collection —
// mirroring the same fetch-once-cache-forever pattern already proven for
// Qur'an Surahs. The tradeoff (a heavier first load per collection) is
// stated plainly in the loading UI rather than hidden.
//
// SEARCH SCOPE (honest limitation): true search across ALL collections at
// once would mean pre-downloading everything, which isn't practical for a
// free-tier PWA. Search here operates on whichever collection is currently
// selected in the search scope dropdown — instant if already opened this
// session, one fetch if not. This is "search across collections" in the
// sense of being able to pick and search any of them, not a single
// pre-built global index.
// ============================================================================

import { fetchJsonWithFallback } from "./error-boundary.js";
import { escapeHtml } from "./html-utils.js";

const FAWAZAHMED0_BASE = "https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1";
// Routed through jsDelivr's GitHub proxy (not raw.githubusercontent.com
// directly) — jsDelivr reliably serves permissive CORS headers for browser
// fetch(), which is the same proven, working pattern already used for the
// fawazahmed0 source and for tafsir. raw.githubusercontent.com's CORS
// behavior is less consistent for this kind of direct client-side fetch,
// so this sidesteps that risk entirely rather than debating it.
const AHMEDBASET_BASE = "https://cdn.jsdelivr.net/gh/A7med3bdulBaset/hadith-json@v1.2.0/db/by_book";

/**
 * Collections shown in the grid, from TWO free/keyless sources, clearly
 * marked by confidence level:
 *
 * source: "fawazahmed0" — CONFIRMED via live fetches during development
 * (editions.json content directly inspected). Has real grades (Sahih/
 * Hasan/Da'if) embedded per hadith.
 *
 * source: "ahmedbaset" — this second dataset (AhmedBaset/hadith-json on
 * GitHub, also free/keyless) explicitly documents covering these
 * collections and its data shape was confirmed (an {id, chapterId,
 * bookId, arabic, english:{narrator,text}} record). BUT the exact
 * filename for each book below `db/by_book/{category}/` was only
 * directly confirmed for Riyad as-Salihin ("RyadSalihin.json", matching
 * a folder name seen in the repo's own docs) and Nawawi's 40 (unused
 * here since fawazahmed0 already covers it) — the rest are best-effort
 * filenames, not individually verified live. If wrong, that collection
 * shows the normal error/retry state rather than breaking anything else.
 * This dataset also has NO grade field at all (different schema), so
 * grade notes explain that the source has no grading for these collections —
 * an honest gap, not a bug.
 *
 * Hisn al-Muslim is NOT in this list: it is a du'a compilation, not a hadith
 * collection, so it lives in its own module (hisn.js) and is linked from the
 * grid as a separate section.
 */
const COLLECTIONS = [
  // --- Confirmed (fawazahmed0) ---
  { slug: "bukhari", nameAr: "صحيح البخاري", nameEn: "Sahih al-Bukhari", author: "Imam Muhammad al-Bukhari", approxCount: 7563, source: "fawazahmed0", abbr: "B", color: "#E15B5B" },
  { slug: "muslim", nameAr: "صحيح مسلم", nameEn: "Sahih Muslim", author: "Imam Muslim ibn al-Hajjaj", approxCount: 7500, source: "fawazahmed0", abbr: "M", color: "#D6588F" },
  { slug: "abudawud", nameAr: "سنن أبي داود", nameEn: "Sunan Abu Dawud", author: "Imam Abu Dawud as-Sijistani", approxCount: 5274, source: "fawazahmed0", abbr: "AD", color: "#4A7FD6" },
  { slug: "tirmidhi", nameAr: "جامع الترمذي", nameEn: "Jami' at-Tirmidhi", author: "Imam Abu Isa at-Tirmidhi", approxCount: 3956, source: "fawazahmed0", abbr: "T", color: "#3AB5C6" },
  { slug: "nasai", nameAr: "سنن النسائي", nameEn: "Sunan an-Nasa'i", author: "Imam Ahmad an-Nasa'i", approxCount: 5758, source: "fawazahmed0", abbr: "N", color: "#5B6BC0" },
  { slug: "ibnmajah", nameAr: "سنن ابن ماجه", nameEn: "Sunan Ibn Majah", author: "Imam Muhammad ibn Majah", approxCount: 4341, source: "fawazahmed0", abbr: "IM", color: "#3BA98C" },
  { slug: "malik", nameAr: "موطأ مالك", nameEn: "Muwatta Malik", author: "Imam Malik ibn Anas", approxCount: 1720, source: "fawazahmed0", abbr: "MM", color: "#4CAF7D" },
  { slug: "nawawi", nameAr: "الأربعون النووية", nameEn: "Collections of Forty (Nawawi)", author: "Imam Yahya an-Nawawi", approxCount: 42, source: "fawazahmed0", abbr: "CF", color: "#C9A227" },
  { slug: "qudsi", nameAr: "الأربعون القدسية", nameEn: "Forty Hadith Qudsi", author: "Compiled — sacred narrations", approxCount: 40, source: "fawazahmed0", abbr: "QF", color: "#B08D57" },
  { slug: "dehlawi", nameAr: "أربعون الشاه ولي الله", nameEn: "Forty Hadith of Shah Waliullah", author: "Shah Waliullah Dehlawi", approxCount: 40, source: "fawazahmed0", abbr: "DF", color: "#8D6E63" },

  // --- ahmedbaset dataset (db/by_book). Each entry lists candidate filenames, tried in order ---
  { slug: "ahmed", nameAr: "مسند أحمد", nameEn: "Musnad Ahmad", author: "Imam Ahmad ibn Hanbal", approxCount: 4376, source: "ahmedbaset", category: "the_9_books", files: ["ahmed"], abbr: "MA", color: "#7E57C2" },
  { slug: "riyadussalihin", nameAr: "رياض الصالحين", nameEn: "Riyad us Saliheen", author: "Imam Yahya an-Nawawi", approxCount: 1896, source: "ahmedbaset", category: "other_books", files: ["RyadSalihin", "riyad_assalihin"], abbr: "RS", color: "#AFA939" },
  { slug: "shamail", nameAr: "الشمائل المحمدية", nameEn: "Shamail Muhammadiyah", author: "Imam Abu Isa at-Tirmidhi", approxCount: 417, source: "ahmedbaset", category: "other_books", files: ["shamail_muhammadiyah", "shamail"], abbr: "SM", color: "#E0A030" },
  { slug: "adab", nameAr: "الأدب المفرد", nameEn: "Al-Adab Al-Mufrad", author: "Imam Muhammad al-Bukhari", approxCount: 1322, source: "ahmedbaset", category: "other_books", files: ["aladab_almufrad", "adab"], abbr: "AM", color: "#6FA83B" },
  { slug: "bulugh", nameAr: "بلوغ المرام", nameEn: "Bulugh Al Maram", author: "Ibn Hajar al-Asqalani", approxCount: 1611, source: "ahmedbaset", category: "other_books", files: ["bulugh_almaram", "bulugh"], abbr: "BM", color: "#E0735A" },
  { slug: "mishkat", nameAr: "مشكاة المصابيح", nameEn: "Mishkat al-Masabih", author: "Waliuddin Muhammad al-Tabrizi", approxCount: 4627, source: "ahmedbaset", category: "other_books", files: ["mishkat_almasabih", "mishkat"], abbr: "MK", color: "#9E9E9E" },
];

/** Hisn al-Muslim: a separate du'a section, deliberately not part of COLLECTIONS. */
const HISN_META = { nameAr: "حصن المسلم", nameEn: "Hisn al-Muslim", author: "Sa'id bin Ali al-Qahtani", abbr: "HM", color: "#C77B4A" };

/** In-memory cache of fully-loaded collections. */
const cachedCollections = new Map();

// ----------------------------------------------------------------------------
// Data fetching
// ----------------------------------------------------------------------------

// Full collections are multi-megabyte JSON files (Sahih al-Bukhari alone is
// several MB per language). The shared helper's default 10s timeout aborted
// those on any ordinary mobile connection, which surfaced as the generic
// "Couldn't load..." error even though the source was fine.
const HADITH_FETCH_TIMEOUT = 90000;

/**
 * Tries each candidate URL in order and returns the first good response.
 * Each attempt still goes through fetchJsonWithFallback (timeout, shape
 * validation, cached copy if one exists). Throws the last error only if
 * every candidate fails.
 */
async function fetchFirstAvailable(urls, options) {
  let lastError = null;
  for (const url of urls) {
    try {
      return await fetchJsonWithFallback(url, { timeout: HADITH_FETCH_TIMEOUT, ...options });
    } catch (error) {
      lastError = error;
      console.warn(`[TAZAWWUD] Hadith source failed (${url}):`, error.message);
    }
  }
  throw lastError || new Error("No hadith source available");
}

async function fetchEdition(editionName) {
  const path = `editions/${editionName}.min.json`;
  const result = await fetchFirstAvailable(
    [
      `${FAWAZAHMED0_BASE}/${path}`,
      // Same repository, different host, in case the CDN copy is unavailable.
      `https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/${path}`,
    ],
    {
      cacheKey: `hadith:edition:${editionName}`,
      persistent: true,
      // Full editions are multi-megabyte, so they're cached in IndexedDB
      // (persistent: true), not localStorage. A cache write failure never
      // breaks loading; it only means this edition isn't available offline.
      validate: (value) => Boolean(value) && Array.isArray(value.hadiths),
    }
  );
  return result.data;
}

/** Loads a collection from fawazahmed0 (English + Arabic, has real grades). */
async function loadFawazahmed0Collection(meta) {
  const [englishEdition, arabicEdition] = await Promise.all([
    fetchEdition(`eng-${meta.slug}`),
    fetchEdition(`ara-${meta.slug}`).catch((error) => {
      console.error(`[TAZAWWUD] Arabic edition failed for ${meta.slug}, continuing English-only:`, error);
      return null;
    }),
  ]);

  const sectionNames = englishEdition.metadata?.sections || {};
  const arabicHadithsByNumber = new Map();
  if (arabicEdition) {
    arabicEdition.hadiths.forEach((h) => arabicHadithsByNumber.set(h.hadithnumber, h));
  }

  const hadithsByChapter = new Map();
  const chapterOrder = [];

  englishEdition.hadiths.forEach((h) => {
    const chapterNum = h.reference?.book;
    const arabicMatch = arabicHadithsByNumber.get(h.hadithnumber);

    const merged = {
      hadithnumber: h.hadithnumber,
      chapterNumber: chapterNum,
      numberInChapter: h.reference?.hadith,
      english: h.text,
      arabic: arabicMatch?.text ?? null,
      grades: h.grades || [],
    };

    if (!hadithsByChapter.has(chapterNum)) {
      hadithsByChapter.set(chapterNum, []);
      chapterOrder.push(chapterNum);
    }
    hadithsByChapter.get(chapterNum).push(merged);
  });

  chapterOrder.sort((a, b) => a - b);

  const chapters = chapterOrder.map((num) => ({
    number: num,
    name: sectionNames[String(num)] || `Chapter ${num}`,
    hadithCount: hadithsByChapter.get(num).length,
  }));

  // A collection "provides grading" only if at least one narration carries a grade.
  const gradingProvided = [...hadithsByChapter.values()].some((list) => list.some((h) => h.grades.length > 0));
  hadithsByChapter.forEach((list) => list.forEach((h) => { h.gradingProvided = gradingProvided; }));

  return {
    totalHadiths: englishEdition.metadata?.length ?? englishEdition.hadiths.length,
    chapters,
    hadithsByChapter,
    gradingProvided,
  };
}

/**
 * Loads a collection from the AhmedBaset/hadith-json dataset. No separate
 * grade field exists in this schema, and no chapter-name map is available
 * (only numeric chapterId), so chapters render as "Chapter N" — a real,
 * disclosed limitation of this second source, not a bug.
 */
async function loadAhmedbasetCollection(meta) {
  // Filenames come from the dataset's own db/by_book layout; a short candidate
  // list guards against naming differences between dataset versions.
  const urls = meta.files.flatMap((file) => [
    `${AHMEDBASET_BASE}/${meta.category}/${file}.json`,
    `https://raw.githubusercontent.com/A7med3bdulBaset/hadith-json/v1.2.0/db/by_book/${meta.category}/${file}.json`,
  ]);
  const result = await fetchFirstAvailable(urls, {
    cacheKey: `hadith:ahmedbaset:${meta.slug}`,
    persistent: true,
    validate: (value) => Array.isArray(value) || Array.isArray(value?.hadiths) || Array.isArray(value?.data),
  });
  const payload = result.data;
  const list = Array.isArray(payload) ? payload : payload.hadiths || payload.data;
  if (!Array.isArray(list)) {
    throw new Error(`Unexpected response shape for "${meta.slug}".`);
  }

  const hadithsByChapter = new Map();
  const chapterOrder = [];
  const chapterCounters = new Map();

  list.forEach((h) => {
    const chapterNum = h.chapterId ?? 0;
    const countSoFar = (chapterCounters.get(chapterNum) || 0) + 1;
    chapterCounters.set(chapterNum, countSoFar);

    const merged = {
      hadithnumber: h.id,
      chapterNumber: chapterNum,
      numberInChapter: countSoFar,
      english: h.english?.text ?? "Translation unavailable.",
      arabic: h.arabic ?? null,
      grades: [], // this dataset doesn't carry grading data
      gradingProvided: false,
    };

    if (!hadithsByChapter.has(chapterNum)) {
      hadithsByChapter.set(chapterNum, []);
      chapterOrder.push(chapterNum);
    }
    hadithsByChapter.get(chapterNum).push(merged);
  });

  chapterOrder.sort((a, b) => a - b);

  const chapters = chapterOrder.map((num) => ({
    number: num,
    name: `Chapter ${num}`,
    hadithCount: hadithsByChapter.get(num).length,
  }));

  return {
    totalHadiths: list.length,
    chapters,
    hadithsByChapter,
    gradingProvided: false,
  };
}

/**
 * Loads a full collection (whichever source it's from), builds the chapter
 * index, and caches everything in memory. Safe to call repeatedly.
 */
async function loadCollection(slug) {
  if (cachedCollections.has(slug)) {
    return cachedCollections.get(slug);
  }

  const meta = COLLECTIONS.find((c) => c.slug === slug);
  const result =
    meta.source === "ahmedbaset" ? await loadAhmedbasetCollection(meta) : await loadFawazahmed0Collection(meta);

  const full = { slug, ...result };
  cachedCollections.set(slug, full);
  return full;
}

/**
 * Downloads everything one collection needs, using the same editions and
 * cache keys the reader uses. Returns the storage keys it depends on so the
 * download manager can confirm they were really saved.
 *
 * A missing Arabic edition (HTTP 404) is tolerated, because the reader also
 * continues English-only in that case. Any other failure (network, timeout,
 * storage) throws, so the download is not marked complete.
 */
export async function prefetchHadithCollection(slug) {
  const meta = COLLECTIONS.find((c) => c.slug === slug);
  if (!meta) throw new Error(`Unknown Hadith collection: ${slug}`);

  if (meta.source === "ahmedbaset") {
    await loadAhmedbasetCollection(meta);
    return { keys: [`api-cache:hadith:ahmedbaset:${slug}`] };
  }

  await fetchEdition(`eng-${slug}`);
  const keys = [`api-cache:hadith:edition:eng-${slug}`];
  try {
    await fetchEdition(`ara-${slug}`);
    keys.push(`api-cache:hadith:edition:ara-${slug}`);
  } catch (error) {
    if (!/HTTP 404/.test(error.message)) throw error;
    console.warn(`[TAZAWWUD] No Arabic edition for ${slug}; saving English only.`);
  }
  return { keys };
}

/** Collection list for the offline-download UI (no data is loaded). */
export function getHadithCollectionMeta() {
  return COLLECTIONS.map((c) => ({ slug: c.slug, nameEn: c.nameEn, nameAr: c.nameAr }));
}

// ----------------------------------------------------------------------------
// Rendering: Collections Grid
// ----------------------------------------------------------------------------

function renderCollectionCard(collection) {
  return `
    <li class="hadith-collection-card" data-slug="${collection.slug}" data-dl-hadith="${collection.slug}" tabindex="0" role="button" aria-label="Open ${collection.nameEn}">
      <div class="hadith-collection-card__badge" style="background-color: ${collection.color};">${collection.abbr}</div>
      <span class="hadith-collection-card__name-en">${collection.nameEn}</span>
      <span class="hadith-collection-card__name-ar" lang="ar" dir="rtl">${collection.nameAr}</span>
      <span class="hadith-collection-card__count" data-role="count">
        <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">menu_book</span>
        ~${collection.approxCount.toLocaleString()} Ahadith
      </span>
    </li>
  `;
}

function renderCollectionsGrid(container) {
  container.innerHTML = `
    <h3 class="hadith-section-heading">All Books</h3>
    <ul class="hadith-collections-grid">
      ${COLLECTIONS.map(renderCollectionCard).join("")}
    </ul>
    <h3 class="hadith-section-heading">Du'a &amp; Adhkar</h3>
    <ul class="hadith-collections-grid">
      <li class="hadith-collection-card" data-hisn tabindex="0" role="button" aria-label="Open ${HISN_META.nameEn}">
        <div class="hadith-collection-card__badge" style="background-color: ${HISN_META.color};">${HISN_META.abbr}</div>
        <span class="hadith-collection-card__name-en">${HISN_META.nameEn}</span>
        <span class="hadith-collection-card__name-ar" lang="ar" dir="rtl">${HISN_META.nameAr}</span>
        <span class="hadith-collection-card__count">
          <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">auto_stories</span>
          Du'a compilation
        </span>
      </li>
    </ul>
  `;

  const hisnCard = container.querySelector("[data-hisn]");
  hisnCard?.addEventListener("click", openHisn);
  hisnCard?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openHisn();
    }
  });

  container.querySelectorAll(".hadith-collection-card").forEach((card) => {
    const meta = COLLECTIONS.find((c) => c.slug === card.dataset.slug);
    card.addEventListener("click", () => openCollection(card.dataset.slug));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openCollection(card.dataset.slug);
      }
    });
  });
}

/** Updates a collection card's displayed count once the real figure is known. */
function updateCollectionCount(slug, realCount) {
  const card = document.querySelector(`.hadith-collection-card[data-slug="${slug}"] [data-role="count"]`);
  if (card) card.textContent = `${realCount.toLocaleString()} narrations`;
}

// ----------------------------------------------------------------------------
// Rendering: Chapter List (within an opened collection)
// ----------------------------------------------------------------------------

function renderChapterList(container, collectionMeta, collectionInfo) {
  container.innerHTML = `
    <div class="hadith-book-header">
      <button type="button" class="reader-back-btn" id="hadith-back-to-collections">
        <span class="material-symbols-rounded icon" aria-hidden="true">arrow_back</span>
        All Collections
      </button>
      <div class="hadith-book-header__title">
        <span class="hadith-book-header__name-ar" lang="ar" dir="rtl">${escapeHtml(collectionMeta.nameAr)}</span>
        <h2 class="hadith-book-header__name-en">${escapeHtml(collectionMeta.nameEn)}</h2>
        <p class="hadith-book-header__meta">${escapeHtml(collectionMeta.author)} · ${collectionInfo.totalHadiths.toLocaleString()} narrations · ${collectionInfo.chapters.length} chapters</p>
        ${collectionInfo.gradingProvided === false ? GRADING_NOTE : ""}
      </div>
    </div>

    <ul class="hadith-chapter-list">
      ${collectionInfo.chapters
        .map(
          (ch) => `
        <li class="hadith-chapter-card" data-chapter="${ch.number}" tabindex="0" role="button" aria-label="Open chapter ${ch.number}: ${escapeHtml(ch.name)}">
          <span class="hadith-chapter-card__number">${ch.number}</span>
          <div class="hadith-chapter-card__body">
            <span class="hadith-chapter-card__name">${escapeHtml(ch.name)}</span>
            <span class="hadith-chapter-card__count">${ch.hadithCount} narrations</span>
          </div>
          <span class="material-symbols-rounded icon hadith-chapter-card__chevron" aria-hidden="true">chevron_right</span>
        </li>
      `
        )
        .join("")}
    </ul>
  `;

  container.querySelector("#hadith-back-to-collections")?.addEventListener("click", () => {
    renderCollectionsGrid(container);
    document.getElementById("hadith-search-wrapper")?.removeAttribute("hidden");
  });

  container.querySelectorAll(".hadith-chapter-card").forEach((card) => {
    card.addEventListener("click", () =>
      openChapter(container, collectionMeta, collectionInfo, Number(card.dataset.chapter))
    );
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openChapter(container, collectionMeta, collectionInfo, Number(card.dataset.chapter));
      }
    });
  });
}

// ----------------------------------------------------------------------------
// Rendering: Hadith List (within an opened chapter)
// ----------------------------------------------------------------------------

const GRADE_TONE = {
  sahih: "grade--sahih",
  "sahih al-bukhari": "grade--sahih",
  "sahih muslim": "grade--sahih",
  hasan: "grade--hasan",
  "hasan sahih": "grade--hasan",
  daif: "grade--daif",
  weak: "grade--daif",
};

function gradeToneClass(gradeText) {
  const key = (gradeText || "").toLowerCase().trim();
  for (const [needle, cls] of Object.entries(GRADE_TONE)) {
    if (key.includes(needle)) return cls;
  }
  return "grade--other";
}

const GRADING_NOTE = `<p class="hadith-grading-note">This collection's source does not include grading, so no grades are shown for its narrations.</p>`;

function renderGradeBadges(grades, gradingProvided = true) {
  // The whole collection has no grading in its source: the header explains
  // this once, so individual cards show nothing here.
  if (gradingProvided === false) return "";
  if (!grades || grades.length === 0) {
    // The collection grades some narrations, but not this one.
    return `<span class="hadith-grade-badge grade--other">Not graded in this source</span>`;
  }
  // Show the first grader prominently; the rest are available on tap.
  const primary = grades[0];
  const extra = grades.slice(1);

  return `
    <span class="hadith-grade-badge ${gradeToneClass(primary.grade)}" ${
    extra.length ? `tabindex="0" role="button" aria-label="Show all grader opinions"` : ""
  } data-role="grade-primary">
      ${escapeHtml(primary.grade)}${primary.name ? ` — ${escapeHtml(primary.name)}` : ""}
      ${extra.length ? `<span class="hadith-grade-badge__more">+${extra.length}</span>` : ""}
    </span>
    ${
      extra.length
        ? `<div class="hadith-grade-detail" hidden>
            ${extra.map((g) => `<div class="hadith-grade-detail__row"><span class="${gradeToneClass(g.grade)} hadith-grade-dot"></span>${escapeHtml(g.name || "Grader")}: ${escapeHtml(g.grade)}</div>`).join("")}
          </div>`
        : ""
    }
  `;
}

function renderHadithCard(hadith) {
  return `
    <div class="hadith-card" id="hadith-${hadith.hadithnumber}">
      <div class="hadith-card__top">
        <span class="hadith-card__number">
          <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">history_edu</span>
          #${hadith.numberInChapter ?? hadith.hadithnumber} <span class="hadith-card__global-number">(global #${hadith.hadithnumber})</span>
        </span>
        <div class="hadith-card__grades">${renderGradeBadges(hadith.grades, hadith.gradingProvided)}</div>
      </div>
      ${
        hadith.arabic
          ? `<p class="hadith-card__arabic" lang="ar" dir="rtl">${escapeHtml(hadith.arabic)}</p>`
          : `<p class="hadith-card__arabic-unavailable">Arabic text unavailable for this narration.</p>`
      }
      <p class="hadith-card__english">${escapeHtml(hadith.english)}</p>
    </div>
  `;
}

function renderHadithList(container, collectionMeta, collectionInfo, chapter) {
  const hadiths = collectionInfo.hadithsByChapter.get(chapter.number) || [];

  container.innerHTML = `
    <div class="hadith-book-header">
      <button type="button" class="reader-back-btn" id="hadith-back-to-chapters">
        <span class="material-symbols-rounded icon" aria-hidden="true">arrow_back</span>
        ${escapeHtml(collectionMeta.nameEn)} — Chapters
      </button>
      <div class="hadith-book-header__title">
        <h2 class="hadith-book-header__name-en">${escapeHtml(chapter.name)}</h2>
        <p class="hadith-book-header__meta">Chapter ${chapter.number} · ${hadiths.length} narrations</p>
        ${collectionInfo.gradingProvided === false ? GRADING_NOTE : ""}
      </div>
    </div>

    <div class="hadith-list">
      ${hadiths.map(renderHadithCard).join("")}
    </div>
  `;

  container.querySelector("#hadith-back-to-chapters")?.addEventListener("click", () => {
    renderChapterList(container, collectionMeta, collectionInfo);
  });

  wireGradeToggles(container);
}

function wireGradeToggles(container) {
  container.querySelectorAll('.hadith-grade-badge[role="button"]').forEach((badge) => {
    badge.addEventListener("click", () => {
      const detail = badge.parentElement.querySelector(".hadith-grade-detail");
      if (detail) detail.hidden = !detail.hidden;
    });
    badge.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        badge.click();
      }
    });
  });
}

// ----------------------------------------------------------------------------
// Loading / error states
// ----------------------------------------------------------------------------

function renderLoadingState(container, message) {
  container.innerHTML = `
    <div class="hadith-loading-state">
      <span class="material-symbols-rounded icon icon--lg icon--spin" aria-hidden="true">progress_activity</span>
      <p>${message}</p>
    </div>
  `;
}

function renderErrorState(container, message, onRetry) {
  container.innerHTML = `
    <div class="state-message state-message--error">
      <span class="material-symbols-rounded icon icon--lg" aria-hidden="true">error</span>
      <p>${message}</p>
      <button type="button" class="btn-retry">Retry</button>
    </div>
  `;
  container.querySelector(".btn-retry")?.addEventListener("click", onRetry);
}

// ----------------------------------------------------------------------------
// Navigation
// ----------------------------------------------------------------------------

let hadithRootRef = null;

/** Opens the separate Hisn al-Muslim section (own module, own data source). */
async function openHisn() {
  const container = hadithRootRef;
  if (!container) return;
  document.getElementById("hadith-search-wrapper")?.setAttribute("hidden", "");
  const goBack = () => {
    renderCollectionsGrid(container);
    document.getElementById("hadith-search-wrapper")?.removeAttribute("hidden");
  };
  try {
    const { openHisnMuslim } = await import("/js/hisn.js");
    await openHisnMuslim(container, { nameAr: HISN_META.nameAr, nameEn: HISN_META.nameEn, onBack: goBack });
  } catch (error) {
    console.error("[TAZAWWUD] Could not open Hisn al-Muslim:", error);
    goBack();
  }
}

async function openCollection(slug) {
  const container = hadithRootRef;
  if (!container) return;

  const meta = COLLECTIONS.find((c) => c.slug === slug);

  renderLoadingState(
    container,
    `Loading ${meta.nameEn}… this collection is large, so the first open may take a moment. It's cached after that.`
  );
  document.getElementById("hadith-search-wrapper")?.setAttribute("hidden", "");

  try {
    const info = await loadCollection(slug);
    updateCollectionCount(slug, info.totalHadiths);
    renderChapterList(container, meta, info);
  } catch (error) {
    console.error(`[TAZAWWUD] Failed to load collection ${slug}:`, error);
    renderErrorState(container, `Couldn't load ${meta.nameEn}. Please check your connection and try again.`, () =>
      openCollection(slug)
    );
  }
}

function openChapter(container, collectionMeta, collectionInfo, chapterNumber) {
  const chapter = collectionInfo.chapters.find((c) => c.number === chapterNumber);
  if (!chapter) return;
  renderHadithList(container, collectionMeta, collectionInfo, chapter);
}

// ----------------------------------------------------------------------------
// Search
// ----------------------------------------------------------------------------

function renderSearchResults(container, query, results, scopeSlug) {
  const scopeMeta = COLLECTIONS.find((c) => c.slug === scopeSlug);

  container.innerHTML = `
    <div class="hadith-book-header">
      <button type="button" class="reader-back-btn" id="hadith-back-from-search">
        <span class="material-symbols-rounded icon" aria-hidden="true">arrow_back</span>
        All Collections
      </button>
      <div class="hadith-book-header__title">
        <h2 class="hadith-book-header__name-en">Search: "${escapeHtml(query)}"</h2>
        <p class="hadith-book-header__meta">${results.length} result${results.length === 1 ? "" : "s"} in ${escapeHtml(scopeMeta.nameEn)}</p>
      </div>
    </div>
    <div class="hadith-list">
      ${
        results.length
          ? results.map(renderHadithCard).join("")
          : `<p class="hadith-empty-state">No narrations matched "${escapeHtml(query)}" in ${escapeHtml(scopeMeta.nameEn)}. Try another collection or keyword.</p>`
      }
    </div>
  `;

  container.querySelector("#hadith-back-from-search")?.addEventListener("click", () => {
    renderCollectionsGrid(container);
    document.getElementById("hadith-search-wrapper")?.removeAttribute("hidden");
  });

  wireGradeToggles(container);
}

async function runSearch(container, query, scopeSlug) {
  renderLoadingState(container, `Searching ${COLLECTIONS.find((c) => c.slug === scopeSlug).nameEn}…`);

  try {
    const info = await loadCollection(scopeSlug);
    updateCollectionCount(scopeSlug, info.totalHadiths);

    const needle = query.toLowerCase();
    const allHadiths = Array.from(info.hadithsByChapter.values()).flat();
    const results = allHadiths.filter(
      (h) => h.english.toLowerCase().includes(needle) || (h.arabic && h.arabic.includes(query))
    );

    renderSearchResults(container, query, results, scopeSlug);
  } catch (error) {
    console.error(`[TAZAWWUD] Search failed for ${scopeSlug}:`, error);
    renderErrorState(container, `Couldn't search ${scopeSlug} right now. Please try again.`, () =>
      runSearch(container, query, scopeSlug)
    );
  }
}

function renderSearchBar() {
  return `
    <div class="hadith-search-bar">
      <label class="surah-search" for="hadith-search-input">
        <span class="material-symbols-rounded icon" aria-hidden="true">search</span>
        <input type="search" id="hadith-search-input" placeholder="Search a collection's narrations…" autocomplete="off" />
      </label>
      <label class="select-pill">
        <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">menu_book</span>
        <select id="hadith-search-scope">
          ${COLLECTIONS.map((c) => `<option value="${c.slug}">${c.nameEn}</option>`).join("")}
        </select>
      </label>
    </div>
  `;
}

function wireSearchBar(container) {
  const input = document.getElementById("hadith-search-input");
  const scopeSelect = document.getElementById("hadith-search-scope");
  if (!input || input.dataset.wired) return;
  input.dataset.wired = "true";

  let debounceTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 3) return; // avoid firing a full-collection load on 1-2 chars
    debounceTimer = setTimeout(() => {
      runSearch(container, query, scopeSelect.value);
    }, 500);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(debounceTimer);
      const query = input.value.trim();
      if (query) runSearch(container, query, scopeSelect.value);
    }
  });
}

// ----------------------------------------------------------------------------
// Public entry point
// ----------------------------------------------------------------------------

/**
 * Mounts the Hadith section: search bar + Collections Grid.
 * @param {HTMLElement} container the view's root element
 */
export function initHadithSection(container) {
  if (!container) return;
  hadithRootRef = container;
  renderCollectionsGrid(container);

  const searchWrapper = document.getElementById("hadith-search-wrapper");
  if (searchWrapper && !searchWrapper.dataset.built) {
    searchWrapper.dataset.built = "true";
    searchWrapper.innerHTML = renderSearchBar();
    wireSearchBar(container);
  }
  searchWrapper?.removeAttribute("hidden");
}
