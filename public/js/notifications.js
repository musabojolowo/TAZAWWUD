// ============================================================================
// TAZAWWUD - Prayer Notifications (Phase 8)
// ----------------------------------------------------------------------------
// Browser notifications and a short HTML5 audio chime while the app is open.
// Browser security policies may prevent audio when the page has no user
// interaction; the enable action unlocks the audio element where permitted.
// ============================================================================

const NOTIFICATION_SETTINGS_KEY = "tazawwud:prayer-notifications-enabled";
const MUADHIN_SETTINGS_KEY = "tazawwud:muadhin";

// Sourcing note (see docs/SECURITY-AUDIT-CHECKLIST.md / the Adhan work item
// report): there is no equivalent of mp3quran.net (a well-established,
// professionally-run CDN) specifically for Adhan *call* recordings by named
// muadhin/city — searched extensively, found only unverifiable download
// sites. Rather than hardlink those and mislabel their attribution, this
// list has exactly two entries: the original short chime (guaranteed
// reliable, zero attribution risk) and one generic Adhan recording from a
// stable host (GitHub raw), honestly labeled as unverified/generic rather
// than claimed to be a specific named reciter or mosque. If a licensed,
// per-muadhin Adhan audio set becomes available, add entries here — the
// selector UI and playback logic already support any number of options.
const MUADHIN_OPTIONS = [
  {
    id: "chime",
    label: "Simple Chime",
    url: "https://actions.google.com/sounds/v1/alarms/beep_short.ogg",
    verified: true,
  },
  {
    id: "adhan-generic",
    label: "Adhan (generic recording, unverified source)",
    url: "https://raw.githubusercontent.com/AalianKhan/adhans/master/adhan.mp3",
    verified: false,
  },
];

function getMuadhinOptions() {
  return MUADHIN_OPTIONS;
}

function readSelectedMuadhinId() {
  return localStorage.getItem(MUADHIN_SETTINGS_KEY) || MUADHIN_OPTIONS[0].id;
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
  return "Notification" in window;
}

export function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}

function readEnabled() {
  return localStorage.getItem(NOTIFICATION_SETTINGS_KEY) === "true";
}

function writeEnabled(enabled) {
  localStorage.setItem(NOTIFICATION_SETTINGS_KEY, String(enabled));
}

function parsePrayerMinute(time) {
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function createAudio() {
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.src = getSelectedMuadhin().url;
  audio.setAttribute("aria-hidden", "true");
  audio.style.display = "none";
  document.body.appendChild(audio);
  return audio;
}

function unlockAudio(audio) {
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

function playChime(audio) {
  audio.currentTime = 0;
  audio.volume = 1;
  const playback = audio.play();
  playback?.catch((error) => {
    console.warn("[TAZAWWUD] Prayer chime could not play:", error.message);
  });
}

function showPrayerNotification(prayer) {
  if (!isSupported() || Notification.permission !== "granted") return;
  new Notification(`${prayer.name} - TAZAWWUD`, {
    body: `It is time for ${prayer.name} prayer (${prayer.arabic}).`,
    tag: `tazawwud-prayer-${prayer.key}`,
    icon: "/icons/icon-192.png",
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
      const minute = parsePrayerMinute(timings[key]);
      if (minute === null || minute !== currentMinute) return;

      const alertKey = `${todayKey()}-${key}-${currentMinute}`;
      if (lastAlertKey === alertKey) return;
      lastAlertKey = alertKey;

      const prayer = {
        key,
        name: element.dataset.prayerName,
        arabic: element.dataset.prayerArabic,
      };
      showPrayerNotification(prayer);
      playChime(audio);
      renderStatus(root, `${prayer.name} alert sent.`);
    });
  }

  function startTimer() {
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

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      writeEnabled(false);
      stopTimer();
      renderStatus(root, "Notification permission was not granted.", true);
      return false;
    }

    writeEnabled(true);
    unlockAudio(audio);
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
    return readEnabled() && isSupported() && Notification.permission === "granted";
  }

  /** Switches which recording plays for the Adhan/chime, and persists the choice. */
  function setMuadhin(id) {
    const option = MUADHIN_OPTIONS.find((entry) => entry.id === id);
    if (!option) return;
    writeSelectedMuadhinId(option.id);
    audio.src = option.url;
  }

  /** Plays the currently-selected sound once, for a "Test" button — unlocks
   *  audio the same way enable() does, so Test works even before notifications
   *  have been turned on. */
  function testPlayback() {
    unlockAudio(audio);
    playChime(audio);
  }

  function destroy() {
    stopTimer();
    audio.remove();
  }

  if (readEnabled() && isSupported() && Notification.permission === "granted") {
    startTimer();
  }

  return {
    enable,
    disable,
    destroy,
    isEnabled,
    setPrayerTimes,
    setMuadhin,
    testPlayback,
    getMuadhinOptions,
    getSelectedMuadhinId: readSelectedMuadhinId,
  };
}
