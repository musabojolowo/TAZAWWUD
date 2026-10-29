// ============================================================================
// TAZAWWUD — Offline downloads: storage adapters, badges and settings panel
// ----------------------------------------------------------------------------
// Connects download-manager.js to the browser:
//  - Qur'an text, Mushaf pages and Hadith collections -> IndexedDB (idb-cache.js)
//  - Qur'an audio -> Cache Storage bucket "tazawwud-offline-audio", which the
//    service worker already serves cache-first, so audio plays offline with no
//    change to the player. The service worker keeps this bucket on version
//    bumps (see sw.js activate).
//
// Heavy modules (quran.js, mushaf.js, hadith.js) are imported dynamically, so
// startup only loads the small manager and the badge observer.
// ============================================================================

import { cacheGet, cachePutOrThrow, cacheDelete } from "./idb-cache.js";
import { createDownloadManager } from "./download-manager.js";
import { escapeHtml } from "./html-utils.js";

const AUDIO_CACHE = "tazawwud-offline-audio";

let manager = null;
let latest = null;
let initPromise = null;
let mounted = null;
let badgeQueued = false;
let persistRequested = false;
const selection = { translationCode: null, reciterId: null };

const lazyQuran = () => import("./quran.js");
const lazyMushaf = () => import("./mushaf.js");
const lazyHadith = () => import("./hadith.js");

// ----------------------------------------------------------- storage ------

const idbStorage = {
  get: async (key) => (await cacheGet(key))?.value ?? null,
  put: (key, value) => cachePutOrThrow(key, value), // rejects on quota/abort
  delete: (key) => cacheDelete(key),
  has: async (key) => (await cacheGet(key)) !== null,
};

async function audioBucket() {
  return caches.open(AUDIO_CACHE);
}

// Exported so the Cache Storage adapter can be tested without a browser.
export const audioStorage = {
  urlFor: async (reciterId, surahNumber) => {
    const q = await lazyQuran();
    return q.buildSurahAudioUrl(q.getReciter(reciterId), surahNumber);
  },
  save: async (url) => {
    let response;
    try {
      response = await fetch(url, { mode: "cors" });
    } catch (error) {
      const failure = new Error(`Audio request failed: ${error.message}`);
      failure.userMessage = navigator.onLine === false
        ? "You're offline. Connect to the internet to download."
        : "This recitation couldn't be downloaded from its server. Try again later or choose another reciter.";
      throw failure;
    }
    if (!response.ok) throw new Error(`Audio request failed with HTTP ${response.status}`);
    const blob = await response.blob();
    const bucket = await audioBucket();
    // Throws QuotaExceededError when the device is full; the manager reports it.
    await bucket.put(url, new Response(blob, { headers: { "Content-Type": "audio/mpeg" } }));
  },
  size: async (url) => {
    const hit = await (await audioBucket()).match(url);
    return hit ? (await hit.blob()).size : 0;
  },
  has: async (url) => Boolean(await (await audioBucket()).match(url)),
  remove: async (url) => {
    await (await audioBucket()).delete(url);
  },
};

function getManager() {
  if (!manager) {
    manager = createDownloadManager({
      storage: idbStorage,
      quran: {
        fetchSurahList: async () => (await lazyQuran()).fetchSurahListForDownload(),
        fetchSurahDetail: async (n, code) => (await lazyQuran()).fetchSurahDetail(n, code),
        fetchPage: async (p, code) => (await lazyMushaf()).fetchPage(p, code),
      },
      hadith: {
        prefetch: async (slug) => (await lazyHadith()).prefetchHadithCollection(slug),
      },
      audio: audioStorage,
      isOnline: () => navigator.onLine !== false,
      onChange: (state) => {
        latest = state;
        scheduleBadges();
        renderPanel();
      },
    });
  }
  return manager;
}

let managerLoaded = null;

/** Loads the saved download state once, however many callers start a download. */
function ensureManagerLoaded() {
  if (!managerLoaded) managerLoaded = getManager().load();
  return managerLoaded;
}

/** Starts a Qur'an download for one translation. Used by the first-launch prompt. */
export async function startQuranDownload(code) {
  await ensureManagerLoaded();
  return getManager().startQuran(code);
}

/** Starts a Hadith collection download. Used by the first-launch prompt. */
export async function startHadithDownload(slug) {
  await ensureManagerLoaded();
  return getManager().startHadith(slug);
}

function requestPersistentStorageOnce() {
  if (persistRequested) return;
  persistRequested = true;
  navigator.storage?.persist?.().catch(() => {});
}

// ------------------------------------------------------------ badges ------

async function applyBadges() {
  if (!latest) return;
  const m = getManager();

  document.querySelectorAll("[data-dl-hadith]").forEach((el) => {
    el.dataset.offline = String(m.isHadithDownloaded(el.dataset.dlHadith));
  });

  if (document.querySelector("[data-dl-surah]")) {
    const q = await lazyQuran(); // already loaded: the surah list is on screen
    const code = q.getCurrentTranslationCode();
    document.querySelectorAll("[data-dl-surah]").forEach((el) => {
      el.dataset.offline = String(m.isSurahDownloaded(code, Number(el.dataset.dlSurah)));
    });
  }
}

function scheduleBadges() {
  if (badgeQueued) return;
  badgeQueued = true;
  queueMicrotask(() => {
    badgeQueued = false;
    applyBadges().catch((error) => console.warn("[TAZAWWUD] Badge update failed:", error));
  });
}

/** Call once at startup. Loads the manifest and keeps badges in sync as the
 *  Qur'an and Hadith lists are rendered. Only loads small modules. */
export function initDownloads() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await ensureManagerLoaded();
    latest = getManager().summary();
    const observer = new MutationObserver(scheduleBadges);
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleBadges();
  })();
  return initPromise;
}

// ------------------------------------------------------------- panel ------

function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

function jobLine(job) {
  if (!job) return "";
  if (job.status === "running") {
    return `<progress max="${job.total}" value="${job.done}" aria-label="Download progress"></progress>
      <p class="dl-note">Downloading… ${job.done} of ${job.total}. You can leave this open; saved items are kept.</p>`;
  }
  if (job.status === "paused") {
    return `<progress max="${job.total}" value="${job.done}" aria-label="Download progress"></progress>
      <p class="dl-note">Paused at ${job.done} of ${job.total}. Resume to continue, or cancel to stop.</p>`;
  }
  if (job.status === "cancelled") {
    return `<p class="dl-note">Cancelled. Items already saved are kept.</p>`;
  }
  if (job.status === "error") {
    return `<p class="dl-error" role="alert">${escapeHtml(job.message)}</p>`;
  }
  return "";
}

/** The 114 surah checkboxes for the audio picker. Names are filled in afterwards. */
function surahCheckboxes() {
  return Array.from({ length: 114 }, (_, i) => i + 1).map((n) => `<li class="dl-surah"><label class="dl-surah__label"><input type="checkbox" data-dl-surah="${n}" /><span class="dl-surah__num">${n}</span><span data-surah-name="${n}">Surah ${n}</span></label></li>`).join("");
}

async function fillSurahNames() {
  if (!document.querySelector("[data-surah-name]")) return;
  try {
    const list = await (await lazyQuran()).fetchSurahList();
    document.querySelectorAll("[data-surah-name]").forEach((node) => {
      const surah = list.find((item) => item.number === Number(node.dataset.surahName));
      if (surah) node.textContent = surah.englishName;
    });
  } catch (error) {
    // The names stay as numbers if the list is not available.
  }
}

function actionButtons(kind, id, { complete, partial }) {
  const key = `${kind}:${id}`;
  const job = manager ? manager.summary().jobs[key] : null;
  if (job?.status === "running" || job?.status === "paused") {
    const paused = job.status === "paused";
    return `<button type="button" class="dl-btn" data-dl-action="${paused ? "resume" : "pause"}" data-dl-id="${escapeHtml(key)}">${paused ? "Resume" : "Pause"}</button>
      <button type="button" class="dl-btn dl-btn--danger" data-dl-action="cancel" data-dl-id="${escapeHtml(key)}">Cancel</button>`;
  }
  if (complete) return `<button type="button" class="dl-btn dl-btn--danger" data-dl-action="del-${kind}" data-dl-id="${escapeHtml(id)}">Delete</button>`;
  const label = partial ? "Resume" : "Download";
  return `<button type="button" class="dl-btn" data-dl-action="dl-${kind}" data-dl-id="${escapeHtml(id)}">${label}</button>
    ${partial ? `<button type="button" class="dl-btn dl-btn--danger" data-dl-action="del-${kind}" data-dl-id="${escapeHtml(id)}">Delete</button>` : ""}`;
}

async function renderPanel() {
  if (!mounted || !latest) return;
  const q = await lazyQuran();
  const h = await lazyHadith();

  const code = selection.translationCode;
  const qStatus = latest.quran[code] || { surahs: 0, total: 114 };
  const sharedOk = latest.shared.index && latest.shared.pages === 604;
  const qComplete = qStatus.surahs === 114 && sharedOk;
  const qPartial = qStatus.surahs > 0 || latest.shared.pages > 0 || latest.shared.index;
  const qJob = latest.jobs[`quran:${code}`];
  const qRunning = qJob?.status === "running";

  const translationOptions = q.TRANSLATION_EDITIONS.map((t) =>
    `<option value="${escapeHtml(t.code)}" ${t.code === code ? "selected" : ""}>${escapeHtml(t.label)}</option>`).join("");

  const hadithRows = h.getHadithCollectionMeta().map((c) => {
    const downloaded = Boolean(latest.hadith[c.slug]);
    const job = latest.jobs[`hadith:${c.slug}`];
    const running = job?.status === "running";
    return `
      <li class="dl-row">
        <div class="dl-row__info">
          <span class="dl-row__name">${escapeHtml(c.nameEn)}</span>
          <span class="dl-status ${downloaded ? "is-downloaded" : "is-online"}">${downloaded ? "Downloaded" : "Online only"}</span>
        </div>
        <div class="dl-row__actions">${actionButtons("hadith", c.slug, { complete: downloaded, partial: false, running })}</div>
        ${jobLine(job)}
      </li>`;
  }).join("");

  const reciterId = selection.reciterId;
  const aStatus = latest.audio[reciterId] || { surahs: 0, total: 114 };
  const aComplete = aStatus.surahs === 114;
  const aJob = latest.jobs[`audio:${reciterId}`];
  const aRunning = aJob?.status === "running";
  const reciterOptions = q.RECITERS.map((r) =>
    `<option value="${escapeHtml(r.id)}" ${r.id === reciterId ? "selected" : ""}>${escapeHtml(r.label)}</option>`).join("");

  mounted.innerHTML = `
    <h3 class="settings-section__heading">Offline Downloads</h3>
    <p class="settings-note">
      Downloaded items work offline. Items marked <strong>Online only</strong> need a connection.
    </p>
    <p class="dl-storage" data-dl-storage></p>

    <div class="dl-group">
      <h4 class="dl-group__title">Qur'an text</h4>
      <label class="dl-label" for="dl-translation">Translation to download</label>
      <select id="dl-translation" class="salah-select" data-dl-change="translation">${translationOptions}</select>
      <p class="dl-status ${qComplete ? "is-downloaded" : "is-online"}">
        ${qComplete ? "Downloaded for this translation" : "Online only"}
      </p>
      <p class="dl-note">${qStatus.surahs}/114 surahs · ${latest.shared.pages}/604 Mushaf pages</p>
      ${jobLine(qJob)}
      <div class="dl-row__actions">${actionButtons("quran", code, { complete: qComplete, partial: qPartial && !qComplete, running: qRunning })}</div>
    </div>

    <div class="dl-group">
      <h4 class="dl-group__title">Hadith collections</h4>
      <ul class="dl-list">${hadithRows}</ul>
    </div>

    <div class="dl-group">
      <h4 class="dl-group__title">Qur'an audio</h4>
      <label class="dl-label" for="dl-reciter">Reciter</label>
      <select id="dl-reciter" class="salah-select" data-dl-change="reciter">${reciterOptions}</select>
      <p class="dl-status ${aComplete ? "is-downloaded" : "is-online"}">
        ${aComplete ? "Downloaded — all 114 surahs" : `${aStatus.surahs}/114 surahs downloaded`}
      </p>
      ${jobLine(aJob)}
      <details class="dl-picker">
        <summary class="dl-label">Choose surahs to download</summary>
        <div class="dl-row__actions">
          <button type="button" class="dl-btn" data-dl-pick="all">Select all</button>
          <button type="button" class="dl-btn" data-dl-pick="none">Clear</button>
        </div>
        <ul class="dl-surah-list">${surahCheckboxes()}</ul>
        <div class="dl-row__actions">
          <button type="button" class="dl-btn" data-dl-action="dl-audio-selected" data-dl-id="${escapeHtml(reciterId)}">Download selected</button>
        </div>
      </details>
      <div class="dl-row__actions">${actionButtons("audio", reciterId, { complete: aComplete, partial: aStatus.surahs > 0 && !aComplete })}</div>
      <p class="dl-note">Audio is large. Choose surahs above, or download all 114 on Wi-Fi with enough free space.</p>
    </div>
  `;
  refreshStorageLine();
  fillSurahNames();
}

async function refreshStorageLine() {
  const el = mounted?.querySelector("[data-dl-storage]");
  if (!el) return;
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  el.textContent = estimate?.quota
    ? `Device storage: ${formatMb(estimate.usage || 0)} used of ${formatMb(estimate.quota)}.`
    : "";
}

function onPanelClick(event) {
  const pick = event.target.closest("[data-dl-pick]");
  if (pick) {
    document.querySelectorAll("[data-dl-surah]").forEach((box) => { box.checked = pick.dataset.dlPick === "all"; });
    return;
  }
  const button = event.target.closest("[data-dl-action]");
  if (!button || button.disabled) return;
  const { dlAction: action, dlId: id } = button.dataset;
  const m = getManager();
  requestPersistentStorageOnce();

  if (action === "dl-quran") m.startQuran(selection.translationCode);
  if (action === "del-quran" && window.confirm("Delete the downloaded Qur'an text for this translation?")) {
    m.deleteQuran(selection.translationCode);
  }
  if (action === "dl-hadith") m.startHadith(id);
  if (action === "del-hadith" && window.confirm("Delete this downloaded Hadith collection?")) {
    m.deleteHadith(id);
  }
  if (action === "dl-audio") m.startAudio(id);
  if (action === "dl-audio-selected") {
    const chosen = [...document.querySelectorAll("[data-dl-surah]:checked")].map((box) => Number(box.dataset.dlSurah));
    if (chosen.length) m.startAudio(id, chosen);
  }
  if (action === "pause" || action === "resume" || action === "cancel") {
    const [kind, ...rest] = id.split(":");
    const realId = rest.join(":");
    if (action === "pause") m.pauseJob(kind, realId);
    if (action === "resume") m.resumeJob(kind, realId);
    if (action === "cancel") m.cancelJob(kind, realId);
  }
  if (action === "del-audio" && window.confirm("Delete all downloaded audio for this reciter?")) {
    m.deleteAudio(id);
  }
}

function onPanelChange(event) {
  const kind = event.target.dataset.dlChange;
  if (kind === "translation") selection.translationCode = event.target.value;
  if (kind === "reciter") selection.reciterId = event.target.value;
  renderPanel();
  scheduleBadges();
}

/** Renders the Offline Downloads section into the settings sidebar. Safe to
 *  call on every open; listeners are attached once per container. */
export async function mountDownloadsPanel(container) {
  if (!container) return;
  await initDownloads();
  if (mounted !== container) {
    mounted = container;
    container.addEventListener("click", onPanelClick);
    container.addEventListener("change", onPanelChange);
  }
  if (!selection.translationCode || !selection.reciterId) {
    const q = await lazyQuran();
    selection.translationCode = selection.translationCode || q.getCurrentTranslationCode();
    selection.reciterId = selection.reciterId || q.RECITERS[0].id;
  }
  latest = getManager().summary();
  renderPanel();
}
