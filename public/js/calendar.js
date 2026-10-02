// ============================================================================

import { fetchJsonWithFallback } from "./error-boundary.js";
// TAZAWWUD - Islamic Calendar (Phase 10)
// ----------------------------------------------------------------------------
// AlAdhan supplies the Gregorian-to-Hijri month mapping. Intl Islamic calendar
// data is used only as a graceful offline fallback when the API is unavailable.
// ============================================================================

const ALADHAN_BASE = "https://api.aladhan.com/v1";
const HIJRI_MONTHS = [
  "Muharram", "Safar", "Rabi al-Awwal", "Rabi al-Thani",
  "Jumada al-Awwal", "Jumada al-Thani", "Rajab", "Sha'ban",
  "Ramadan", "Shawwal", "Dhul-Qadah", "Dhul-Hijjah",
];
const HIJRI_MONTHS_AR = [
  "مُحَرَّم", "صَفَر", "رَبِيع الأوّل", "رَبِيع الثاني",
  "جُمَادَى الأولى", "جُمَادَى الثانية", "رَجَب", "شَعْبَان",
  "رَمَضَان", "شَوَّال", "ذُو القِعْدَة", "ذُو الحِجَّة",
];
const EVENTS = {
  "1-1": { name: "Islamic New Year", arabic: "رأس السنة الهجرية" },
  "10-1": { name: "Ashura", arabic: "عاشوراء" },
  "12-3": { name: "Mawlid an-Nabi", arabic: "المولد النبوي" },
  "27-7": { name: "Isra and Mi'raj", arabic: "الإسراء والمعراج" },
  "15-8": { name: "Mid-Sha'ban", arabic: "ليلة النصف من شعبان" },
  "1-9": { name: "Ramadan begins", arabic: "بداية رمضان" },
  "27-9": { name: "Laylat al-Qadr", arabic: "ليلة القدر" },
  "1-10": { name: "Eid al-Fitr", arabic: "عيد الفطر" },
  "9-12": { name: "Day of Arafat", arabic: "يوم عرفة" },
  "10-12": { name: "Eid al-Adha", arabic: "عيد الأضحى" },
};

let initializedRoot = null;
let cursor = new Date();
let requestToken = 0;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatGregorianMonth(date) {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

export function formatGregorianDate(date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date);
}

function formatHijriFallback(date) {
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const month = get("month");
  return {
    day: get("day"),
    month,
    year: get("year"),
    monthName: HIJRI_MONTHS[month - 1],
    monthArabic: HIJRI_MONTHS_AR[month - 1],
  };
}

function eventFor(day, month) {
  return EVENTS[`${day}-${month}`] || null;
}

function renderShell(root) {
  root.innerHTML = `
    <header class="calendar-header">
      <span class="material-symbols-rounded icon icon--lg" aria-hidden="true">calendar_month</span>
      <h2>Islamic Calendar</h2>
      <p class="calendar-header__arabic" lang="ar" dir="rtl">التقويم الهجري</p>
      <p class="calendar-header__date" data-calendar-today></p>
    </header>
    <section class="calendar-panel" aria-labelledby="calendar-month-heading">
      <div class="calendar-toolbar">
        <button type="button" class="calendar-button" data-calendar-previous aria-label="Previous month">
          <span class="material-symbols-rounded icon" aria-hidden="true">chevron_left</span>
        </button>
        <div>
          <h3 id="calendar-month-heading" class="calendar-month-title" data-calendar-month></h3>
          <p class="calendar-month-arabic" lang="ar" dir="rtl" data-calendar-hijri-month></p>
        </div>
        <button type="button" class="calendar-button" data-calendar-next aria-label="Next month">
          <span class="material-symbols-rounded icon" aria-hidden="true">chevron_right</span>
        </button>
      </div>
      <div class="calendar-legend" data-calendar-events aria-label="Islamic events"></div>
      <div class="calendar-weekdays" aria-hidden="true">
        <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
      </div>
      <div class="calendar-grid" data-calendar-grid aria-busy="true"></div>
      <p class="calendar-status" data-calendar-status role="status"></p>
    </section>
  `;
  root.querySelector("[data-calendar-today]").textContent = `Today: ${formatGregorianDate(new Date())}`;
}

function renderLoading(root) {
  root.querySelector("[data-calendar-grid]").innerHTML = `<p class="calendar-message">Loading calendar...</p>`;
  root.querySelector("[data-calendar-grid]").setAttribute("aria-busy", "true");
}

function renderError(root, message) {
  root.querySelector("[data-calendar-grid]").innerHTML = `<p class="calendar-message calendar-message--error">${escapeHtml(message)}</p>`;
  root.querySelector("[data-calendar-grid]").setAttribute("aria-busy", "false");
}

async function fetchMonth(date) {
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const result = await fetchJsonWithFallback(`${ALADHAN_BASE}/gToHCalendar/${month}/${year}`, {
    cacheKey: `calendar:${year}:${month}`,
    validate: (payload) => payload?.code === 200 && Array.isArray(payload.data),
  });
  return { days: result.data.data, source: result.source };
}

function makeFallbackMonth(date) {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return Array.from({ length: lastDay }, (_, index) => {
    const day = index + 1;
    const gregorian = new Date(date.getFullYear(), date.getMonth(), day);
    return { gregorian: { day, date: `${pad(day)}-${pad(date.getMonth() + 1)}-${date.getFullYear()}` }, hijri: formatHijriFallback(gregorian) };
  });
}

function normalizeApiDay(day) {
  const month = Number(day.hijri.month.number);
  return {
    gregorian: {
      day: Number(day.gregorian.day),
      date: day.gregorian.date,
    },
    hijri: {
      day: Number(day.hijri.day),
      month,
      year: Number(day.hijri.year),
      monthName: day.hijri.month.en || HIJRI_MONTHS[month - 1],
      monthArabic: day.hijri.month.ar || HIJRI_MONTHS_AR[month - 1],
    },
  };
}

function renderMonth(root, days, fromFallback = false) {
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const leadingDays = monthStart.getDay();
  const cells = [];
  const firstHijri = days[0]?.hijri;
  const currentDateKey = new Date().toDateString();
  const todayMonth = cursor.getMonth();
  const todayYear = cursor.getFullYear();

  root.querySelector("[data-calendar-month]").textContent = formatGregorianMonth(cursor);
  root.querySelector("[data-calendar-hijri-month]").textContent = firstHijri
    ? `${firstHijri.monthArabic} ${firstHijri.year} هـ`
    : "";

  for (let index = 0; index < leadingDays; index += 1) cells.push(`<div class="calendar-day calendar-day--empty" aria-hidden="true"></div>`);
  days.forEach((day) => {
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), day.gregorian.day);
    const event = eventFor(day.hijri.day, day.hijri.month);
    const isToday = date.toDateString() === currentDateKey && todayMonth === new Date().getMonth() && todayYear === new Date().getFullYear();
    const eventLabel = event ? `${event.name} - ${event.arabic}` : "";
    cells.push(`
      <div class="calendar-day${isToday ? " is-today" : ""}${event ? " has-event" : ""}"${event ? ` title="${escapeHtml(eventLabel)}"` : ""}>
        <span class="calendar-day__gregorian">${day.gregorian.day}</span>
        <span class="calendar-day__hijri" lang="ar" dir="rtl">${day.hijri.day}</span>
        ${event ? `<span class="calendar-day__event">${escapeHtml(event.name)}</span>` : ""}
      </div>
    `);
  });
  root.querySelector("[data-calendar-grid]").innerHTML = cells.join("");
  root.querySelector("[data-calendar-grid]").setAttribute("aria-busy", "false");
  root.querySelector("[data-calendar-status]").textContent = fromFallback
    ? "Showing device calendar data while the calendar service is unavailable."
    : "Dates supplied by AlAdhan.";

  const events = days.map((day) => eventFor(day.hijri.day, day.hijri.month)).filter(Boolean);
  root.querySelector("[data-calendar-events]").innerHTML = events.length
    ? events.map((event) => `<span class="calendar-event-chip"><strong>${escapeHtml(event.name)}</strong><span lang="ar" dir="rtl">${escapeHtml(event.arabic)}</span></span>`).join("")
    : "<span class=\"calendar-no-events\">No major events this month</span>";
}

async function loadMonth(root) {
  const token = ++requestToken;
  renderLoading(root);
  try {
    const result = await fetchMonth(cursor);
    if (token !== requestToken) return;
    renderMonth(root, result.days.map(normalizeApiDay));
    if (result.source !== "network") {
      root.querySelector("[data-calendar-status]").textContent = "Showing saved calendar data while the service reconnects.";
    }
  } catch (error) {
    console.warn("[TAZAWWUD] Calendar API unavailable:", error.message);
    if (token !== requestToken) return;
    renderMonth(root, makeFallbackMonth(cursor), true);
  }
}

/**
 * Today's Hijri date as a compact display string (e.g. "5 Rabi al-Thani 1447").
 * Uses AlAdhan's gToH endpoint — the single-date counterpart of the
 * gToHCalendar endpoint the full Calendar view already uses — with the same
 * offline fallback (formatHijriFallback). Not a second calendar system: same
 * source, same fallback, same day-object shape (normalizeApiDay handles both).
 */
export async function getTodayHijriLabel() {
  const today = new Date();
  const dateParam = `${pad(today.getDate())}-${pad(today.getMonth() + 1)}-${today.getFullYear()}`;
  try {
    const result = await fetchJsonWithFallback(`${ALADHAN_BASE}/gToH/${dateParam}`, {
      cacheKey: `calendar:gToH:${dateParam}`,
      validate: (payload) => payload?.code === 200 && Boolean(payload.data?.hijri),
    });
    const { hijri } = normalizeApiDay(result.data.data);
    return `${hijri.day} ${hijri.monthName} ${hijri.year}`;
  } catch (error) {
    console.warn("[TAZAWWUD] Hijri date lookup failed, using device calendar:", error.message);
    const hijri = formatHijriFallback(today);
    return `${hijri.day} ${hijri.monthName} ${hijri.year}`;
  }
}

export function initCalendar(root) {
  if (!root || initializedRoot === root) return;
  initializedRoot = root;
  renderShell(root);
  root.querySelector("[data-calendar-previous]").addEventListener("click", () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    loadMonth(root);
  });
  root.querySelector("[data-calendar-next]").addEventListener("click", () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    loadMonth(root);
  });
  loadMonth(root);
}
