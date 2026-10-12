// ============================================================================
// TAZAWWUD — Admin: Islamic Stories content management
// ----------------------------------------------------------------------------
// SECURITY MODEL: the ONLY real enforcement is database.rules.json, which
// only allows writes to stories/ from a uid present under admins/. Every
// check in THIS file (is the person signed in, do they appear to be an
// admin) is UX only — it decides what the page SHOWS, not what Firebase
// ALLOWS. A non-admin who somehow reached this page and pressed a button
// would simply get a write rejected by the database; nothing here is a
// security boundary by itself. See docs/DEPLOYMENT.md for how the first
// admin is granted (a one-time manual step — there are no Cloud Functions
// in this project to do it automatically; see firebase-config.js's own
// "Spark plan compliance" note).
// ============================================================================

import { db } from "./firebase-config.js";
import {
  ref,
  onValue,
  off,
  push,
  update,
  remove,
  get,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { onUserChanged, getCurrentUser } from "./auth.js";
import { escapeHtml } from "./html-utils.js";

const storiesRef = ref(db, "stories");
let listenerAttached = false;
let unsubscribeAuth = null;
let editingId = null;
let accessCheckGeneration = 0;

/** An anonymous session isn't a stable identity worth granting admin
 *  access to, so this page treats "anonymous" the same as "signed out" —
 *  unlike the rest of the app, it never auto-creates an anonymous session. */
function currentRealUid() {
  const user = getCurrentUser();
  return user && !user.isAnonymous ? user.uid : null;
}

const LIMITS = { title: 200, body: 20000, category: 60, author: 100, imageUrl: 500 };

function validateFields(fields) {
  if (!fields.title.trim()) return "Title is required.";
  if (fields.title.length > LIMITS.title) return `Title must be ${LIMITS.title} characters or fewer.`;
  if (!fields.body.trim()) return "Body is required.";
  if (fields.body.length > LIMITS.body) return `Body must be ${LIMITS.body} characters or fewer.`;
  if (fields.category.length > LIMITS.category) return `Category must be ${LIMITS.category} characters or fewer.`;
  if (fields.author.length > LIMITS.author) return `Author must be ${LIMITS.author} characters or fewer.`;
  if (fields.imageUrl.length > LIMITS.imageUrl) return `Image URL must be ${LIMITS.imageUrl} characters or fewer.`;
  if (fields.imageUrl && !/^https:\/\//.test(fields.imageUrl)) return "Image URL must start with https://.";
  return null;
}

function readFormFields(form) {
  return {
    title: form.querySelector("#admin-story-title").value.trim(),
    body: form.querySelector("#admin-story-body").value.trim(),
    category: form.querySelector("#admin-story-category").value.trim(),
    author: form.querySelector("#admin-story-author").value.trim(),
    imageUrl: form.querySelector("#admin-story-image").value.trim(),
  };
}

// ----------------------------------------------------------------------------
// Not-an-admin state
// ----------------------------------------------------------------------------

function renderSignedOut(container) {
  container.innerHTML = `
    <header class="view-header">
      <h2 class="view-header__title">Stories Admin</h2>
    </header>
    <p class="settings-note">Sign in to request admin access.</p>
    <button type="button" id="admin-sign-in-btn" class="salah-button">Sign in with Google</button>
  `;
  container.querySelector("#admin-sign-in-btn")?.addEventListener("click", async () => {
    const { signInWithGoogle } = await import("./auth.js");
    await signInWithGoogle();
  });
}

function renderNotAdmin(container, uid) {
  container.innerHTML = `
    <header class="view-header">
      <h2 class="view-header__title">Stories Admin</h2>
    </header>
    <p class="settings-note">
      This account isn't an admin yet. To request access, share this ID with whoever manages
      TAZAWWUD — they can grant access from the Firebase Console (see docs/DEPLOYMENT.md).
    </p>
    <p class="admin-uid-box">${escapeHtml(uid)}</p>
  `;
}

// ----------------------------------------------------------------------------
// Admin CMS
// ----------------------------------------------------------------------------

function renderForm(story) {
  const isEdit = Boolean(story);
  return `
    <form id="admin-story-form" class="admin-story-form">
      <h3 class="settings-section__heading">${isEdit ? "Edit Story" : "Add Story"}</h3>
      <label for="admin-story-title">Title</label>
      <input type="text" id="admin-story-title" maxlength="${LIMITS.title}" value="${escapeHtml(story?.title || "")}" required />

      <label for="admin-story-category">Category (optional)</label>
      <input type="text" id="admin-story-category" maxlength="${LIMITS.category}" value="${escapeHtml(story?.category || "")}" />

      <label for="admin-story-author">Author (optional)</label>
      <input type="text" id="admin-story-author" maxlength="${LIMITS.author}" value="${escapeHtml(story?.author || "")}" />

      <label for="admin-story-image">Image URL (optional — must be https://, no file upload: this project doesn't use Firebase Storage)</label>
      <input type="url" id="admin-story-image" maxlength="${LIMITS.imageUrl}" value="${escapeHtml(story?.imageUrl || "")}" placeholder="https://…" />

      <label for="admin-story-body">Body</label>
      <textarea id="admin-story-body" rows="8" maxlength="${LIMITS.body}" required>${escapeHtml(story?.body || "")}</textarea>

      <p id="admin-story-error" class="admin-story-error" hidden></p>

      <div class="admin-story-form__actions">
        <button type="submit" class="salah-button">${isEdit ? "Save Changes" : "Add Story (as draft)"}</button>
        ${isEdit ? `<button type="button" id="admin-cancel-edit-btn" class="salah-button salah-button--secondary">Cancel</button>` : ""}
      </div>
    </form>
  `;
}

function renderStoryRow(story) {
  return `
    <li class="admin-story-row">
      <div class="admin-story-row__info">
        <strong>${escapeHtml(story.title)}</strong>
        <span class="admin-story-row__status ${story.published ? "is-published" : "is-draft"}">
          ${story.published ? "Published" : "Draft"}
        </span>
      </div>
      <div class="admin-story-row__actions">
        <button type="button" class="settings-row-btn" data-admin-toggle="${story.id}">
          ${story.published ? "Unpublish" : "Publish"}
        </button>
        <button type="button" class="settings-row-btn" data-admin-edit="${story.id}">Edit</button>
        <button type="button" class="settings-row-btn settings-row-btn--danger" data-admin-delete="${story.id}">Delete</button>
      </div>
    </li>
  `;
}

function wireForm(container, stories) {
  const form = container.querySelector("#admin-story-form");
  const errorEl = container.querySelector("#admin-story-error");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = readFormFields(form);
    const validationError = validateFields(fields);
    if (validationError) {
      errorEl.textContent = validationError;
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      if (editingId) {
        await update(ref(db, `stories/${editingId}`), { ...fields, updatedAt: Date.now() });
        editingId = null;
      } else {
        await push(storiesRef, {
          ...fields,
          published: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          createdBy: currentRealUid() || "",
        });
      }
      // onValue's own listener re-renders the list/form automatically.
    } catch (error) {
      console.error("[TAZAWWUD] Admin: story save failed:", error);
      errorEl.textContent = "Couldn't save — please check your connection and try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  container.querySelector("#admin-cancel-edit-btn")?.addEventListener("click", () => {
    editingId = null;
    renderAdminCms(container, stories);
  });

  container.querySelectorAll("[data-admin-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const story = stories.find((s) => s.id === btn.dataset.adminToggle);
      if (!story) return;
      btn.disabled = true;
      try {
        await update(ref(db, `stories/${story.id}`), { published: !story.published, updatedAt: Date.now() });
      } catch (error) {
        console.error("[TAZAWWUD] Admin: publish toggle failed:", error);
      } finally {
        btn.disabled = false;
      }
    });
  });

  container.querySelectorAll("[data-admin-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingId = btn.dataset.adminEdit;
      renderAdminCms(container, stories);
    });
  });

  container.querySelectorAll("[data-admin-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const story = stories.find((s) => s.id === btn.dataset.adminDelete);
      if (!story) return;
      if (!window.confirm(`Delete "${story.title}"? This cannot be undone.`)) return;
      btn.disabled = true;
      try {
        await remove(ref(db, `stories/${story.id}`));
      } catch (error) {
        console.error("[TAZAWWUD] Admin: delete failed:", error);
        btn.disabled = false;
      }
    });
  });
}

function renderAdminCms(container, stories) {
  const sorted = [...stories].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const editingStory = editingId ? stories.find((s) => s.id === editingId) : null;

  container.innerHTML = `
    <header class="view-header">
      <h2 class="view-header__title">Stories Management</h2>
      <p class="view-header__subtitle">${stories.length} stor${stories.length === 1 ? "y" : "ies"} total</p>
    </header>
    ${renderForm(editingStory)}
    <ul class="admin-story-list">
      ${sorted.map(renderStoryRow).join("") || `<li class="settings-note">No stories yet — add one above.</li>`}
    </ul>
  `;
  wireForm(container, stories);
}

function renderAdminShell(container) {
  container.innerHTML = `
    <header class="view-header">
      <h2 class="view-header__title">Admin Dashboard</h2>
    </header>
    <section id="admin-daily-content" class="admin-daily-content" aria-labelledby="admin-daily-content-heading"></section>
    <section id="admin-stories-root" aria-live="polite">
      <div class="stories-status">Loading Stories management…</div>
    </section>
  `;
  initDailyContentAdmin(container.querySelector("#admin-daily-content"));
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function initDailyContentAdmin(root) {
  if (!root) return;
  root.innerHTML = `
    <h3 id="admin-daily-content-heading" class="settings-section__heading">Daily Featured Content</h3>
    <p class="settings-note">Manage the Verse of the Day, Hadith of the Day, and announcement shown on Home. Content is public; only authorized admins can change it.</p>
    <form id="admin-daily-content-form" class="admin-featured-form">
      <label for="admin-content-date">Content date</label>
      <input id="admin-content-date" name="date" type="date" value="${localDateKey()}" required />

      <fieldset class="admin-featured-form__group">
        <legend>Verse of the Day</legend>
        <div class="admin-featured-form__grid">
          <label>Surah number<input name="surahNumber" type="number" min="1" max="114" /></label>
          <label>Ayah number<input name="ayahNumber" type="number" min="1" max="286" /></label>
          <label>Surah name<input name="surahName" maxlength="100" /></label>
        </div>
        <label>Arabic text<textarea name="arabicText" rows="3" maxlength="2000" dir="rtl"></textarea></label>
        <label>Translation<textarea name="translation" rows="3" maxlength="4000"></textarea></label>
      </fieldset>

      <fieldset class="admin-featured-form__group">
        <legend>Hadith of the Day</legend>
        <label>Collection<input name="hadithCollection" maxlength="120" /></label>
        <label>Reference<input name="hadithReference" maxlength="120" /></label>
        <label>Grade (optional)<input name="hadithGrade" maxlength="80" /></label>
        <label>Text<textarea name="hadithText" rows="4" maxlength="6000"></textarea></label>
      </fieldset>

      <fieldset class="admin-featured-form__group">
        <legend>Announcement</legend>
        <label>Title<input name="announcementTitle" maxlength="160" /></label>
        <label>Message<textarea name="announcementBody" rows="3" maxlength="2000"></textarea></label>
        <label class="admin-featured-form__checkbox"><input name="announcementActive" type="checkbox" /> Show announcement</label>
      </fieldset>

      <p class="admin-story-error" data-featured-status role="status" hidden></p>
      <button type="submit" class="salah-button">Save Daily Content</button>
    </form>
  `;

  const form = root.querySelector("#admin-daily-content-form");
  const status = root.querySelector("[data-featured-status]");
  const saveButton = form.querySelector('button[type="submit"]');
  let loadSequence = 0;

  const loadDate = async () => {
    const date = form.elements.date.value;
    const sequence = ++loadSequence;
    if (!date) return;
    saveButton.disabled = true;
    status.hidden = true;
    try {
      const snapshot = await get(ref(db, `dailyContent/${date}`));
      if (sequence !== loadSequence || form.elements.date.value !== date) return;
      const value = snapshot.val() || {};
      const verse = value.verse || {};
      const hadith = value.hadith || {};
      const announcement = value.announcement || {};
      form.elements.surahNumber.value = verse.surahNumber ?? "";
      form.elements.ayahNumber.value = verse.ayahNumber ?? "";
      form.elements.surahName.value = verse.surahName ?? "";
      form.elements.arabicText.value = verse.arabicText ?? "";
      form.elements.translation.value = verse.translation ?? "";
      form.elements.hadithCollection.value = hadith.collection ?? "";
      form.elements.hadithReference.value = hadith.reference ?? "";
      form.elements.hadithGrade.value = hadith.grade ?? "";
      form.elements.hadithText.value = hadith.text ?? "";
      form.elements.announcementTitle.value = announcement.title ?? "";
      form.elements.announcementBody.value = announcement.body ?? "";
      form.elements.announcementActive.checked = announcement.active === true;
      saveButton.disabled = false;
    } catch (error) {
      console.error("[TAZAWWUD] Admin: failed to load daily content:", error);
      status.textContent = "Could not load this date's content. Check your connection and try again.";
      status.hidden = false;
    }
  };

  form.elements.date.addEventListener("change", loadDate);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const date = form.elements.date.value;
    const read = (name) => form.elements[name].value.trim();
    const verseFields = [read("surahNumber"), read("ayahNumber"), read("arabicText"), read("translation")];
    const hadithFields = [read("hadithCollection"), read("hadithReference"), read("hadithText")];
    const announcementFields = [read("announcementTitle"), read("announcementBody")];
    const hasVerse = verseFields.some(Boolean) || Boolean(read("surahName"));
    const hasHadith = hadithFields.some(Boolean) || Boolean(read("hadithGrade"));
    const hasAnnouncement = announcementFields.some(Boolean) || form.elements.announcementActive.checked;

    if ((hasVerse && verseFields.some((field) => !field)) || (hasHadith && hadithFields.some((field) => !field)) || (hasAnnouncement && announcementFields.some((field) => !field))) {
      status.textContent = "Complete all required fields in each content section you use.";
      status.hidden = false;
      return;
    }

    const content = {
      verse: hasVerse ? {
        surahNumber: Number(read("surahNumber")),
        ayahNumber: Number(read("ayahNumber")),
        surahName: read("surahName"),
        arabicText: read("arabicText"),
        translation: read("translation"),
      } : null,
      hadith: hasHadith ? {
        collection: read("hadithCollection"),
        reference: read("hadithReference"),
        grade: read("hadithGrade"),
        text: read("hadithText"),
      } : null,
      announcement: hasAnnouncement ? {
        title: read("announcementTitle"),
        body: read("announcementBody"),
        active: form.elements.announcementActive.checked,
      } : null,
    };

    saveButton.disabled = true;
    status.hidden = true;
    try {
      await update(ref(db, `dailyContent/${date}`), content);
      status.textContent = "Daily content saved.";
      status.hidden = false;
    } catch (error) {
      console.error("[TAZAWWUD] Admin: failed to save daily content:", error);
      status.textContent = "Could not save content. Confirm admin access and try again.";
      status.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  });

  loadDate();
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

async function renderForUser(container, uid) {
  const generation = ++accessCheckGeneration;
  if (listenerAttached) {
    off(storiesRef);
    listenerAttached = false;
  }

  if (!uid) {
    renderSignedOut(container);
    return;
  }

  let isAdmin = false;
  try {
    const snapshot = await get(ref(db, `admins/${uid}`));
    isAdmin = snapshot.val() === true;
  } catch (error) {
    console.error("[TAZAWWUD] Admin: could not check admin status:", error);
  }

  if (generation !== accessCheckGeneration) return;

  if (!isAdmin) {
    renderNotAdmin(container, uid);
    return;
  }

  editingId = null;
  renderAdminShell(container);
  const storiesContainer = container.querySelector("#admin-stories-root");
  onValue(
    storiesRef,
    (snapshot) => {
      const raw = snapshot.val() || {};
      const stories = Object.entries(raw).map(([id, story]) => ({ id, ...story }));
      renderAdminCms(storiesContainer, stories);
    },
    (error) => {
      console.error("[TAZAWWUD] Admin: failed to load stories:", error);
      storiesContainer.innerHTML = `<p class="settings-note">Couldn't load stories. Daily Featured Content management remains available above.</p>`;
    }
  );
  listenerAttached = true;
}

export async function initAdmin(container) {
  if (!container) return;
  container.innerHTML = `<div class="stories-status">Checking access…</div>`;

  // Deliberately does NOT call ensureSignedIn() — that would silently
  // create an anonymous session just for visiting this page. Anonymous
  // isn't a usable identity here anyway (see currentRealUid()).
  renderForUser(container, currentRealUid());
  unsubscribeAuth?.();
  unsubscribeAuth = onUserChanged(() => renderForUser(container, currentRealUid()));
}

/** Detaches the live listener and auth subscription — call when leaving the Admin view. */
export function stopAdmin() {
  if (listenerAttached) {
    off(storiesRef);
    listenerAttached = false;
  }
  unsubscribeAuth?.();
  unsubscribeAuth = null;
  editingId = null;
}
