// ============================================================================
// TAZAWWUD - Prayer Notifications and Muadhin selector
// ----------------------------------------------------------------------------
// Browser notifications and selected Adhan audio while the app is open.
// Browser security policies may prevent audio when the page has no user
// interaction; the enable action unlocks the audio element where permitted.
// ============================================================================

const NOTIFICATION_SETTINGS_KEY = "tazawwud:prayer-notifications-enabled";
const MUADHIN_SETTINGS_KEY = "tazawwud:muadhin";

// Named Adhan recordings are linked from PrayTimes.org's public Adhan Audio
// collection (https://praytimes.org/docs/adhan). That source attributes each
// file by muezzin; keep those displayed names aligned with the source page.
// These are streamed on demand and are never bundled with the app.
const PRAY_TIMES_AUDIO = "https://praytimes.org/audio/sunni";
const MUADHIN_OPTIONS = [
  {
    id: "chime",
    label: "Simple Chime",
    source: "Built-in fallback tone",
  },
  {
    id: "abdul-basit",
    label: "Abdul Basit",
    url: `${PRAY_TIMES_AUDIO}/Abdul-Basit.mp3`,
    source: "PrayTimes.org",
  },
  {
    id: "abdul-ghaffar",
    label: "Abdul Ghaffar",
    url: `${PRAY_TIMES_AUDIO}/Abdul-Ghaffar.mp3`,
    source: "PrayTimes.org",
  },
  {
    id: "abdul-hakam",
    label: "Abdul Hakam",
    url: `${PRAY_TIMES_AUDIO}/Abdul-Hakam.mp3`,
    source: "PrayTimes.org",
  },
  {
    id: "al-hussaini",
    label: "Al-Hussaini",
    url: `${PRAY_TIMES_AUDIO}/Al-Hussaini.mp3`,
    source: "PrayTimes.org",
  },
  {
    id: "minshawi",
    label: "Minshawi",
    url: `${PRAY_TIMES_AUDIO}/Minshawi.mp3`,
    source: "PrayTimes.org",
  },
  {
    id: "naghshbandi",
    label: "Naghshbandi",
    url: `${PRAY_TIMES_AUDIO}/Naghshbandi.mp3`,
    source: "PrayTimes.org",
  },
  {
    id: "hafiz-murad",
    label: "Hafiz Murad",
    url: `${PRAY_TIMES_AUDIO}/Hafiz-Murad.mp3`,
    source: "PrayTimes.org",
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

async function playSelectedAudio(audio, audioContext, option = getSelectedMuadhin()) {
  if (option.id === "chime") return playSimpleChime(audioContext);
  audio.pause();
  audio.currentTime = 0;
  audio.volume = 1;
  try {
    await audio.play();
    return true;
  } catch (error) {
    console.warn("[TAZAWWUD] Selected Adhan audio could not play:", error.message);
    return false;
  }
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
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = AudioContextClass ? new AudioContextClass() : null;
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
      const selected = getSelectedMuadhin();
      playSelectedAudio(audio, audioContext, selected).then((played) => {
        renderStatus(
          root,
          played
            ? `${prayer.name} notification sent; ${selected.label} is playing.`
            : `${prayer.name} notification sent, but ${selected.label} audio could not play. Test the sound or choose another.`,
          !played
        );
      });
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

    // Attempt to unlock audio directly during this user gesture before the
    // permission prompt yields control back to the browser.
    unlockAudio(audio, audioContext);
    const permission = await Notification.requestPermission();
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
    return readEnabled() && isSupported() && Notification.permission === "granted";
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
    const played = await playSelectedAudio(audio, audioContext, option);
    renderStatus(
      root,
      played ? `Playing ${option.label} from ${option.source}.` : `${option.label} could not play. Check your connection or choose another sound.`,
      !played
    );
  }

  function destroy() {
    stopTimer();
    audio.remove();
    audioContext?.close().catch(() => {});
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
