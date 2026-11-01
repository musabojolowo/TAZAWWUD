// ============================================================================
// TAZAWWUD - Admin: scheduled reminders
// ----------------------------------------------------------------------------
// Create, edit, pause, delete daily reminders at a chosen time, and send a reminder
// now. Every change is written to the reminder log. The database rules decide what
// is allowed; this page only decides what it shows.
// ============================================================================

import { db } from "./firebase-config.js";
import { ref, onValue, off, push, update, remove } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { getCurrentUser } from "./auth.js";
import { escapeHtml } from "./html-utils.js";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
let editingId = null;
let listeners = [];

function logChange(action, title) {
  const user = getCurrentUser();
  return push(ref(db, "reminderLog"), {
    action,
    title: String(title || "").slice(0, 100),
    at: Date.now(),
    by: String(user?.uid || "").slice(0, 128),
  });
}

function readOnce(path) {
  return new Promise((resolve) => onValue(ref(db, path), resolve, { onlyOnce: true }));
}

function readForm(form) {
  return {
    title: form.querySelector("[name=title]").value.trim(),
    body: form.querySelector("[name=body]").value.trim(),
    time: form.querySelector("[name=time]").value,
    enabled: form.querySelector("[name=enabled]").checked,
  };
}

function validate({ title, body, time }) {
  if (!title || title.length > 100) return "Give the reminder a title, up to 100 characters.";
  if (body.length > 500) return "The message can be up to 500 characters.";
  if (!TIME_RE.test(time)) return "Choose a time.";
  return null;
}

function renderShell(container) {
  container.innerHTML = `
    <section class="admin-reminders__section" aria-labelledby="admin-reminders-heading">
      <h3 id="admin-reminders-heading">Adhkar and reminders</h3>
      <p class="admin-reminders__note">Reminders ring every day at this time, on each phone, using the phone’s local time. Users do not set these themselves. A phone receives changes the next time the app is opened.</p>
      <form class="admin-reminders__form" data-reminder-form>
        <label>Title <input name="title" maxlength="100" required /></label>
        <label>Message <textarea name="body" rows="2" maxlength="500"></textarea></label>
        <label>Time <input name="time" type="time" required /></label>
        <label class="admin-reminders__check"><input name="enabled" type="checkbox" checked /> Active</label>
        <div class="admin-reminders__actions">
          <button type="submit" data-reminder-save>Add reminder</button>
          <button type="button" data-reminder-cancel hidden>Cancel edit</button>
        </div>
        <p class="admin-reminders__status" data-reminder-status role="status"></p>
      </form>
      <h4>Scheduled</h4>
      <ul class="admin-reminders__list" data-reminder-list></ul>
      <h4>Send now</h4>
      <form class="admin-reminders__form" data-now-form>
        <label>Title <input name="title" maxlength="100" required /></label>
        <label>Message <textarea name="body" rows="2" maxlength="500"></textarea></label>
        <button type="submit">Send now</button>
        <p class="admin-reminders__status" data-now-status role="status"></p>
      </form>
      <h4>History</h4>
      <ul class="admin-reminders__history" data-reminder-history></ul>
    </section>`;
}

function renderList(container, data) {
  const list = container.querySelector("[data-reminder-list]");
  const entries = Object.entries(data || {}).sort((a, b) => String(a[1]?.time).localeCompare(String(b[1]?.time)));
  if (!entries.length) {
    list.innerHTML = "<li>No reminders yet.</li>";
    return;
  }
  list.innerHTML = entries.map(([id, item]) => `
    <li class="admin-reminders__item${item?.enabled ? "" : " is-paused"}">
      <div><strong>${escapeHtml(item?.title || "")}</strong> · ${escapeHtml(item?.time || "")} ${item?.enabled ? "" : "(paused)"}</div>
      <div class="admin-reminders__actions">
        <button type="button" data-reminder-edit="${escapeHtml(id)}">Edit</button>
        <button type="button" data-reminder-toggle="${escapeHtml(id)}">${item?.enabled ? "Pause" : "Resume"}</button>
        <button type="button" data-reminder-delete="${escapeHtml(id)}">Delete</button>
      </div>
    </li>`).join("");
}

function renderHistory(container, data) {
  const list = container.querySelector("[data-reminder-history]");
  const entries = Object.values(data || {}).sort((a, b) => Number(b?.at || 0) - Number(a?.at || 0)).slice(0, 20);
  list.innerHTML = entries.length
    ? entries.map((e) => `<li>${escapeHtml(e?.action || "")}: ${escapeHtml(e?.title || "")} · ${new Date(Number(e?.at || 0)).toLocaleString()}</li>`).join("")
    : "<li>No changes yet.</li>";
}

function wire(container) {
  const form = container.querySelector("[data-reminder-form]");
  const status = container.querySelector("[data-reminder-status]");
  const saveBtn = container.querySelector("[data-reminder-save]");
  const cancelBtn = container.querySelector("[data-reminder-cancel]");

  const resetForm = () => {
    editingId = null;
    form.reset();
    form.querySelector("[name=enabled]").checked = true;
    saveBtn.textContent = "Add reminder";
    cancelBtn.hidden = true;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = readForm(form);
    const problem = validate(data);
    if (problem) { status.textContent = problem; return; }
    try {
      if (editingId) {
        await update(ref(db, `reminders/${editingId}`), { ...data, updatedAt: Date.now() });
        await logChange("edit", data.title);
        status.textContent = "Reminder updated.";
      } else {
        await push(ref(db, "reminders"), { ...data, updatedAt: Date.now() });
        await logChange("add", data.title);
        status.textContent = "Reminder added.";
      }
      resetForm();
    } catch (error) {
      console.error("[TAZAWWUD] Reminder not saved:", error);
      status.textContent = "The reminder could not be saved. Check that you are signed in as an admin.";
    }
  });

  cancelBtn.addEventListener("click", () => { resetForm(); status.textContent = ""; });

  container.querySelector("[data-reminder-list]").addEventListener("click", async (event) => {
    const edit = event.target.closest("[data-reminder-edit]");
    const toggle = event.target.closest("[data-reminder-toggle]");
    const del = event.target.closest("[data-reminder-delete]");
    try {
      if (edit) {
        const item = (await readOnce(`reminders/${edit.dataset.reminderEdit}`)).val() || {};
        editingId = edit.dataset.reminderEdit;
        form.querySelector("[name=title]").value = item.title || "";
        form.querySelector("[name=body]").value = item.body || "";
        form.querySelector("[name=time]").value = item.time || "";
        form.querySelector("[name=enabled]").checked = item.enabled !== false;
        saveBtn.textContent = "Save changes";
        cancelBtn.hidden = false;
        status.textContent = "Editing. Save changes or cancel.";
      } else if (toggle) {
        const id = toggle.dataset.reminderToggle;
        const item = (await readOnce(`reminders/${id}`)).val() || {};
        const nowEnabled = item.enabled === false;
        await update(ref(db, `reminders/${id}`), { enabled: nowEnabled, updatedAt: Date.now() });
        await logChange(nowEnabled ? "resume" : "pause", item.title);
      } else if (del && window.confirm("Delete this reminder?")) {
        const id = del.dataset.reminderDelete;
        const item = (await readOnce(`reminders/${id}`)).val() || {};
        await remove(ref(db, `reminders/${id}`));
        await logChange("delete", item.title);
      }
    } catch (error) {
      console.error("[TAZAWWUD] Reminder change not saved:", error);
      status.textContent = "That change could not be saved.";
    }
  });

  const nowForm = container.querySelector("[data-now-form]");
  const nowStatus = container.querySelector("[data-now-status]");
  nowForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = nowForm.querySelector("[name=title]").value.trim();
    const body = nowForm.querySelector("[name=body]").value.trim();
    if (!title || title.length > 100 || body.length > 500) { nowStatus.textContent = "Check the title and message lengths."; return; }
    try {
      await push(ref(db, "immediateReminders"), { title, body, createdAt: Date.now() });
      await logChange("send now", title);
      nowStatus.textContent = "Sent. Phones show it the next time the app is opened.";
      nowForm.reset();
    } catch (error) {
      console.error("[TAZAWWUD] Reminder not sent:", error);
      nowStatus.textContent = "The reminder could not be sent.";
    }
  });
}

/** Shows the reminders section and keeps it up to date. Call only once the person is confirmed as an admin. */
export function initReminderAdmin(container) {
  if (!container) return;
  stopReminderAdmin();
  renderShell(container);
  wire(container);
  const reminders = ref(db, "reminders");
  const history = ref(db, "reminderLog");
  const onList = onValue(reminders, (snap) => renderList(container, snap.val()));
  const onHistory = onValue(history, (snap) => renderHistory(container, snap.val()));
  listeners = [[reminders, onList], [history, onHistory]];
}

export function stopReminderAdmin() {
  listeners.forEach(([r]) => off(r));
  listeners = [];
}
