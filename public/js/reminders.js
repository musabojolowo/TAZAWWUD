// ============================================================================
// TAZAWWUD — Daily Reminders
// ----------------------------------------------------------------------------
// Configurable local notifications at a time of day the person picks (e.g.
// "Evening Adhkar, 7:00 PM"), repeating daily. Runs globally (started once
// in app.js), not tied to any one view — a reminder should fire no matter
// which page is open.
//
// HONEST LIMITATION, same one the existing prayer-time notifications
// already have (see notifications.js): this is a plain setInterval poll
// that only runs while the app/tab is open (or recently backgrounded,
// depending on how aggressive the browser/OS is about suspending
// background tabs). It is NOT a true push notification that fires days
// later with the app fully closed — that would need a server-side Web
// Push/FCM backend (Firebase Cloud Functions + VAPID keys), which is new
// paid-tier infrastructure this project doesn't have and wasn't asked to
// set up here. If the app has been closed, a reminder is simply missed for
// that day, same as a missed prayer-notification would be today.
// ============================================================================

import { isSupported, todayKey } from "./notifications.js";

const STORAGE_KEY = "tazawwud:daily-reminders";
const CHECK_INTERVAL_MS = 15000;

let timerId = null;
let lastFiredKey = "";
let listeners = [];

function readReminders() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    console.warn("[TAZAWWUD] Could not read Daily Reminders:", error);
    return [];
  }
}

function writeReminders(reminders) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
  } catch (error) {
    console.warn("[TAZAWWUD] Could not save Daily Reminders:", error);
  }
}

function notify(listeners_) {
  listeners_.forEach((callback) => callback(readReminders()));
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** "19:00" -> "7:00 PM" for display. */
export function formatTime(hour, minute) {
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${pad(minute)} ${period}`;
}

function uid() {
  return `r${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
}

export function addReminder({ label, hour, minute }) {
  const reminders = readReminders();
  reminders.push({ id: uid(), label: label.trim() || "Reminder", hour, minute, enabled: true });
  writeReminders(reminders);
  notify(listeners);
  return reminders;
}

export function removeReminder(id) {
  const reminders = readReminders().filter((r) => r.id !== id);
  writeReminders(reminders);
  notify(listeners);
  return reminders;
}

export function toggleReminder(id, enabled) {
  const reminders = readReminders().map((r) => (r.id === id ? { ...r, enabled } : r));
  writeReminders(reminders);
  notify(listeners);
  return reminders;
}

export function getReminders() {
  return readReminders();
}

/** Subscribes to reminder-list changes (for UI lists). Returns an unsubscribe function. */
export function onRemindersChanged(callback) {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((cb) => cb !== callback);
  };
}

function showReminderNotification(reminder) {
  if (!isSupported() || Notification.permission !== "granted") return;
  new Notification(`${reminder.label} — TAZAWWUD`, {
    body: "This is your daily reminder.",
    tag: `tazawwud-reminder-${reminder.id}`,
    icon: "/icons/icon-192.png",
  });
}

function checkReminders() {
  if (!isSupported() || Notification.permission !== "granted") return;
  const now = new Date();
  const currentMinute = now.getHours() * 60 + now.getMinutes();

  readReminders().forEach((reminder) => {
    if (!reminder.enabled) return;
    if (reminder.hour * 60 + reminder.minute !== currentMinute) return;

    const key = `${todayKey()}-${reminder.id}-${currentMinute}`;
    if (lastFiredKey === key) return;
    lastFiredKey = key;
    showReminderNotification(reminder);
  });
}

/** Requests Notification permission, for the "enable reminders" UI action. */
export async function requestPermission() {
  if (!isSupported()) return false;
  if (Notification.permission === "granted") return true;
  const result = await Notification.requestPermission();
  return result === "granted";
}

export function permissionGranted() {
  return isSupported() && Notification.permission === "granted";
}

/** Starts the background check. Safe to call multiple times (no-op if already running). */
export function startReminders() {
  if (!isSupported() || timerId !== null) return;
  checkReminders();
  timerId = window.setInterval(checkReminders, CHECK_INTERVAL_MS);
}

export function stopReminders() {
  if (timerId === null) return;
  window.clearInterval(timerId);
  timerId = null;
}
