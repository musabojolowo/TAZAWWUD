// ============================================================================
// TAZAWWUD - Admin reminders on the phone
// ----------------------------------------------------------------------------
// When Home opens, reads the reminders the admin set, and keeps them on the phone so
// they ring at their local time, even with the app closed. Also shows any one-off
// reminder sent in the last day, once. Reading is public; only admins can write.
// ============================================================================

import { db } from "./firebase-config.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { inNativeApp, saveCustomReminders, showNowReminder } from "./native-bridge.js";

const SEEN_KEY = "tazawwud:seen-immediate-reminders";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function syncReminders() {
  if (!inNativeApp()) return;
  const [regularSnap, immediateSnap] = await Promise.all([
    get(ref(db, "reminders")),
    get(ref(db, "immediateReminders")),
  ]);
  const regular = regularSnap.val() || {};
  const list = Object.entries(regular).map(([id, item]) => ({
    id,
    title: String(item?.title || ""),
    body: String(item?.body || ""),
    time: String(item?.time || ""),
    enabled: item?.enabled === true,
  }));
  await saveCustomReminders(list);

  const seen = new Set(JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) || "[]"));
  const immediate = immediateSnap.val() || {};
  for (const [id, item] of Object.entries(immediate)) {
    if (seen.has(id)) continue;
    // Only recent ones: a reminder sent long ago is not shown to a new install.
    if (Number(item?.createdAt || 0) > Date.now() - ONE_DAY_MS) {
      await showNowReminder(id, String(item?.title || ""), String(item?.body || ""));
    }
    seen.add(id);
  }
  globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
}
