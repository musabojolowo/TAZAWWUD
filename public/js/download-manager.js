// ============================================================================
// TAZAWWUD — Offline download manager (core logic)
// ----------------------------------------------------------------------------
// Downloads Qur'an text, Mushaf pages, Hadith collections and Qur'an audio so
// they work offline even if they were never opened before.
//
// This file has NO DOM, Firebase or network imports. Every side effect goes
// through the injected `deps`, so the same code runs in the browser (see
// downloads-ui.js) and in Node tests.
//
// Design:
//  - Downloaded items are the same cache entries the reader already uses
//    (IndexedDB, api-cache:* keys). Nothing is duplicated.
//  - A manifest (IndexedDB key "downloads:manifest") records each item only
//    after its data is confirmed in storage. Storage is the source of truth:
//    an item counts as downloaded only if its keys really exist.
//  - Jobs run items one at a time. The first failure stops the job and keeps
//    everything already saved. Retry resumes and skips recorded items.
//  - Audio lives in Cache Storage (tazawwud-offline-audio), which the service
//    worker already serves cache-first, so it plays offline with no change to
//    the player.
// ============================================================================

export const MANIFEST_KEY = "downloads:manifest";
export const SURAH_COUNT = 114;
export const PAGE_COUNT = 604;
const SHARED = "__shared__"; // surah index and Mushaf pages (translation-independent)

export function emptyManifest() {
  return { version: 1, shared: {}, quran: {}, hadith: {}, audio: {} };
}

function isManifest(value) {
  return Boolean(value) && typeof value === "object" && value.version === 1
    && value.shared && value.quran && value.hadith && value.audio;
}

function approxBytes(value) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

export class DownloadError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = "DownloadError";
    this.kind = kind; // "storage" | "network" | "offline"
  }
}

function classify(error) {
  if (error instanceof DownloadError) return error.kind;
  if (error?.name === "QuotaExceededError" || /quota/i.test(error?.message || "")) return "storage";
  return "network";
}

const FRIENDLY = {
  storage: "Not enough storage on this device. Free some space, then tap Retry.",
  offline: "You're offline. Connect to the internet to download.",
  network: "The download stopped because of a network or server problem. Tap Retry to continue; saved items are kept.",
};

function jobId(kind, id) {
  return `${kind}:${id}`;
}

export function createDownloadManager(deps) {
  // Pause, resume and cancel: one control per running job, checked between items.
  const controls = new Map();
  function controlFor(key) {
    if (!controls.has(key)) controls.set(key, { paused: false, cancelled: false, wake: null });
    return controls.get(key);
  }
  const { storage, quran, hadith, audio } = deps;
  const isOnline = deps.isOnline || (() => true);
  const notify = deps.onChange || (() => {});

  let manifest = null;
  let loading = null;
  const jobs = new Map();
  const running = new Set();

  function emit() {
    notify(summary());
  }

  function setJob(key, patch) {
    jobs.set(key, { ...(jobs.get(key) || { status: "idle", done: 0, total: 0, message: "" }), ...patch });
    emit();
  }

  async function load() {
    if (!loading) {
      loading = (async () => {
        const stored = await storage.get(MANIFEST_KEY);
        manifest = isManifest(stored) ? stored : emptyManifest();
        return manifest;
      })();
    }
    return loading;
  }

  async function persist() {
    await storage.put(MANIFEST_KEY, manifest); // throws on storage failure
  }

  async function verifyKeys(keys) {
    for (const key of keys) {
      if (!(await storage.has(key))) {
        throw new DownloadError("Could not confirm the data was saved offline.", "storage");
      }
    }
  }

  // ---------------------------------------------------------------- jobs ---

  async function runJob(kind, id, items) {
    await load();
    const key = jobId(kind, id);
    if (running.has(key)) return jobs.get(key);

    if (!isOnline()) {
      setJob(key, { status: "error", message: FRIENDLY.offline, errorKind: "offline" });
      return jobs.get(key);
    }

    running.add(key);
    const control = controlFor(key);
    let done = items.filter((item) => item.done()).length;
    setJob(key, { status: "running", done, total: items.length, message: "", errorKind: null });

    try {
      for (const item of items) {
        if (control.cancelled) break;
        // Pause waits here, between items, until resumed or cancelled.
        while (control.paused && !control.cancelled) {
          await new Promise((resolve) => { control.wake = resolve; });
        }
        if (control.cancelled) break;
        if (item.done()) continue;

        const result = await item.run();
        // Arrays also have a .keys() method, so only trust a real array of keys.
        const keys = Array.isArray(result?.keys) ? result.keys : (item.keys || []);
        await verifyKeys(keys);
        if (item.verify && !(await item.verify(result))) {
          throw new DownloadError(`Could not confirm ${item.id}.`, "network");
        }

        const before = JSON.stringify(manifest);
        item.commit(result);
        try {
          await persist();
        } catch (error) {
          manifest = JSON.parse(before); // never count an item that isn't stored
          throw new DownloadError("Not enough storage on this device.", "storage");
        }

        done += 1;
        setJob(key, { done });
      }
      if (control.cancelled) setJob(key, { status: "cancelled", message: "", errorKind: null });
      else setJob(key, { status: "complete", message: "", errorKind: null });
    } catch (error) {
      const errorKind = classify(error);
      console.warn(`[TAZAWWUD] Download ${key} stopped:`, error?.message);
      setJob(key, { status: "error", errorKind, message: error?.userMessage || FRIENDLY[errorKind] });
    } finally {
      running.delete(key);
      controls.delete(key);
    }
    return jobs.get(key);
  }

  // ---------------------------------------------------------- Qur'an text ---

  function quranItems(code) {
    const items = [
      {
        id: "index",
        keys: ["api-cache:quran:surah-index"],
        run: () => quran.fetchSurahList(),
        done: () => Boolean(manifest.shared.index),
        commit: (result) => { manifest.shared.index = { bytes: approxBytes(result) }; },
      },
    ];
    for (let n = 1; n <= SURAH_COUNT; n += 1) {
      items.push({
        id: `surah:${n}`,
        keys: [`api-cache:quran:surah:${n}:${code}`],
        run: () => quran.fetchSurahDetail(n, code),
        done: () => Boolean(manifest.quran[code]?.items?.[`surah:${n}`]),
        commit: (result) => {
          if (!manifest.quran[code]) manifest.quran[code] = { items: {} };
          manifest.quran[code].items[`surah:${n}`] = { bytes: approxBytes(result) };
        },
      });
    }
    for (let p = 1; p <= PAGE_COUNT; p += 1) {
      items.push({
        id: `page:${p}`,
        keys: [`api-cache:quran:page:${p}`],
        run: () => quran.fetchPage(p, code),
        done: () => Boolean(manifest.shared[`page:${p}`]),
        commit: (result) => { manifest.shared[`page:${p}`] = { bytes: approxBytes(result) }; },
      });
    }
    return items;
  }

  function startQuran(code) {
    return load().then(() => runJob("quran", code, quranItems(code)));
  }

  // -------------------------------------------------------------- Hadith ---

  function hadithItem(slug) {
    return {
      id: `collection:${slug}`,
      run: () => hadith.prefetch(slug),
      done: () => Boolean(manifest.hadith[slug]),
      commit: (result) => {
        manifest.hadith[slug] = { keys: result.keys, savedAt: Date.now() };
      },
    };
  }

  /** Downloads every collection in turn, as one job, so progress and pause or cancel cover the set. */
  function startAllHadith(slugs) {
    return load().then(() => runJob("hadith", "all", slugs.map((slug) => hadithItem(slug))));
  }

  function startHadith(slug) {
    return load().then(() => runJob("hadith", slug, [hadithItem(slug)]));
  }

  // --------------------------------------------------------------- Audio ---

  async function audioItems(reciterId, only) {
    const items = [];
    for (let n = 1; n <= SURAH_COUNT; n += 1) {
      if (only && !only.includes(n)) continue;
      const url = await audio.urlFor(reciterId, n);
      items.push({
        id: `audio:${n}`,
        run: async () => {
          await audio.save(url);
          return { keys: [], url, bytes: await audio.size(url) };
        },
        verify: (result) => audio.has(result.url),
        done: () => Boolean(manifest.audio[reciterId]?.items?.[String(n)]),
        commit: (result) => {
          if (!manifest.audio[reciterId]) manifest.audio[reciterId] = { items: {} };
          manifest.audio[reciterId].items[String(n)] = { url: result.url, bytes: result.bytes };
        },
      });
    }
    return items;
  }

  function startAudio(reciterId, only) {
    return load().then(async () => runJob("audio", reciterId, await audioItems(reciterId, only)));
  }

  // ------------------------------------------------------------- delete ---

  function quranKeyFor(id, code) {
    if (id === "index") return "api-cache:quran:surah-index";
    if (id.startsWith("page:")) return `api-cache:quran:page:${id.slice(5)}`;
    return `api-cache:quran:surah:${id.slice(6)}:${code}`;
  }

  async function deleteQuran(code) {
    await load();
    const bucket = manifest.quran[code];
    if (bucket) {
      for (const id of Object.keys(bucket.items)) await storage.delete(quranKeyFor(id, code));
      delete manifest.quran[code];
    }
    // The index and Mushaf pages are shared by every translation, so they go
    // only when no translation is left downloaded.
    if (Object.keys(manifest.quran).length === 0) {
      for (const id of Object.keys(manifest.shared)) await storage.delete(quranKeyFor(id, code));
      manifest.shared = {};
    }
    await persist();
    jobs.delete(jobId("quran", code));
    emit();
  }

  async function deleteHadith(slug) {
    await load();
    const entry = manifest.hadith[slug];
    if (entry) {
      for (const key of entry.keys) await storage.delete(key);
      delete manifest.hadith[slug];
    }
    await persist();
    jobs.delete(jobId("hadith", slug));
    emit();
  }

  async function deleteAudio(reciterId) {
    await load();
    const entry = manifest.audio[reciterId];
    if (entry) {
      for (const item of Object.values(entry.items)) await audio.remove(item.url);
      delete manifest.audio[reciterId];
    }
    await persist();
    jobs.delete(jobId("audio", reciterId));
    emit();
  }

  // ------------------------------------------------------------- status ---

  function summary() {
    const m = manifest || emptyManifest();
    const countOf = (obj, prefix) =>
      Object.keys(obj || {}).filter((k) => k.startsWith(prefix)).length;
    const quranByCode = {};
    for (const [code, bucket] of Object.entries(m.quran)) {
      quranByCode[code] = { surahs: countOf(bucket.items, "surah:"), total: SURAH_COUNT };
    }
    const audioByReciter = {};
    for (const [rid, bucket] of Object.entries(m.audio)) {
      audioByReciter[rid] = { surahs: Object.keys(bucket.items).length, total: SURAH_COUNT };
    }
    return {
      loaded: manifest !== null,
      shared: { index: Boolean(m.shared.index), pages: countOf(m.shared, "page:"), pagesTotal: PAGE_COUNT },
      quran: quranByCode,
      hadith: Object.fromEntries(Object.keys(m.hadith).map((slug) => [slug, true])),
      audio: audioByReciter,
      jobs: Object.fromEntries([...jobs].map(([key, job]) => [key, { ...job }])),
    };
  }

  /** Whether a surah's text is saved for this translation. */
  function isSurahDownloaded(code, surahNumber) {
    return Boolean(manifest?.quran[code]?.items?.[`surah:${surahNumber}`]);
  }

  /** Whether a Hadith collection is saved. */
  function isHadithDownloaded(slug) {
    return Boolean(manifest?.hadith[slug]);
  }


  function pauseJob(kind, id) {
    const key = jobId(kind, id);
    const control = controls.get(key);
    if (!control || control.cancelled) return;
    control.paused = true;
    setJob(key, { status: "paused" });
  }

  function resumeJob(kind, id) {
    const key = jobId(kind, id);
    const control = controls.get(key);
    if (!control || control.cancelled) return;
    control.paused = false;
    const wake = control.wake;
    control.wake = null;
    if (wake) wake();
    setJob(key, { status: "running" });
  }

  function cancelJob(kind, id) {
    const key = jobId(kind, id);
    const control = controls.get(key);
    if (!control) return;
    control.cancelled = true;
    control.paused = false;
    const wake = control.wake;
    control.wake = null;
    if (wake) wake();
    setJob(key, { status: "cancelled" });
  }

  return {
    load,
    summary,
    startQuran,
    startHadith,
    startAllHadith,
    startAudio,
    pauseJob,
    resumeJob,
    cancelJob,
    deleteQuran,
    deleteHadith,
    deleteAudio,
    isSurahDownloaded,
    isHadithDownloaded,
  };
}
