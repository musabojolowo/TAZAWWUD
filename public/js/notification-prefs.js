// ============================================================================
// TAZAWWUD — Notification preferences and schedule (Phase 1, local only)
// ----------------------------------------------------------------------------
// Pure logic: no DOM, no network. Used by notifications.js (prayer alerts on the
// Salah page) and reminders.js (the global scheduler), so both follow the same
// rules and never fire the same alert twice in a day.
//
// Storage:
//  - tazawwud:notification-prefs  — the new settings object (small, JSON)
//  - tazawwud:prayer-notifications-enabled — the old master switch. It is still
//    written, so existing behaviour and the Salah checkbox stay consistent.
//    It is read only when no new settings exist yet, and it is never deleted.
//  - tazawwud:notifications-fired — alert ids already shown today.
// ============================================================================

import { notificationPermissionGranted, showNativeAlert, syncNativeSchedule } from "./native-bridge.js";

export const PREFS_KEY = "tazawwud:notification-prefs";
export const LEGACY_MASTER_KEY = "tazawwud:prayer-notifications-enabled";
export const FIRED_KEY = "tazawwud:notifications-fired";

export const PRAYER_KEYS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const JUMUAH_LEAD_MINUTES = 60;
const DAY_MINUTES = 1440;

export function defaultPrefs(legacyMaster = null) {
  return {
    version: 1,
    master: legacyMaster === null ? true : legacyMaster,
    prayers: Object.fromEntries(PRAYER_KEYS.map((key) => [key, true])),
    offsetMinutes: 0,
    quran: { enabled: true, time: "20:00" },
    adhkar: { morningEnabled: true, eveningEnabled: true, minutesAfterPrayer: 15 },
    friday: { enabled: true, jumuahTime: null },
  };
}

/** Parses "HH:MM" or a prayer-time string such as "05:12 (CAT)" into minutes. */
export function parseMinute(value) {
  const match = String(value ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isBool(value) {
  return typeof value === "boolean";
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function validTime(value) {
  return typeof value === "string" && parseMinute(value) !== null ? value : null;
}

/**
 * Merges stored values over the defaults. Stored values that are present and
 * valid are kept exactly, so an existing choice is never overwritten. Anything
 * missing or invalid falls back to its default.
 */
export function mergePrefs(stored, legacyMaster = null) {
  const base = defaultPrefs(legacyMaster);
  if (!stored || typeof stored !== "object") return base;

  const prayers = { ...base.prayers };
  for (const key of PRAYER_KEYS) {
    if (isBool(stored.prayers?.[key])) prayers[key] = stored.prayers[key];
  }
  return {
    version: 1,
    master: isBool(stored.master) ? stored.master : base.master,
    prayers,
    offsetMinutes: clampInt(stored.offsetMinutes, -60, 60, base.offsetMinutes),
    quran: {
      enabled: isBool(stored.quran?.enabled) ? stored.quran.enabled : base.quran.enabled,
      time: validTime(stored.quran?.time) ?? base.quran.time,
    },
    adhkar: {
      morningEnabled: isBool(stored.adhkar?.morningEnabled) ? stored.adhkar.morningEnabled : base.adhkar.morningEnabled,
      eveningEnabled: isBool(stored.adhkar?.eveningEnabled) ? stored.adhkar.eveningEnabled : base.adhkar.eveningEnabled,
      minutesAfterPrayer: clampInt(stored.adhkar?.minutesAfterPrayer, 0, 120, base.adhkar.minutesAfterPrayer),
    },
    friday: {
      enabled: isBool(stored.friday?.enabled) ? stored.friday.enabled : base.friday.enabled,
      jumuahTime: validTime(stored.friday?.jumuahTime),
    },
  };
}

function readLegacyMaster(storage) {
  const value = storage.getItem(LEGACY_MASTER_KEY);
  if (value === null) return null;
  return value === "true";
}

export function loadPrefs(storage = localStorage) {
  let stored = null;
  let hasStored = false;
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (raw !== null) {
      stored = JSON.parse(raw);
      hasStored = true;
    }
  } catch {
    stored = null; // unreadable value: use defaults, do not throw
  }
  // The old master switch is used only when no new settings exist yet.
  const legacyMaster = hasStored ? null : readLegacyMaster(storage);
  return mergePrefs(stored, legacyMaster);
}

/** Saves a full settings object and keeps the old master switch in step. */
export function savePrefs(prefs, storage = localStorage) {
  const clean = mergePrefs(prefs);
  storage.setItem(PREFS_KEY, JSON.stringify(clean));
  storage.setItem(LEGACY_MASTER_KEY, String(clean.master));
  syncNativeSchedule();
  return clean;
}

/** Applies a partial change on top of the current saved settings. */
export function updatePrefs(patch, storage = localStorage) {
  const current = loadPrefs(storage);
  const next = {
    ...current,
    ...patch,
    prayers: { ...current.prayers, ...(patch.prayers || {}) },
    quran: { ...current.quran, ...(patch.quran || {}) },
    adhkar: { ...current.adhkar, ...(patch.adhkar || {}) },
    friday: { ...current.friday, ...(patch.friday || {}) },
  };
  return savePrefs(next, storage);
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * The alerts that are due today, as { id, minute, title, body, tag, url }.
 * An id includes its minute (for example "prayer:Fajr@310"), so the Salah page and
 * the global scheduler compute the same id for the same alert, and a changed time
 * or offset later in the day is a new alert. Returns nothing when the master
 * switch is off. Prayer-linked alerts need the day's timings; without them they
 * are skipped.
 */
export function buildSchedule(prefs, timings, now = new Date()) {
  if (!prefs.master) return [];
  const items = [];
  const minuteOf = (key) => parseMinute(timings?.[key]);
  const shift = (minute, by) => (minute + by + DAY_MINUTES * 2) % DAY_MINUTES;
  const add = (base, minute, fields) => items.push({ id: `${base}@${minute}`, minute, ...fields });

  for (const key of PRAYER_KEYS) {
    const minute = minuteOf(key);
    if (minute === null || !prefs.prayers[key]) continue;
    add(`prayer:${key}`, shift(minute, prefs.offsetMinutes), {
      title: `${key} - TAZAWWUD`,
      body: `It is time for ${key} prayer.`,
      tag: `tazawwud-prayer-${key}`,
      url: "/#salah",
    });
  }

  const fajr = minuteOf("Fajr");
  if (prefs.adhkar.morningEnabled && fajr !== null) {
    add("adhkar:morning", shift(fajr, prefs.adhkar.minutesAfterPrayer), {
      title: "Morning Adhkar - TAZAWWUD",
      body: "Time for your morning remembrance.",
      tag: "tazawwud-adhkar-morning",
      url: "/#dua",
    });
  }

  const asr = minuteOf("Asr");
  if (prefs.adhkar.eveningEnabled && asr !== null) {
    add("adhkar:evening", shift(asr, prefs.adhkar.minutesAfterPrayer), {
      title: "Evening Adhkar - TAZAWWUD",
      body: "Time for your evening remembrance.",
      tag: "tazawwud-adhkar-evening",
      url: "/#dua",
    });
  }

  if (prefs.quran.enabled) {
    add("quran", parseMinute(prefs.quran.time), {
      title: "Qur'an reading - TAZAWWUD",
      body: "Time for your daily Qur'an reading.",
      tag: "tazawwud-quran",
      url: "/#quran",
    });
  }

  // Friday reminder: only on Friday, only once a Jumu'ah time is set. With no
  // Jumu'ah time it is simply absent; the other alerts are not affected.
  const jumuah = parseMinute(prefs.friday.jumuahTime);
  const fridayMinute = jumuah === null ? null : jumuah - JUMUAH_LEAD_MINUTES;
  // Skip rather than wrap into the previous evening when Jumu'ah is very early.
  if (prefs.friday.enabled && fridayMinute !== null && fridayMinute >= 0 && now.getDay() === 5) {
    add("friday", fridayMinute, {
      title: "Jumu'ah reminder - TAZAWWUD",
      body: "Jumu'ah is in one hour. Prepare for the Friday prayer.",
      tag: "tazawwud-friday",
      url: "/#home",
    });
  }

  return items;
}

// Claims made this session. If localStorage is unavailable, this still stops the
// same alert from being shown twice.
const sessionClaims = new Set();

/**
 * Returns true the first time an alert id is claimed on a given day, and false
 * after that. This stops the Salah page and the global scheduler from showing
 * the same alert twice.
 */
export function claimOnce(id, now = new Date(), storage = localStorage) {
  const today = dateKey(now);
  const sessionKey = `${today}|${id}`;
  if (sessionClaims.has(sessionKey)) return false;
  sessionClaims.add(sessionKey);

  let state = { date: today, ids: [] };
  try {
    const raw = JSON.parse(storage.getItem(FIRED_KEY) || "null");
    if (raw && raw.date === today && Array.isArray(raw.ids)) state = raw;
  } catch {
    state = { date: today, ids: [] };
  }
  if (state.ids.includes(id)) return false;
  state.ids.push(id);
  try {
    storage.setItem(FIRED_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the session claim above still prevents a repeat.
  }
  return true;
}

/**
 * Shows an alert. Uses the service worker, so a tap on the alert reaches the
 * notificationclick handler in sw.js. Falls back to a page notification if the
 * service worker is not ready in time. Resolves to false if permission is absent.
 */
export async function displayAlert({ title, body, tag, url = "/#home" }) {
  if (!(await notificationPermissionGranted())) return false;
  if (await showNativeAlert({ title, body, tag, url })) return true;
  const options = { body, tag, icon: "/icons/icon-192.png", data: { url } };
  try {
    if (typeof navigator !== "undefined" && navigator.serviceWorker) {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (registration && typeof registration.showNotification === "function") {
        await registration.showNotification(title, options);
        return true;
      }
    }
  } catch (error) {
    console.warn("[TAZAWWUD] Service worker notification failed:", error?.message);
  }
  new Notification(title, options);
  return true;
}
