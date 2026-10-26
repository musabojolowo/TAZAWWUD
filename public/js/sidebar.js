// ============================================================================
// TAZAWWUD — Settings sidebar
// ----------------------------------------------------------------------------
// Opens/closes the sidebar, renders account status, and wires sign-out +
// delete-my-data. Dark Mode (theme.js) and Sign-in (app.js/auth.js) keep
// their own existing wiring — this module only moved WHERE those buttons
// live in the DOM, not how they work, so their ids are unchanged.
// "Adhan & Notifications" / "Qur'an Translation & Reciter" deliberately
// link to the Salah/Qur'an views rather than duplicating those controls
// here — those are the one real place that data already lives.
// ============================================================================

import { getCurrentUser, onUserChanged, signOutUser, getUid } from "./auth.js";
import { clearAllLocalData } from "./storage.js";
import { navigateTo } from "./app.js";
import { db } from "./firebase-config.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { escapeHtml } from "./html-utils.js";
import {
  getReminders,
  addReminder,
  removeReminder,
  toggleReminder,
  onRemindersChanged,
  requestPermission,
  permissionGranted,
  formatTime,
} from "./reminders.js";

let lastFocusedElement = null;

function openSidebar() {
  const sidebar = document.getElementById("settings-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sidebar || !backdrop) return;
  lastFocusedElement = document.activeElement;
  sidebar.hidden = false;
  backdrop.hidden = false;
  document.body.style.overflow = "hidden";
  // Offline Downloads panel: loaded only when the sidebar opens.
  import("./downloads-ui.js")
    .then(({ mountDownloadsPanel }) => mountDownloadsPanel(document.getElementById("settings-downloads")))
    .catch((error) => console.warn("[TAZAWWUD] Could not open offline downloads:", error));
  document.getElementById("sidebar-close-btn")?.focus();
  document.addEventListener("keydown", onKeydown);
}

function closeSidebar() {
  const sidebar = document.getElementById("settings-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (!sidebar || !backdrop) return;
  sidebar.hidden = true;
  backdrop.hidden = true;
  document.body.style.overflow = "";
  document.removeEventListener("keydown", onKeydown);
  (lastFocusedElement || document.getElementById("account-menu-btn"))?.focus();
}

function onKeydown(event) {
  if (event.key === "Escape") closeSidebar();
}

/**
 * Shows an Admin button in the sidebar only for a signed-in account listed under admins/.
 * Hiding it is not the security: the database rules decide what an admin can change.
 */
async function renderAdminEntry() {
  const slot = document.getElementById("sidebar-admin-slot");
  if (!slot) return;
  slot.replaceChildren();
  const user = getCurrentUser();
  const uid = getUid();
  if (!user || user.isAnonymous || !uid) return;
  try {
    const snapshot = await get(ref(db, `admins/${uid}`));
    if (!snapshot.exists() || snapshot.val() !== true) return;
  } catch (error) {
    return; // the check failed: show nothing rather than guess
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-row-btn";
  button.dataset.gotoView = "admin";
  button.textContent = "Admin";
  button.addEventListener("click", () => navigateTo("admin"));
  slot.append(button);
}

function renderAccountStatus() {
  const statusEl = document.getElementById("account-status");
  const signInBtn = document.getElementById("google-sign-in-btn");
  const signOutBtn = document.getElementById("sign-out-btn");
  if (!statusEl) return;

  const user = getCurrentUser();
  if (user && !user.isAnonymous) {
    statusEl.textContent = user.displayName
      ? `Signed in as ${user.displayName}`
      : user.email
        ? `Signed in as ${user.email}`
        : "Signed in with Google";
    if (signInBtn) signInBtn.hidden = true;
    if (signOutBtn) signOutBtn.hidden = false;
  } else {
    statusEl.textContent = "Not signed in — your bookmarks are saved on this device only.";
    if (signInBtn) signInBtn.hidden = false;
    if (signOutBtn) signOutBtn.hidden = true;
  }
}

async function renderOfflineStatus() {
  const el = document.getElementById("offline-status");
  if (!el) return;
  const hasServiceWorker = "serviceWorker" in navigator;
  const registration = hasServiceWorker ? await navigator.serviceWorker.getRegistration() : null;
  el.textContent = registration
    ? "Offline support is active — Qur'an pages, Hadith collections, and audio you've already opened stay available without a connection."
    : "Offline support is unavailable in this browser.";
}

function wireGotoViewButtons(root) {
  root.querySelectorAll("[data-goto-view]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateTo(button.dataset.gotoView);
      closeSidebar();
    });
  });
}

async function handleSignOut() {
  const btn = document.getElementById("sign-out-btn");
  if (btn) btn.disabled = true;
  try {
    await signOutUser();
  } catch (error) {
    console.error("[TAZAWWUD] Sign-out failed:", error);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleDeleteData() {
  const confirmed = window.confirm(
    "Delete all TAZAWWUD data? This removes your bookmarks and preferences from this device, " +
      "and from your account if you're signed in. This cannot be undone."
  );
  if (!confirmed) return;

  const btn = document.getElementById("delete-data-btn");
  if (btn) btn.disabled = true;
  try {
    const uid = getUid();
    if (uid) {
      const [{ deleteAllCloudBookmarks }, { deleteCloudPreferences }] = await Promise.all([
        import("./bookmarks.js"),
        import("./cloud-sync.js"),
      ]);
      await Promise.all([deleteAllCloudBookmarks(uid), deleteCloudPreferences(uid)]);
    }
    clearAllLocalData();
    await signOutUser();
    window.alert("Your data has been deleted.");
    window.location.reload();
  } catch (error) {
    console.error("[TAZAWWUD] Delete-my-data failed:", error);
    window.alert("Something went wrong deleting your data. Please try again.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function renderReminders(reminders) {
  const list = document.getElementById("reminders-list");
  if (!list) return;
  if (!reminders.length) {
    list.innerHTML = `<li class="reminders-list__empty">No reminders yet.</li>`;
    return;
  }
  list.innerHTML = reminders
    .map(
      (r) => `
        <li class="reminders-list__item">
          <label class="reminders-list__toggle">
            <input type="checkbox" data-reminder-toggle="${r.id}" ${r.enabled ? "checked" : ""} />
            <span>
              <strong>${escapeHtml(r.label)}</strong>
              <span class="reminders-list__time">${formatTime(r.hour, r.minute)}</span>
            </span>
          </label>
          <button type="button" class="reminders-list__delete" data-reminder-delete="${r.id}" aria-label="Delete ${escapeHtml(r.label)}">
            <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">delete</span>
          </button>
        </li>
      `
    )
    .join("");

  list.querySelectorAll("[data-reminder-toggle]").forEach((input) => {
    input.addEventListener("change", (event) => {
      toggleReminder(input.dataset.reminderToggle, event.target.checked);
    });
  });
  list.querySelectorAll("[data-reminder-delete]").forEach((button) => {
    button.addEventListener("click", () => removeReminder(button.dataset.reminderDelete));
  });
}

function wireReminderForm() {
  const form = document.getElementById("reminder-add-form");
  const permissionNote = document.getElementById("reminders-permission-note");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const labelInput = document.getElementById("reminder-label-input");
    const timeInput = document.getElementById("reminder-time-input");
    const [hour, minute] = (timeInput.value || "").split(":").map(Number);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return;

    const granted = await requestPermission();
    if (permissionNote) permissionNote.hidden = granted;
    if (!granted) return;

    addReminder({ label: labelInput.value, hour, minute });
    form.reset();
  });

  const isDenied = "Notification" in window && Notification.permission === "denied";
  if (permissionNote) permissionNote.hidden = !isDenied;
}

export function initSidebar() {
  const sidebar = document.getElementById("settings-sidebar");
  if (!sidebar) return;

  document.getElementById("account-menu-btn")?.addEventListener("click", openSidebar);
  document.getElementById("sidebar-close-btn")?.addEventListener("click", closeSidebar);
  document.getElementById("sidebar-backdrop")?.addEventListener("click", closeSidebar);
  document.getElementById("sign-out-btn")?.addEventListener("click", handleSignOut);
  document.getElementById("delete-data-btn")?.addEventListener("click", handleDeleteData);

  wireGotoViewButtons(sidebar);
  onUserChanged(() => {
    renderAccountStatus();
    renderAdminEntry();
  });
  renderAccountStatus();
  renderOfflineStatus();

  renderReminders(getReminders());
  onRemindersChanged(renderReminders);
  wireReminderForm();
}
