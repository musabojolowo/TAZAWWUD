package com.tazawwud.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

import org.json.JSONObject;

/** Works out the next 7 days of alarms (prayers and reminders) and sets them as exact alarms. */
final class PrayerScheduler {
    static final String[] PRAYERS = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};
    private static final int DAYS = 7;
    /** Prayer alarms use request codes 0..34. */
    private static final int REMINDER_BASE = 40;
    /** Reminders use 4 codes per day: Qur'an, morning Adhkar, evening Adhkar, Friday. */
    private static final int SUN_BASE = 100;
    /** Sunrise and Sunset use 2 codes per day, from SUN_BASE. */
    // Covers the prayer, Adhkar and admin reminder codes, so the refresh clears them all.
    private static final int MAX_CODES = CustomReminders.BASE + CustomReminders.MAX_REMINDERS * CustomReminders.PER_REMINDER;
    private static final long MINUTE = 60000L;
    private static final long HOUR = 60 * MINUTE;

    private PrayerScheduler() {}

    /** Refreshes the cached days and re-sets every alarm. Runs off the main thread. */
    static void refresh(Context context) {
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            JSONObject settings = parse(PrayerStore.loadSettings(app));
            cancelAll(app);
            if (settings == null || !settings.optBoolean("master", true)) return;

            for (int d = 0; d < DAYS; d++) {
                Calendar day = Calendar.getInstance();
                day.add(Calendar.DAY_OF_YEAR, d);
                String key = dateKey(day);
                CustomReminders.scheduleDay(app, day, d);
                JSONObject times = parse(PrayerStore.loadDay(app, key));
                // Days saved before Sunrise and Sunset were kept are fetched again.
                if (times == null || !times.has("Sunrise")) {
                    JSONObject fresh = PrayerTimesApi.fetchDay(settings, day);
                    if (fresh != null) {
                        times = fresh;
                        PrayerStore.saveDay(app, key, times.toString());
                    }
                }
                if (times != null) {
                    scheduleDay(app, settings, day, times, d);
                    scheduleSunTimes(app, settings, day, times, d);
                }
                scheduleReminders(app, settings, day, times, d);
            }
            PrayerCountdownService.start(app);
        }).start();
    }

    private static void scheduleDay(Context app, JSONObject settings, Calendar day, JSONObject times, int dayIndex) {
        JSONObject prayers = settings.optJSONObject("prayers");
        int offset = settings.optInt("offsetMinutes", 0);
        for (int i = 0; i < PRAYERS.length; i++) {
            String name = PRAYERS[i];
            if (prayers != null && !prayers.optBoolean(name, true)) continue;
            long base = clockOn(day, times.optString(name, ""));
            if (base < 0) continue;
            String mode = modeOf(settings, name);
            if ("off".equals(mode)) continue;
            scheduleOne(app, dayIndex * PRAYERS.length + i, base + offset * MINUTE, name, null, null, null, mode);
        }
    }

    /** Sunrise bell, unless turned off. The evening reminder is the existing Adhkar switch. */
    private static void scheduleSunTimes(Context app, JSONObject settings, Calendar day, JSONObject times, int dayIndex) {
        if (!"off".equals(modeOf(settings, "Sunrise"))) {
            long sunrise = clockOn(day, times.optString("Sunrise", ""));
            if (sunrise >= 0) scheduleOne(app, SUN_BASE + dayIndex * 2, sunrise, null, null, null, null, "sunrise");
        }
    }

    /** The mode for a prayer: "adhan" or "bell" for the five, and "bell" or "off" for Sunrise and Sunset. */
    static String modeOf(JSONObject settings, String name) {
        JSONObject modes = settings.optJSONObject("prayerModes");
        if (modes != null && modes.has(name)) return modes.optString(name, "bell");
        return "Sunrise".equals(name) || "Sunset".equals(name) ? "bell" : "adhan";
    }

    /** Qur'an, Adhkar and Friday reminders, with the same times and wording as the web app. */
    private static void scheduleReminders(Context app, JSONObject settings, Calendar day, JSONObject times, int dayIndex) {
        int base = REMINDER_BASE + dayIndex * 4;

        JSONObject quran = settings.optJSONObject("quran");
        if (quran != null && quran.optBoolean("enabled", false)) {
            long at = clockOn(day, quran.optString("time", ""));
            if (at >= 0) scheduleOne(app, base, at, null,
                "Qur'an reading - TAZAWWUD", "Time for your daily Qur'an reading.", "tazawwud-quran", null);
        }

        JSONObject adhkar = settings.optJSONObject("adhkar");
        if (adhkar != null && times != null) {
            long delay = adhkar.optInt("minutesAfterPrayer", 15) * MINUTE;
            if (adhkar.optBoolean("morningEnabled", false)) {
                long fajr = clockOn(day, times.optString("Fajr", ""));
                if (fajr >= 0) scheduleOne(app, base + 1, fajr + delay, null,
                    "Morning Adhkar - TAZAWWUD", "Time for your morning remembrance.", "tazawwud-adhkar-morning", null);
            }
            if (adhkar.optBoolean("eveningEnabled", false)) {
                long asr = clockOn(day, times.optString("Asr", ""));
                if (asr >= 0) scheduleOne(app, base + 2, asr + delay, null,
                    "Evening Adhkar - TAZAWWUD", "Time for your evening remembrance.", "tazawwud-adhkar-evening", null);
            }
        }

        // Friday: one hour before Jumu'ah, on Fridays only, once a Jumu'ah time is set.
        JSONObject friday = settings.optJSONObject("friday");
        if (friday != null && friday.optBoolean("enabled", false) && day.get(Calendar.DAY_OF_WEEK) == Calendar.FRIDAY) {
            long jumuah = clockOn(day, friday.optString("jumuahTime", ""));
            if (jumuah >= HOUR) scheduleOne(app, base + 3, jumuah - HOUR, null,
                "Jumu'ah reminder - TAZAWWUD", "Jumu'ah is in one hour. Prepare for the Friday prayer.", "tazawwud-friday", null);
        }
    }

    /** Sets one exact alarm. A prayer name gives the Adhan; a title gives a reminder. */
    static void scheduleOne(Context app, int code, long at, String prayer,
                                    String title, String body, String tag, String extra) {
        if (at <= System.currentTimeMillis()) return;
        Intent intent = new Intent(app, PrayerAlarmReceiver.class);
        if (prayer != null) {
            intent.putExtra("prayer", prayer);
            intent.putExtra("mode", extra);
        }
        if (prayer == null && title == null && extra != null) intent.putExtra("kind", extra);
        if (title != null) {
            intent.putExtra("title", title);
            intent.putExtra("body", body);
            intent.putExtra("tag", tag);
        }
        PendingIntent pending = PendingIntent.getBroadcast(app, code, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarms = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        if (Build.VERSION.SDK_INT >= 31 && !alarms.canScheduleExactAlarms()) {
            // Exact alarms are not allowed yet: fall back to an approximate alarm.
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        } else {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        }
    }

    private static void cancelAll(Context app) {
        AlarmManager alarms = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);
        for (int code = 0; code < MAX_CODES; code++) {
            Intent intent = new Intent(app, PrayerAlarmReceiver.class);
            PendingIntent existing = PendingIntent.getBroadcast(app, code, intent,
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
            if (existing != null) {
                alarms.cancel(existing);
                existing.cancel();
            }
        }
    }

    /** The next prayer from the cached days, as {name, at}, or null. */
    /**
     * The upcoming prayers in time order, excluding Imsak, as {name, millis} pairs.
     * Used for the card's "After" line, so it follows the same settings as nextPrayer().
     */
    static List<Object[]> upcoming(Context app) {
        List<Object[]> out = new ArrayList<>();
        JSONObject settings = parse(PrayerStore.loadSettings(app));
        if (settings == null || !settings.optBoolean("master", true)) return out;
        JSONObject prayers = settings.optJSONObject("prayers");
        int offset = settings.optInt("offsetMinutes", 0);
        long now = System.currentTimeMillis();
        for (int d = 0; d < 2; d++) {
            Calendar day = Calendar.getInstance();
            day.add(Calendar.DAY_OF_YEAR, d);
            JSONObject times = parse(PrayerStore.loadDay(app, dateKey(day)));
            if (times == null) continue;
            for (String name : PRAYERS) {
                if (prayers != null && !prayers.optBoolean(name, true)) continue;
                long base = clockOn(day, times.optString(name, ""));
                if (base < 0) continue;
                long at = base + offset * MINUTE;
                if (at > now) out.add(new Object[] {name, at});
            }
        }
        out.sort((a, b) -> Long.compare((Long) a[1], (Long) b[1]));
        return out;
    }

    /** The name shown for a prayer: Dhuhr is Jumu'ah on a Friday. The stored tick stays Dhuhr. */
    static String label(String prayer, long millis) {
        if (!"Dhuhr".equals(prayer)) return prayer;
        Calendar when = Calendar.getInstance();
        when.setTimeInMillis(millis);
        return when.get(Calendar.DAY_OF_WEEK) == Calendar.FRIDAY ? "Jumu'ah" : prayer;
    }

    /** Today's five prayers, in order, as {name, millis}. Used for the row of dots on the card. */
    static List<Object[]> todayPrayers(Context app) {
        List<Object[]> out = new ArrayList<>();
        Calendar today = Calendar.getInstance();
        JSONObject times = parse(PrayerStore.loadDay(app, dateKey(today)));
        if (times == null) return out;
        for (String name : PRAYERS) {
            long at = clockOn(today, times.optString(name, ""));
            if (at >= 0) out.add(new Object[] {name, at});
        }
        return out;
    }

    static Object[] nextPrayer(Context app) {
        JSONObject settings = parse(PrayerStore.loadSettings(app));
        if (settings == null || !settings.optBoolean("master", true)) return null;
        JSONObject prayers = settings.optJSONObject("prayers");
        int offset = settings.optInt("offsetMinutes", 0);
        long now = System.currentTimeMillis();
        Object[] best = null;
        for (int d = 0; d < 2; d++) {
            Calendar day = Calendar.getInstance();
            day.add(Calendar.DAY_OF_YEAR, d);
            JSONObject times = parse(PrayerStore.loadDay(app, dateKey(day)));
            if (times == null) continue;
            for (String name : PRAYERS) {
                if (prayers != null && !prayers.optBoolean(name, true)) continue;
                long base = clockOn(day, times.optString(name, ""));
                if (base < 0) continue;
                long at = base + offset * MINUTE;
                if (at > now && (best == null || at < (Long) best[1])) best = new Object[] {name, at};
            }
        }

        // Imsak countdown, as on the web: until today's Imsak has passed, the next item is Imsak.
        // Imsak is today's Fajr minus the chosen minutes (not offset), matching the web app.
        if (settings.optBoolean("imsakCountdown", false)) {
            Calendar today = Calendar.getInstance();
            JSONObject times = parse(PrayerStore.loadDay(app, dateKey(today)));
            int before = settings.optInt("imsakMinutes", 0);
            if (times != null && before >= 0 && before <= 30) {
                long fajr = clockOn(today, times.optString("Fajr", ""));
                if (fajr >= 0) {
                    long imsak = fajr - before * MINUTE;
                    if (imsak > now && (best == null || imsak < (Long) best[1])) best = new Object[] {"Imsak", imsak};
                }
            }
        }
        return best;
    }

    /** Milliseconds of HH:MM on the given day in local time, or -1 if the text is not a time. */
    static long clockOn(Calendar day, String hhmm) {
        if (hhmm == null || hhmm.length() < 5) return -1L;
        try {
            int hour = Integer.parseInt(hhmm.substring(0, 2));
            int minute = Integer.parseInt(hhmm.substring(3, 5));
            if (hour > 23 || minute > 59) return -1L;
            Calendar c = (Calendar) day.clone();
            c.set(Calendar.HOUR_OF_DAY, hour);
            c.set(Calendar.MINUTE, minute);
            c.set(Calendar.SECOND, 0);
            c.set(Calendar.MILLISECOND, 0);
            return c.getTimeInMillis();
        } catch (NumberFormatException error) {
            return -1L;
        }
    }

    static String dateKey(Calendar c) {
        return String.format(java.util.Locale.US, "%04d-%02d-%02d",
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static JSONObject parse(String json) {
        if (json == null) return null;
        try {
            return new JSONObject(json);
        } catch (Exception error) {
            return null;
        }
    }
}
