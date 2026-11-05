// ============================================================================
// TAZAWWUD - Reminder card.
// When a reminder notification is tapped, the reminder opens here, in the app, instead of Home.
// It is taken from the phone once, when the app comes to the front. Nothing is sent over the
// network, and nothing is stored in the database.
// ============================================================================

import { getPendingAction } from "./native-bridge.js";

const CARD_ID = "reminder-card";

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function showReminderCard({ title, body }) {
  document.getElementById(CARD_ID)?.remove();
  const overlay = document.createElement("div");
  overlay.id = CARD_ID;
  overlay.className = "reminder-card-overlay";
  overlay.innerHTML = `
    <section class="reminder-card" role="dialog" aria-modal="true" aria-labelledby="reminder-card-title">
      <p class="reminder-card__kicker">Reminder</p>
      <h2 id="reminder-card-title" class="reminder-card__title">${esc(title || "TAZAWWUD")}</h2>
      ${body ? `<p class="reminder-card__body">${esc(body)}</p>` : ""}
      <button type="button" class="reminder-card__close" data-reminder-close>Close</button>
    </section>`;
  const close = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest("[data-reminder-close]")) close();
  });
  document.body.append(overlay);
  overlay.querySelector("[data-reminder-close]")?.focus();
}

async function checkPending() {
  const action = await getPendingAction();
  if (action?.type === "reminder") showReminderCard(action);
}

/** Shows a tapped reminder now, and again whenever the app comes back to the front. */
export function initReminderCard() {
  checkPending();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkPending();
  });
}
