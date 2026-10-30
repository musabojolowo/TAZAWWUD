// ============================================================================
// TAZAWWUD - Notifications screen
// ----------------------------------------------------------------------------
// The notification switch, Muadhin, prayer alerts and test buttons. The alerts
// themselves run in notification-hub.js, so they keep working with this screen closed.
// ============================================================================

import { getNotificationManager } from "./notification-hub.js";
import { loadPrefs, updatePrefs } from "./notification-prefs.js";
import { getAlarmStatus, openExactAlarmSettings, openBatterySettings } from "./native-bridge.js";

let initializedRoot = null;

const STYLE_HREF = "/css/notifications.css";

function ensureStylesheet() {
  if (document.querySelector(`link[href="${STYLE_HREF}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_HREF;
  document.head.append(link);
}

export function initNotifications(root) {
  if (!root || initializedRoot === root) return;
  initializedRoot = root;
  ensureStylesheet();
  root.innerHTML = renderMarkup();
  showAlarmWarning(root);

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

/**
 * On the phone, warns when exact alarms or battery use would make Adhan late, and opens the right setting.
 * Does nothing in a browser, or when everything is already allowed.
 */
async function showAlarmWarning(root) {
  const status = await getAlarmStatus();
  if (!status || (status.exactAlarms && status.batteryUnrestricted)) return;
  const card = document.createElement("section");
  card.className = "nt-alarm";
  card.setAttribute("role", "alert");
  const reasons = [];
  if (!status.exactAlarms) reasons.push("Allow “Alarms & reminders” for TAZAWWUD, so prayer alerts ring on time.");
  if (!status.batteryUnrestricted) reasons.push("Set the battery for TAZAWWUD to Unrestricted, so the phone doesn’t delay alerts.");
  card.innerHTML = `
    <p class="nt-alarm__title">Adhan and reminders may arrive late</p>
    ${reasons.map((text) => `<p class="nt-alarm__text">${text}</p>`).join("")}
    <div class="nt-alarm__actions">
      ${!status.exactAlarms ? '<button type="button" class="nt-button" data-alarm-exact>Allow alarms</button>' : ""}
      ${!status.batteryUnrestricted ? '<button type="button" class="nt-button" data-alarm-battery>Battery settings</button>' : ""}
    </div>`;
  card.querySelector("[data-alarm-exact]")?.addEventListener("click", () => openExactAlarmSettings());
  card.querySelector("[data-alarm-battery]")?.addEventListener("click", () => openBatterySettings());
  root.querySelector(".nt-page")?.prepend(card);
}

function renderMarkup() {
  return `
      <div class="nt-page">
        <h2 class="nt-group">Notification Settings</h2>
        <section class="nt-card nt-master">
          <label class="nt-switch" for="salah-notifications-enabled">
            <input id="salah-notifications-enabled" type="checkbox" data-salah-notifications />
            <span class="nt-switch__track" aria-hidden="true"></span>
            <span class="nt-switch__label">Enable prayer notifications</span>
          </label>
          <p class="nt-status" data-notification-status role="status">Checking notification status…</p>
        </section>

        <section class="nt-section" aria-labelledby="nt-prayer-heading">
          <h3 class="nt-section__title" id="nt-prayer-heading">Prayer &amp; Adhan</h3>
          <div class="nt-card">
            <div class="nt-row">
              <label class="nt-row__label" for="salah-muadhin">Muadhin</label>
              <div class="nt-row__control nt-inline">
                <select id="salah-muadhin" class="nt-select" data-salah-muadhin></select>
                <button type="button" class="nt-button" data-salah-muadhin-test>Test</button>
              </div>
            </div>
            <p class="nt-hint">Named Adhan recordings play from files in this app. Simple Chime works without any audio files.</p>
            <div class="nt-chips" role="group" aria-label="Prayers that play an alert">
              <label class="nt-chip"><input type="checkbox" data-prayer-toggle="Fajr" /><span>Fajr</span></label>
              <label class="nt-chip"><input type="checkbox" data-prayer-toggle="Dhuhr" /><span>Dhuhr</span></label>
              <label class="nt-chip"><input type="checkbox" data-prayer-toggle="Asr" /><span>Asr</span></label>
              <label class="nt-chip"><input type="checkbox" data-prayer-toggle="Maghrib" /><span>Maghrib</span></label>
              <label class="nt-chip"><input type="checkbox" data-prayer-toggle="Isha" /><span>Isha</span></label>
            </div>
            <details class="nt-advanced">
              <summary>Timing</summary>
              <div class="nt-row">
                <label class="nt-row__label" for="salah-alert-offset">Minutes before (−) or after (+) prayer time</label>
                <div class="nt-row__control">
                  <input id="salah-alert-offset" class="nt-input" type="number" min="-60" max="60" step="1" inputmode="numeric" data-alert-offset />
                </div>
              </div>
            </details>
          </div>
        </section>

        <section class="nt-section" aria-labelledby="nt-quran-heading">
          <h3 class="nt-section__title" id="nt-quran-heading">Qur’an reminder</h3>
          <div class="nt-card">
            <div class="nt-row">
              <label class="nt-row__label nt-check"><input type="checkbox" data-alert-quran-enabled /><span>Qur’an reminder</span></label>
              <div class="nt-row__control">
                <input class="nt-input" type="time" data-alert-quran-time aria-label="Qur’an reminder time" />
              </div>
            </div>
          </div>
        </section>

        <section class="nt-section" aria-labelledby="nt-friday-heading">
          <h3 class="nt-section__title" id="nt-friday-heading">Friday reminder</h3>
          <div class="nt-card">
            <div class="nt-row">
              <label class="nt-row__label nt-check"><input type="checkbox" data-alert-friday-enabled /><span>One hour before Jumu’ah</span></label>
            </div>
            <div class="nt-row">
              <label class="nt-row__label" for="salah-alert-jumuah">Jumu’ah time</label>
              <div class="nt-row__control">
                <input id="salah-alert-jumuah" class="nt-input" type="time" data-alert-jumuah />
              </div>
            </div>
            <p class="nt-hint" data-alert-jumuah-hint></p>
          </div>
        </section>

        <h2 class="nt-group">Adhkar Settings</h2>
        <section class="nt-section" aria-labelledby="nt-adhkar-heading">
          <h3 class="nt-section__title" id="nt-adhkar-heading">Morning & evening Adhkar</h3>
          <div class="nt-card">
            <div class="nt-row">
              <label class="nt-row__label nt-check"><input type="checkbox" data-alert-adhkar-morning /><span>Morning Adhkar</span><small>After Fajr</small></label>
            </div>
            <div class="nt-row">
              <label class="nt-row__label nt-check"><input type="checkbox" data-alert-adhkar-evening /><span>Evening Adhkar</span><small>After Asr</small></label>
            </div>
            <details class="nt-advanced">
              <summary>Adhkar timing</summary>
              <div class="nt-row">
                <label class="nt-row__label" for="salah-alert-adhkar-delay">Minutes after the prayer</label>
                <div class="nt-row__control">
                  <input id="salah-alert-adhkar-delay" class="nt-input" type="number" min="0" max="120" step="1" inputmode="numeric" data-alert-adhkar-delay />
                </div>
              </div>
            </details>
          </div>
        </section>
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
