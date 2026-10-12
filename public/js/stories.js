// ============================================================================
// TAZAWWUD — Islamic Stories (public view)
// ----------------------------------------------------------------------------
// Reads from Firebase Realtime Database (stories/{id}), live — a story an
// admin publishes appears here without a page reload, via onValue(). Only
// published === true stories are shown; everything else (who may write,
// field validation, size limits) is enforced by database.rules.json, not
// by this file — this file only decides what to DISPLAY, never what's
// allowed to be WRITTEN.
//
// Content here is admin-authored, not fetched from a third-party API, but
// is still external to this file (comes over the network, could in theory
// be malformed) — escaped the same as any other dynamic content.
// ============================================================================

import { db } from "./firebase-config.js";
import { ref, onValue, off } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { escapeHtml } from "./html-utils.js";

const storiesRef = ref(db, "stories");
let listenerAttached = false;
let latestStories = [];

function escapeAttr(value) {
  return escapeHtml(value).replace(/\n/g, " ");
}

function multiline(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function excerpt(body, max = 140) {
  const plain = String(body || "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}

function renderLoading(container) {
  container.innerHTML = `<div class="stories-status">Loading stories…</div>`;
}

function renderEmpty(container) {
  container.innerHTML = `
    <header class="view-header">
      <h2 class="view-header__title">Islamic Stories</h2>
      <p class="view-header__subtitle">Nothing published here yet — check back soon.</p>
    </header>
  `;
}

function renderList(container, stories) {
  container.innerHTML = `
    <header class="view-header">
      <h2 class="view-header__title">Islamic Stories</h2>
      <p class="view-header__subtitle">${stories.length} stor${stories.length === 1 ? "y" : "ies"}</p>
    </header>
    <ul class="stories-grid">
      ${stories.map((story) => `
        <li class="story-card" data-story-id="${story.id}" tabindex="0" role="button" aria-label="Read ${escapeAttr(story.title)}">
          ${story.imageUrl ? `<img class="story-card__image" src="${escapeAttr(story.imageUrl)}" alt="" loading="lazy" />` : ""}
          <div class="story-card__body">
            ${story.category ? `<span class="story-card__category">${escapeHtml(story.category)}</span>` : ""}
            <h3 class="story-card__title">${escapeHtml(story.title)}</h3>
            <p class="story-card__excerpt">${escapeHtml(excerpt(story.body))}</p>
            ${story.author ? `<p class="story-card__author">${escapeHtml(story.author)}</p>` : ""}
          </div>
        </li>
      `).join("")}
    </ul>
  `;

  container.querySelectorAll("[data-story-id]").forEach((card) => {
    const open = () => {
      const story = stories.find((s) => s.id === card.dataset.storyId);
      if (story) renderDetail(container, story, stories);
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

function renderDetail(container, story, stories) {
  container.innerHTML = `
    <button type="button" class="reader-back-btn" id="story-back-btn">
      <span class="material-symbols-rounded icon" aria-hidden="true">arrow_back</span>
      All Stories
    </button>
    <article class="story-detail">
      ${story.imageUrl ? `<img class="story-detail__image" src="${escapeAttr(story.imageUrl)}" alt="" />` : ""}
      ${story.category ? `<span class="story-card__category">${escapeHtml(story.category)}</span>` : ""}
      <h2 class="story-detail__title">${escapeHtml(story.title)}</h2>
      ${story.author ? `<p class="story-detail__author">${escapeHtml(story.author)}</p>` : ""}
      <div class="story-detail__body">${multiline(story.body)}</div>
    </article>
  `;
  container.querySelector("#story-back-btn")?.addEventListener("click", () => renderList(container, stories));
  container.scrollIntoView?.({ block: "start" });
}

function handleSnapshot(container, snapshot) {
  const raw = snapshot.val() || {};
  latestStories = Object.entries(raw)
    .map(([id, story]) => ({ id, ...story }))
    .filter((story) => story.published === true)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!latestStories.length) {
    renderEmpty(container);
  } else {
    renderList(container, latestStories);
  }
}

export function initStories(container) {
  if (!container) return;
  renderLoading(container);

  if (listenerAttached) off(storiesRef);
  onValue(
    storiesRef,
    (snapshot) => handleSnapshot(container, snapshot),
    (error) => {
      console.error("[TAZAWWUD] Failed to load Stories:", error);
      container.innerHTML = `
        <div class="stories-status stories-status--error">
          Couldn't load Stories right now. Please check your connection and try again.
        </div>
      `;
    }
  );
  listenerAttached = true;
}

/** Detaches the live listener — call when leaving the Stories view. */
export function stopStories() {
  if (listenerAttached) {
    off(storiesRef);
    listenerAttached = false;
  }
}
