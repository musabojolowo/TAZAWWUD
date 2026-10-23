// ============================================================================
// TAZAWWUD - Notifications screen
// ----------------------------------------------------------------------------
// The notification switch, Muadhin, prayer alerts and test buttons. The alerts
// themselves run in notification-hub.js, so they keep working with this screen closed.
// ============================================================================

import { getNotificationManager } from "./notification-hub.js";
import { loadPrefs, updatePrefs } from "./notification-prefs.js";

let initializedRoot = null;

export function initNotifications(root) {
  if (!root || initializedRoot === root) return;
  initializedRoot = root;
  root.innerHTML = renderMarkup();

  const notificationManager = getNotificationManager();
  const notificationToggle = root.querySelector("[data-salah-notifications]");

  // The native permission arrives a moment after the page draws, so refresh when it does.
  const refreshNotificationControls = () => {
    notificationToggle.checked = notificationManager.isEnabled();
    notificationManager.refreshStatus();
  };
  window.addEventListener("tazawwud:notification-permission-changed", refreshNotificationControls);
  refreshNotificationControls();

  notificationToggle.addEventListener("change", async (event) => {
    if (event.currentTarget.checked) {
      const enabled = await notificationManager.enable();
      event.currentTarget.checked = enabled;
    } else {
      notificationManager.disable();
    }
  });

  wireAlertPrefs(root);

  const muadhinSelect = root.querySelector("[data-salah-muadhin]");
  if (muadhinSelect) {
    muadhinSelect.innerHTML = notificationManager
      .getMuadhinOptions()
      .map((option) => `<option value="${option.id}">${option.label}</option>`)
      .join("");
    muadhinSelect.value = notificationManager.getSelectedMuadhinId();
    muadhinSelect.addEventListener("change", (event) => {
      notificationManager.setMuadhin(event.target.value);
    });
  }
  root.querySelector("[data-salah-muadhin-test]")?.addEventListener("click", () => {
    notificationManager.testPlayback();
  });
}

function renderMarkup() {
  return `
      <div class="salah-preferences">
        <label class="salah-notification__toggle" for="salah-notifications-enabled">
          <input id="salah-notifications-enabled" type="checkbox" data-salah-notifications />
          <span>Enable prayer notifications</span>
        </label>
        <label for="salah-muadhin">Muadhin</label>
        <div class="salah-muadhin-row">
          <select id="salah-muadhin" class="salah-select" data-salah-muadhin></select>
          <button type="button" class="salah-button salah-button--secondary" data-salah-muadhin-test>Test</button>
        </div>
        <p class="salah-preferences__hint">Named Adhan recordings play from files in this app; Simple Chime works without any audio files.</p>
        <div class="salah-alerts" data-salah-alerts>
          <p class="salah-alerts__heading">Prayer alerts</p>
          <div class="salah-alerts__prayers">
            <label><input type="checkbox" data-prayer-toggle="Fajr" /> Fajr</label>
            <label><input type="checkbox" data-prayer-toggle="Dhuhr" /> Dhuhr</label>
            <label><input type="checkbox" data-prayer-toggle="Asr" /> Asr</label>
            <label><input type="checkbox" data-prayer-toggle="Maghrib" /> Maghrib</label>
            <label><input type="checkbox" data-prayer-toggle="Isha" /> Isha</label>
          </div>
          <label for="salah-alert-offset">Minutes before (−) or after (+) prayer time</label>
          <input id="salah-alert-offset" class="salah-select" type="number" min="-60" max="60" step="1" data-alert-offset />
          <label><input type="checkbox" data-alert-quran-enabled /> Qur'an reminder</label>
          <input class="salah-select" type="time" data-alert-quran-time aria-label="Qur'an reminder time" />
          <label><input type="checkbox" data-alert-adhkar-morning /> Morning Adhkar (after Fajr)</label>
          <label><input type="checkbox" data-alert-adhkar-evening /> Evening Adhkar (after Asr)</label>
          <label for="salah-alert-adhkar-delay">Adhkar: minutes after the prayer</label>
          <input id="salah-alert-adhkar-delay" class="salah-select" type="number" min="0" max="120" step="1" data-alert-adhkar-delay />
          <label><input type="checkbox" data-alert-friday-enabled /> Friday reminder (1 hour before Jumu'ah)</label>
          <label for="salah-alert-jumuah">Jumu'ah time</label>
          <input id="salah-alert-jumuah" class="salah-select" type="time" data-alert-jumuah />
          <p class="salah-preferences__hint" data-alert-jumuah-hint></p>
        </div>
        <p class="salah-notification__status" data-notification-status role="status">
          Checking notification status…
        </p>
      </div>
  `;
}

function wireAlertPrefs(root) {
  const prefs = loadPrefs();

  root.querySelectorAll("[data-prayer-toggle]").forEach((input) => {
    const key = input.dataset.prayerToggle;
    input.checked = prefs.prayers[key] !== false;
    input.addEventListener("change", () => updatePrefs({ prayers: { [key]: input.checked } }));
  });

  const offset = root.querySelector("[data-alert-offset]");
  offset.value = String(prefs.offsetMinutes);
  offset.addEventListener("change", () => {
    const value = Math.min(60, Math.max(-60, Math.round(Number(offset.value) || 0)));
    offset.value = String(value);
    updatePrefs({ offsetMinutes: value });
  });

  const quranEnabled = root.querySelector("[data-alert-quran-enabled]");
  const quranTime = root.querySelector("[data-alert-quran-time]");
  quranEnabled.checked = prefs.quran.enabled;
  quranTime.value = prefs.quran.time;
  quranEnabled.addEventListener("change", () => updatePrefs({ quran: { enabled: quranEnabled.checked } }));
  quranTime.addEventListener("change", () => {
    if (quranTime.value) updatePrefs({ quran: { time: quranTime.value } });
  });

  const morning = root.querySelector("[data-alert-adhkar-morning]");
  const evening = root.querySelector("[data-alert-adhkar-evening]");
  const delay = root.querySelector("[data-alert-adhkar-delay]");
  morning.checked = prefs.adhkar.morningEnabled;
  evening.checked = prefs.adhkar.eveningEnabled;
  delay.value = String(prefs.adhkar.minutesAfterPrayer);
  morning.addEventListener("change", () => updatePrefs({ adhkar: { morningEnabled: morning.checked } }));
  evening.addEventListener("change", () => updatePrefs({ adhkar: { eveningEnabled: evening.checked } }));
  delay.addEventListener("change", () => {
    const value = Math.min(120, Math.max(0, Math.round(Number(delay.value) || 0)));
    delay.value = String(value);
    updatePrefs({ adhkar: { minutesAfterPrayer: value } });
  });

  const friday = root.querySelector("[data-alert-friday-enabled]");
  const jumuah = root.querySelector("[data-alert-jumuah]");
  const jumuahHint = root.querySelector("[data-alert-jumuah-hint]");
  const showJumuahHint = (time) => {
    jumuahHint.textContent = time
      ? "The Friday reminder is set for one hour before this time."
      : "Set your Jumu'ah time to turn on the Friday reminder.";
  };
  friday.checked = prefs.friday.enabled;
  jumuah.value = prefs.friday.jumuahTime || "";
  showJumuahHint(prefs.friday.jumuahTime);
  friday.addEventListener("change", () => updatePrefs({ friday: { enabled: friday.checked } }));
  jumuah.addEventListener("change", () => {
    const time = jumuah.value || null;
    updatePrefs({ friday: { jumuahTime: time } });
    showJumuahHint(time);
  });
}
