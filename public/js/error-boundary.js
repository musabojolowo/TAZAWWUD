// ============================================================================
// TAZAWWUD - API Error Boundary and Fallbacks (Phase 14)
// ----------------------------------------------------------------------------
// Adds timeouts, cache-backed responses, friendly error reporting, and an
// explicitly labeled solar fallback for basic offline prayer estimates.
// ============================================================================

import { readStorage, writeStorage } from "./storage.js";
import { cacheGet, cachePut, cacheDelete } from "./idb-cache.js";

const DEFAULT_TIMEOUT = 10000;

/**
 * Fetches a JSON API response with a timeout and validation.
 *
 * Caching (only when `cacheKey` is given):
 *  - persistent: false (default) — localStorage. Used for small responses
 *    (Salah, Calendar, Hisn) exactly as before.
 *  - persistent: true — IndexedDB via idb-cache.js. Used for large responses
 *    (Qur'an Surah/page JSON, tafsir, full Hadith editions). The write is
 *    awaited before returning, and a failed write never fails the request.
 *
 * On network failure, a cached copy is used only if it still passes
 * `validate`. Invalid persistent entries are deleted so they aren't re-read.
 */
export async function fetchJsonWithFallback(url, {
  cacheKey,
  persistent = false,
  fallback = null,
  timeout = DEFAULT_TIMEOUT,
  validate = (value) => value !== null,
} = {}) {
  const storageKey = cacheKey ? `api-cache:${cacheKey}` : null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (!validate(payload)) throw new Error("Unexpected API response shape");
    if (storageKey) {
      if (persistent) {
        await cachePut(storageKey, payload);
      } else {
        writeStorage(storageKey, payload);
      }
    }
    return { data: payload, source: "network" };
  } catch (error) {
    const cached = storageKey ? await readValidatedCache(storageKey, persistent, validate) : null;
    if (cached !== null) {
      console.warn(`[TAZAWWUD] Using cached API response for ${cacheKey}:`, error.message);
      return { data: cached, source: "cache", error };
    }
    if (fallback !== null && validate(fallback)) {
      console.warn(`[TAZAWWUD] Using static fallback for ${cacheKey || url}:`, error.message);
      return { data: fallback, source: "fallback", error };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Returns a cached value that still passes `validate`, or null. */
async function readValidatedCache(storageKey, persistent, validate) {
  if (!persistent) {
    const cached = readStorage(storageKey, null);
    return cached !== null && validate(cached) ? cached : null;
  }

  const entry = await cacheGet(storageKey);
  if (!entry) return null;
  if (validate(entry.value)) return entry.value;

  // Stored data no longer passes validation (corrupt, or written by an
  // older schema). Remove it so it isn't re-read on every offline visit.
  await cacheDelete(storageKey);
  return null;
}

export function renderFallbackNotice(root, message) {
  if (!root) return;
  const notice = document.createElement("p");
  notice.className = "fallback-notice";
  notice.setAttribute("role", "status");
  notice.textContent = message;
  root.prepend(notice);
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function solarDeclination(day) {
  return 23.45 * Math.sin((2 * Math.PI * (284 + day)) / 365) * Math.PI / 180;
}

function solarMinutes(latitude, longitude, date, altitude) {
  const radians = Math.PI / 180;
  const declination = solarDeclination(dayOfYear(date));
  const latitudeRad = latitude * radians;
  const cosine = (Math.sin(altitude * radians) - Math.sin(latitudeRad) * Math.sin(declination))
    / (Math.cos(latitudeRad) * Math.cos(declination));
  if (cosine < -1 || cosine > 1) return null;
  const hourAngle = Math.acos(cosine) / radians;
  const noon = 720 - (4 * longitude);
  return { sunrise: noon - (4 * hourAngle), sunset: noon + (4 * hourAngle), noon };
}

function formatMinutes(minutes) {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function estimatePrayerTimes(latitude, longitude, date = new Date()) {
  const solar = solarMinutes(latitude, longitude, date, -0.833);
  const twilight = solarMinutes(latitude, longitude, date, -18);
  if (!solar || !twilight) return null;

  const asr = solar.noon + (solar.sunset - solar.noon) * 0.55;
  return {
    Fajr: formatMinutes(twilight.sunrise),
    Dhuhr: formatMinutes(solar.noon),
    Asr: formatMinutes(asr),
    Maghrib: formatMinutes(solar.sunset),
    Isha: formatMinutes(twilight.sunset),
  };
}
