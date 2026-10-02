// ============================================================================
// TAZAWWUD - API Error Boundary and Fallbacks (Phase 14)
// ----------------------------------------------------------------------------
// Adds timeouts, cache-backed responses, friendly error reporting, and an
// explicitly labeled solar fallback for basic offline prayer estimates.
// ============================================================================

import { readStorage, writeStorage } from "./storage.js";

const DEFAULT_TIMEOUT = 10000;

export async function fetchJsonWithFallback(url, {
  cacheKey,
  fallback = null,
  timeout = DEFAULT_TIMEOUT,
  validate = (value) => value !== null,
} = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (!validate(payload)) throw new Error("Unexpected API response shape");
    if (cacheKey) writeStorage(`api-cache:${cacheKey}`, payload);
    return { data: payload, source: "network" };
  } catch (error) {
    const cached = cacheKey ? readStorage(`api-cache:${cacheKey}`, null) : null;
    if (cached && validate(cached)) {
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
