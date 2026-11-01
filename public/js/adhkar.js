// ============================================================================
// TAZAWWUD - Daily Guidance and Adhkar (Phase 11)
// ----------------------------------------------------------------------------
// Curated, static reminders keep the dashboard available offline. Counter
// progress is scoped to the current local date and stored in localStorage.
// ============================================================================

const COUNTER_STORAGE_KEY = "tazawwud:adhkar-progress";

const ADHKAR = {
  morning: [
    {
      id: "morning-1",
      arabic: "أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ",
      translation: "We have entered the morning and the dominion belongs to Allah; praise belongs to Allah.",
      target: 1,
    },
    {
      id: "morning-2",
      arabic: "رَضِيتُ بِاللَّهِ رَبًّا، وَبِالإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ نَبِيًّا",
      translation: "I am pleased with Allah as my Lord, Islam as my religion, and Muhammad as my Prophet.",
      target: 3,
    },
    {
      id: "morning-3",
      arabic: "سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
      translation: "Glory is to Allah and praise is to Him.",
      target: 100,
    },
  ],
  evening: [
    {
      id: "evening-1",
      arabic: "أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ",
      translation: "We have entered the evening and the dominion belongs to Allah; praise belongs to Allah.",
      target: 1,
    },
    {
      id: "evening-2",
      arabic: "اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ",
      translation: "O Allah, I ask You for pardon and well-being in this world and the Hereafter.",
      target: 3,
    },
    {
      id: "evening-3",
      arabic: "أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ",
      translation: "I seek Allah's forgiveness and repent to Him.",
      target: 100,
    },
  ],
};

let initializedRoot = null;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function readProgress() {
  try {
    const stored = JSON.parse(localStorage.getItem(COUNTER_STORAGE_KEY) || "null");
    if (stored?.date === localDateKey() && stored.counts) return stored.counts;
  } catch (error) {
    console.warn("[TAZAWWUD] Could not read Adhkar progress:", error);
  }
  return {};
}

function saveProgress(counts) {
  localStorage.setItem(COUNTER_STORAGE_KEY, JSON.stringify({ date: localDateKey(), counts }));
}

function renderDhikrItem(item, counts) {
  const count = Math.min(Number(counts[item.id]) || 0, item.target);
  const complete = count >= item.target;
  return `
    <article class="dhikr-card${complete ? " is-complete" : ""}" data-dhikr-id="${item.id}">
      <div class="dhikr-card__copy">
        <p class="dhikr-card__arabic" lang="ar" dir="rtl">${escapeHtml(item.arabic)}</p>
        <p class="dhikr-card__translation">${escapeHtml(item.translation)}</p>
      </div>
      <div class="dhikr-card__counter">
        <span class="dhikr-card__progress" data-dhikr-progress>${count} / ${item.target}</span>
        <button type="button" class="dhikr-count-button" data-dhikr-count ${complete ? "disabled" : ""} aria-label="Repeat dhikr ${count} of ${item.target}">
          <span class="material-symbols-rounded icon" aria-hidden="true">${complete ? "check" : "touch_app"}</span>
          <span>${complete ? "Completed" : "Count"}</span>
        </button>
        <button type="button" class="dhikr-reset-button" data-dhikr-reset>Reset</button>
        <button type="button" class="dhikr-listen-button" data-dhikr-listen aria-label="Listen to this dhikr">Listen</button>
      </div>
    </article>
  `;
}

function renderAdhkar(root, counts) {
  root.querySelector("[data-adhkar-content]").innerHTML = `
    <div class="adhkar-tabs" role="tablist" aria-label="Adhkar period">
      <button type="button" class="adhkar-tab is-active" data-adhkar-tab="morning" role="tab" aria-selected="true">Morning <span lang="ar" dir="rtl">أذكار الصباح</span></button>
      <button type="button" class="adhkar-tab" data-adhkar-tab="evening" role="tab" aria-selected="false">Evening <span lang="ar" dir="rtl">أذكار المساء</span></button>
    </div>
    <div class="adhkar-list" data-adhkar-list>
      ${ADHKAR.morning.map((item) => renderDhikrItem(item, counts)).join("")}
    </div>
  `;

  root.querySelectorAll("[data-adhkar-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const category = tab.dataset.adhkarTab;
      root.querySelectorAll("[data-adhkar-tab]").forEach((candidate) => {
        const active = candidate === tab;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-selected", String(active));
      });
      root.querySelector("[data-adhkar-list]").innerHTML = ADHKAR[category]
        .map((item) => renderDhikrItem(item, counts)).join("");
      wireCounters(root, counts);
    });
  });
  wireCounters(root, counts);
}

/**
 * Reads the Arabic dhikr aloud, using the phone's own Arabic voice. It is free, and needs no
 * recording. Recorded audio can replace it later, once a source with a licence is approved.
 */
function speakArabic(text, button) {
  if (!("speechSynthesis" in window)) {
    button.textContent = "Not available";
    button.disabled = true;
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ar-SA";
  utterance.rate = 0.85;
  button.textContent = "Playing…";
  utterance.onend = () => { button.textContent = "Listen"; };
  utterance.onerror = () => { button.textContent = "Listen"; };
  window.speechSynthesis.speak(utterance);
}

function wireCounters(root, counts) {
  root.querySelectorAll(".dhikr-card").forEach((card) => {
    const id = card.dataset.dhikrId;
    const item = [...ADHKAR.morning, ...ADHKAR.evening].find((entry) => entry.id === id);
    card.querySelector("[data-dhikr-count]").addEventListener("click", () => {
      counts[id] = Math.min((Number(counts[id]) || 0) + 1, item.target);
      saveProgress(counts);
      const progress = card.querySelector("[data-dhikr-progress]");
      const complete = counts[id] >= item.target;
      progress.textContent = `${counts[id]} / ${item.target}`;
      card.classList.toggle("is-complete", complete);
      const button = card.querySelector("[data-dhikr-count]");
      button.disabled = complete;
      button.innerHTML = `<span class="material-symbols-rounded icon" aria-hidden="true">${complete ? "check" : "touch_app"}</span><span>${complete ? "Completed" : "Count"}</span>`;
    });
    card.querySelector("[data-dhikr-listen]").addEventListener("click", (event) => {
      speakArabic(item.arabic, event.currentTarget);
    });
    card.querySelector("[data-dhikr-reset]").addEventListener("click", () => {
      counts[id] = 0;
      saveProgress(counts);
      const activeTab = root.querySelector("[data-adhkar-tab].is-active")?.dataset.adhkarTab || "morning";
      root.querySelector("[data-adhkar-list]").innerHTML = ADHKAR[activeTab]
        .map((entry) => renderDhikrItem(entry, counts)).join("");
      wireCounters(root, counts);
    });
  });
}

export function initDailyGuidance(root) {
  if (!root || initializedRoot === root) return;
  initializedRoot = root;
  const counts = readProgress();
  root.innerHTML = `<section class="adhkar-section" aria-labelledby="adhkar-heading">
      <div class="daily-section-heading">
        <div>
          <p class="daily-eyebrow">Remembrance</p>
          <h2 id="adhkar-heading">Daily Adhkar</h2>
        </div>
        <span class="material-symbols-rounded icon" aria-hidden="true">self_improvement</span>
      </div>
      <div data-adhkar-content></div>
    </section>`;
  renderAdhkar(root, counts);
}
