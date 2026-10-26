// ============================================================================
// TAZAWWUD - Prayer tracker (phone only)
// ----------------------------------------------------------------------------
// Records which of the five daily prayers have been prayed, per day, on this
// phone. Nothing is sent anywhere, and no sign-in is needed. Sunrise is not
// tracked. Only the last 60 days are kept.
// ============================================================================

export const TRACKED_PRAYERS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];
const STORE_KEY = "tazawwud:tracker:v1";
const KEEP_DAYS = 60;

/** Local date as YYYY-MM-DD, so a prayer belongs to the day it is prayed in. */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function readAll(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(storage, data) {
  try {
    storage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    // storage full or blocked: the tick simply isn't kept
  }
}

function trim(data) {
  const keys = Object.keys(data).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete data[key];
  return data;
}

/** The five ticks for one day: { Fajr: true|false, ... }. Missing days are all false. */
export function getDayStatus(storage, date = new Date()) {
  const day = readAll(storage)[dayKey(date)] || {};
  return Object.fromEntries(TRACKED_PRAYERS.map((p) => [p, day[p] === true]));
}

/** Ticks or unticks one prayer for a day. Unknown prayer names are ignored. */
export function setPrayed(storage, date, prayer, prayed = true) {
  if (!TRACKED_PRAYERS.includes(prayer)) return getDayStatus(storage, date);
  const data = readAll(storage);
  const key = dayKey(date);
  data[key] = { ...(data[key] || {}), [prayer]: Boolean(prayed) };
  writeAll(storage, trim(data));
  return getDayStatus(storage, date);
}

/** Ticks all five prayers for a day ("Mark all as prayed"). */
export function markAllPrayed(storage, date = new Date()) {
  const data = readAll(storage);
  const key = dayKey(date);
  data[key] = Object.fromEntries(TRACKED_PRAYERS.map((p) => [p, true]));
  writeAll(storage, trim(data));
  return getDayStatus(storage, date);
}

/** How many of the five prayers are ticked for a day: 0 to 5. */
export function countPrayed(status) {
  return TRACKED_PRAYERS.filter((p) => status[p] === true).length;
}

/** The last seven days, oldest first: [{ date: "YYYY-MM-DD", count: 0-5 }]. */
export function lastSevenDays(storage, today = new Date()) {
  const out = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push({ date: dayKey(d), count: countPrayed(getDayStatus(storage, d)) });
  }
  return out;
}

/**
 * The streak: how many days in a row have all five prayers ticked, counting back from today.
 * If today is not finished yet, the streak counts from yesterday, so it only breaks after a missed day.
 */
export function currentStreak(storage, today = new Date()) {
  const day = new Date(today);
  if (countPrayed(getDayStatus(storage, day)) !== TRACKED_PRAYERS.length) {
    day.setDate(day.getDate() - 1);
  }
  let streak = 0;
  while (countPrayed(getDayStatus(storage, day)) === TRACKED_PRAYERS.length) {
    streak += 1;
    day.setDate(day.getDate() - 1);
    if (streak >= KEEP_DAYS) break;
  }
  return streak;
}

/** Today's ticks as the phone needs them: the date, the count, each prayer and the streak. */
export function trackerSummary(storage, date = new Date()) {
  const prayed = getDayStatus(storage, date);
  return { date: dayKey(date), count: countPrayed(prayed), prayed, streak: currentStreak(storage, date) };
}
