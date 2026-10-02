#!/usr/bin/env node

const API_BASE = "https://api.alquran.cloud/v1";
const PAGE_COUNT = 604;
const EXPECTED_AYAH_COUNT = 6236;
const CONCURRENCY = 3;
const MAX_RETRIES = 5;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchJson(url) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(url);
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await wait((Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000) * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
    const payload = await response.json();
    if (payload.code !== 200) throw new Error(`API code ${payload.code}: ${url}`);
    return payload.data;
  }
  throw new Error(`Retry limit exceeded: ${url}`);
}

async function mapWithConcurrency(items, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return output;
}

function reference(ayah) {
  return `${ayah.surah.number}:${ayah.numberInSurah}`;
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

async function main() {
  const errors = [];
  const [surahs, pages] = await Promise.all([
    fetchJson(`${API_BASE}/surah`),
    mapWithConcurrency(
      Array.from({ length: PAGE_COUNT }, (_, index) => index + 1),
      (page) => fetchJson(`${API_BASE}/page/${page}/quran-uthmani`)
    ),
  ]);

  assert(surahs.length === 114, `Expected 114 Surahs, received ${surahs.length}`, errors);
  const expectedBySurah = new Map(surahs.map((surah) => [surah.number, surah]));
  const ayahs = pages.flatMap((page) => page.ayahs);
  const seen = new Set();
  const seenGlobal = new Set();
  let previousGlobal = 0;
  let previousPage = 0;

  pages.forEach((page, pageIndex) => {
    const pageNumber = pageIndex + 1;
    assert(page.number === pageNumber, `Page response ${page.number} returned at ${pageNumber}`, errors);
    assert(page.ayahs.length > 0, `Page ${pageNumber} is empty`, errors);
    assert(pageNumber === previousPage + 1, `Page gap or overlap before page ${pageNumber}`, errors);
    previousPage = pageNumber;

    page.ayahs.forEach((ayah) => {
      const key = reference(ayah);
      assert(!seen.has(key), `Duplicate ayah reference ${key} on page ${pageNumber}`, errors);
      assert(ayah.page === pageNumber, `${key} reports page ${ayah.page}, expected ${pageNumber}`, errors);
      assert(expectedBySurah.has(ayah.surah.number), `${key} references unknown Surah`, errors);
      assert(ayah.number > previousGlobal, `Global ayah order breaks at ${key} (global ${ayah.number})`, errors);
      assert(!seenGlobal.has(ayah.number), `Duplicate global ayah number ${ayah.number}`, errors);
      seen.add(key);
      seenGlobal.add(ayah.number);
      previousGlobal = ayah.number;
    });
  });

  assert(ayahs.length === EXPECTED_AYAH_COUNT, `Expected ${EXPECTED_AYAH_COUNT} ayahs, received ${ayahs.length}`, errors);
  assert(seen.size === EXPECTED_AYAH_COUNT, `Expected ${EXPECTED_AYAH_COUNT} unique references, received ${seen.size}`, errors);
  assert(previousGlobal === EXPECTED_AYAH_COUNT, `Final global ayah is ${previousGlobal}, expected ${EXPECTED_AYAH_COUNT}`, errors);

  const perSurah = new Map();
  ayahs.forEach((ayah) => {
    if (!perSurah.has(ayah.surah.number)) perSurah.set(ayah.surah.number, []);
    perSurah.get(ayah.surah.number).push(ayah);
  });
  surahs.forEach((surah) => {
    const entries = perSurah.get(surah.number) || [];
    assert(entries.length === surah.numberOfAyahs, `Surah ${surah.number} count ${entries.length}, expected ${surah.numberOfAyahs}`, errors);
    entries.forEach((ayah, index) => {
      assert(ayah.numberInSurah === index + 1, `Surah ${surah.number} has ${reference(ayah)} at position ${index + 1}`, errors);
    });
  });

  const starts = surahs.map((surah) => {
    const entries = perSurah.get(surah.number) || [];
    const first = entries[0];
    const last = entries[entries.length - 1];
    return {
      number: surah.number,
      name: surah.name,
      englishName: surah.englishName,
      ayahCount: surah.numberOfAyahs,
      firstAyah: first ? reference(first) : null,
      firstPage: first?.page ?? null,
      lastPage: last?.page ?? null,
    };
  });

  const report = {
    source: "Al Quran Cloud API /v1/page/{page}/quran-uthmani",
    surahs: surahs.length,
    ayahs: ayahs.length,
    pages: pages.length,
    uniqueReferences: seen.size,
    errors,
    surahStarts: starts,
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = errors.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
