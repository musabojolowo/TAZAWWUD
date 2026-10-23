// ============================================================================
// TAZAWWUD - Prayer Notifications and Muadhin selector
// ----------------------------------------------------------------------------
// Browser notifications and selected Adhan audio while the app is open.
// Browser security policies may prevent audio when the page has no user
// interaction; the enable action unlocks the audio element where permitted.
// ============================================================================

import { loadPrefs, savePrefs, claimOnce, displayAlert, parseMinute } from "./notification-prefs.js";
import { notificationApiAvailable, notificationPermissionSync, requestNotificationPermission, inNativeApp } from "./native-bridge.js";

const NOTIFICATION_SETTINGS_KEY = "tazawwud:prayer-notifications-enabled";
const MUADHIN_SETTINGS_KEY = "tazawwud:muadhin";

// Named Adhan recordings are MP3 files stored in this project under
// public/assets/adhan/, one per reciter, with the exact file names below.
// Only add recordings you have the right to use. If a file is missing, the
// app plays the built-in chime and says so.
const ADHAN_AUDIO_BASE = "/assets/adhan";
const MUADHIN_OPTIONS = [
  {
    id: "chime",
    label: "Simple Chime",
    source: "Built-in fallback tone",
  },
  {
    id: "abdul-basit",
    label: "Abdul Basit",
    url: `${ADHAN_AUDIO_BASE}/Abdul-Basit.mp3`,
    source: "Project audio",
  },
  {
    id: "abdul-ghaffar",
    label: "Abdul Ghaffar",
    url: `${ADHAN_AUDIO_BASE}/Abdul-Ghaffar.mp3`,
    source: "Project audio",
  },
  {
    id: "abdul-hakam",
    label: "Abdul Hakam",
    url: `${ADHAN_AUDIO_BASE}/Abdul-Hakam.mp3`,
    source: "Project audio",
  },
  {
    id: "al-hussaini",
    label: "Al-Hussaini",
    url: `${ADHAN_AUDIO_BASE}/Al-Hussaini.mp3`,
    source: "Project audio",
  },
  {
    id: "minshawi",
    label: "Minshawi",
    url: `${ADHAN_AUDIO_BASE}/Minshawi.mp3`,
    source: "Project audio",
  },
  {
    id: "naghshbandi",
    label: "Naghshbandi",
    url: `${ADHAN_AUDIO_BASE}/Naghshbandi.mp3`,
    source: "Project audio",
  },
  {
    id: "hafiz-murad",
    label: "Hafiz Murad",
    url: `${ADHAN_AUDIO_BASE}/Hafiz-Murad.mp3`,
    source: "Project audio",
  },
  {
    id: "adhan-egypt",
    label: "Egypt",
    url: `${ADHAN_AUDIO_BASE}/Adhan-Egypt.mp3`,
    source: "Project audio",
  },
  {
    id: "adhan-madinah",
    label: "Madinah",
    url: `${ADHAN_AUDIO_BASE}/Adhan-Madinah.mp3`,
    source: "Project audio",
  },
  {
    id: "adhan-alaqsa",
    label: "Al-Aqsa",
    url: `${ADHAN_AUDIO_BASE}/Adhan-Alaqsa.mp3`,
    source: "Project audio",
  },
  {
    id: "adhan-makkah",
    label: "Makkah",
    url: `${ADHAN_AUDIO_BASE}/Adhan-Makkah.mp3`,
    source: "Project audio",
  },
  {
    id: "yusuf-islam",
    label: "Yusuf Islam",
    url: `${ADHAN_AUDIO_BASE}/Yusuf-Islam.mp3`,
    source: "Project audio",
  },
];

function getMuadhinOptions() {
  return MUADHIN_OPTIONS;
}

function readSelectedMuadhinId() {
  const savedId = localStorage.getItem(MUADHIN_SETTINGS_KEY);
  return MUADHIN_OPTIONS.some((option) => option.id === savedId) ? savedId : MUADHIN_OPTIONS[0].id;
}

function writeSelectedMuadhinId(id) {
  localStorage.setItem(MUADHIN_SETTINGS_KEY, id);
}

function getSelectedMuadhin() {
  return MUADHIN_OPTIONS.find((option) => option.id === readSelectedMuadhinId()) || MUADHIN_OPTIONS[0];
}

// Exported for reuse by reminders.js (same browser-support check, same
// "what day is it" key format — not duplicated there).
export function isSupported() {
  return notificationApiAvailable();
}

export function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

// The master switch now lives in the notification settings (notification-prefs.js),
// which also keep the old key in step, so existing behaviour is unchanged.
function readEnabled() {
  return loadPrefs().master;
}

function writeEnabled(enabled) {
  savePrefs({ ...loadPrefs(), master: enabled });
}

function parsePrayerMinute(time) {
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function createAudio() {
  const audio = document.createElement("audio");
  audio.preload = "none";
  const selected = getSelectedMuadhin();
  if (selected.url) audio.src = selected.url;
  audio.setAttribute("aria-hidden", "true");
  audio.style.display = "none";
  document.body.appendChild(audio);
  return audio;
}

function unlockAudio(audio, audioContext) {
  audioContext?.resume().catch(() => {});
  if (!audio.src) return;
  audio.volume = 0;
  const unlock = audio.play();
  if (unlock && typeof unlock.then === "function") {
    unlock
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
      })
      .catch(() => {
        audio.volume = 1;
      });
  } else {
    audio.volume = 1;
  }
}

function playSimpleChime(audioContext) {
  if (!audioContext) return Promise.resolve(false);
  return audioContext.resume().then(() => new Promise((resolve) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const start = audioContext.currentTime;
    const notes = [
      { at: 0, frequency: 880 },
      { at: 0.27, frequency: 1174.66 },
      { at: 0.56, frequency: 1567.98 },
    ];
    oscillator.type = "sine";
    notes.forEach(({ at, frequency }) => {
      oscillator.frequency.setValueAtTime(frequency, start + at);
      gain.gain.setValueAtTime(0.001, start + at);
      gain.gain.linearRampToValueAtTime(0.11, start + at + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, start + at + 0.23);
    });
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      resolve(true);
    };
    oscillator.start(start);
    oscillator.stop(start + 0.84);
  })).catch((error) => {
    console.warn("[TAZAWWUD] Built-in chime could not play:", error.message);
    return false;
  });
}

/**
 * Plays the chosen sound. Resolves to:
 *   "selected" - the chosen recording played
 *   "chime"    - the recording could not play, so the built-in chime did
 *   false      - nothing could play
 * The recording's failure is never silent: callers show which one played.
 */
async function playSelectedAudio(audio, audioContext, option = getSelectedMuadhin()) {
  if (option.id === "chime") {
    return (await playSimpleChime(audioContext)) ? "chime" : false;
  }
  if (!option.url) {
    return (await playSimpleChime(audioContext)) ? "chime" : false;
  }
  audio.pause();
  if (audio.src !== option.url) {
    audio.src = option.url;
    audio.load();
  }
  audio.currentTime = 0;
  audio.volume = 1;
  try {
    await audio.play();
    return "selected";
  } catch (error) {
    console.warn("[TAZAWWUD] Selected Adhan audio could not play:", error.message);
    return (await playSimpleChime(audioContext)) ? "chime" : false;
  }
}

function showPrayerNotification(prayer) {
  if (!isSupported()) return;
  displayAlert({
    title: `${prayer.name} - TAZAWWUD`,
    body: `It is time for ${prayer.name} prayer (${prayer.arabic}).`,
    tag: `tazawwud-prayer-${prayer.key}`,
    url: "/#salah",
  });
}

function renderStatus(root, message, isError = false) {
  const status = root.querySelector("[data-notification-status]");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("salah-notification__status--error", isError);
}

export function createNotificationManager(root) {
  const audio = createAudio();
  // Created on the first user gesture (Enable or Test), not at page load:
  // a context created without a gesture stays suspended on many phones.
  let audioContext = null;
  function getAudioContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = AudioContextClass ? new AudioContextClass() : null;
    }
    return audioContext;
  }
  let timings = null;
  let lastAlertKey = "";
  let timerId = null;

  function checkPrayerTimes() {
    if (!timings || !readEnabled()) return;
    const now = new Date();
    const currentMinute = now.getHours() * 60 + now.getMinutes();
    const prayers = root.querySelectorAll("[data-prayer-key]");

    prayers.forEach((element) => {
      const key = element.dataset.prayerKey;
      // Per-prayer switch and the offset from the settings (default: at prayer time).
      const prefs = loadPrefs();
      if (prefs.prayers[key] === false) return;
      const prayerMinute = parseMinute(timings[key]);
      if (prayerMinute === null) return;
      if ((prayerMinute + prefs.offsetMinutes + 1440) % 1440 !== currentMinute) return;

      const prayer = {
        key,
        name: element.dataset.prayerName,
        arabic: element.dataset.prayerArabic,
      };
      // The notification and the Adhan audio are each shown once per day, whichever
      // path (this page or the global scheduler) gets there first.
      // Ids match the global scheduler's ids exactly ("prayer:Fajr@310"), so the two
      // paths can never both show the same alert.
      if (claimOnce(`prayer:${key}@${currentMinute}`)) showPrayerNotification(prayer);
      if (!claimOnce(`audio:${key}@${currentMinute}`)) return;
      const selected = getSelectedMuadhin();
      playSelectedAudio(audio, getAudioContext(), selected).then((played) => {
        renderStatus(
          root,
          played === "selected"
            ? `${prayer.name} notification sent; ${selected.label} is playing.`
            : played === "chime"
              ? `${prayer.name} notification sent; ${selected.label} could not load, so the built-in chime played.`
              : `${prayer.name} notification sent, but no sound could play. Test the sound or choose another.`,
          !played
        );
      });
    });
  }

  function startTimer() {
    // Inside the Android app the native scheduler sends every alert, so the page must not.
    if (inNativeApp()) return;
    if (timerId !== null) return;
    checkPrayerTimes();
    timerId = window.setInterval(checkPrayerTimes, 15000);
  }

  function stopTimer() {
    if (timerId === null) return;
    window.clearInterval(timerId);
    timerId = null;
  }

  async function enable() {
    if (!isSupported()) {
      renderStatus(root, "Notifications are not supported in this browser.", true);
      return false;
    }

    // Attempt to unlock audio directly during this user gesture before the
    // permission prompt yields control back to the browser.
    unlockAudio(audio, getAudioContext());
    const permission = await requestNotificationPermission();
    if (permission !== "granted") {
      writeEnabled(false);
      stopTimer();
      renderStatus(root, "Notification permission was not granted.", true);
      return false;
    }

    writeEnabled(true);
    startTimer();
    renderStatus(root, "Prayer notifications are enabled.");
    return true;
  }

  function disable() {
    writeEnabled(false);
    stopTimer();
    renderStatus(root, "Prayer notifications are disabled.");
  }

  function setPrayerTimes(nextTimings) {
    timings = nextTimings;
    if (readEnabled()) startTimer();
  }

  function isEnabled() {
    return readEnabled() && isSupported() && notificationPermissionSync();
  }

  /** Shows the status that matches the current state, without changing anything. */
  function refreshStatus() {
    if (isEnabled()) {
      renderStatus(root, "Prayer notifications are enabled.");
    } else if (readEnabled() && isSupported() && !notificationPermissionSync()) {
      renderStatus(root, "Notification permission was not granted.", true);
    } else {
      renderStatus(root, "Prayer notifications are disabled.");
    }
  }

  function showStatus(message, isError = false) {
    renderStatus(root, message, isError);
  }

  /** Switches which recording plays for the Adhan/chime, and persists the choice. */
  function setMuadhin(id) {
    const option = MUADHIN_OPTIONS.find((entry) => entry.id === id);
    if (!option) return;
    writeSelectedMuadhinId(option.id);
    if (option.url) audio.src = option.url;
    else audio.removeAttribute("src");
    audio.load();
  }

  /** Plays the currently-selected sound once, for a "Test" button — unlocks
   *  audio the same way enable() does, so Test works even before notifications
   *  have been turned on. */
  async function testPlayback() {
    const option = getSelectedMuadhin();
    renderStatus(root, `Testing ${option.label}…`);
    const played = await playSelectedAudio(audio, getAudioContext(), option);
    renderStatus(
      root,
      played === "selected"
        ? `Playing ${option.label} from ${option.source}.`
        : played === "chime"
          ? `${option.label} could not load, so the built-in chime played instead.`
          : `${option.label} could not play. Check your connection or choose another sound.`,
      !played
    );
  }

  function destroy() {
    stopTimer();
    audio.remove();
    audioContext?.close().catch(() => {});
  }

  if (readEnabled() && isSupported() && notificationPermissionSync()) {
    startTimer();
  }

  return {
    enable,
    disable,
    refreshStatus,
    showStatus,
    destroy,
    isEnabled,
    setPrayerTimes,
    setMuadhin,
    testPlayback,
    getMuadhinOptions,
    getSelectedMuadhinId: readSelectedMuadhinId,
  };
}
