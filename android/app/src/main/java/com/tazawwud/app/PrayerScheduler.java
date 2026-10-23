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

/** Works out the next 7 days of prayer alarms and sets them as exact alarms. */
final class PrayerScheduler {
    static final String[] PRAYERS = {"Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"};
    private static final int DAYS = 7;
    private static final int MAX_CODES = DAYS * PRAYERS.length;

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
                JSONObject times = parse(PrayerStore.loadDay(app, key));
                if (times == null) {
                    times = PrayerTimesApi.fetchDay(settings, day);
                    if (times != null) PrayerStore.saveDay(app, key, times.toString());
                }
                if (times == null) continue;
                scheduleDay(app, settings, day, times, d);
            }
            PrayerCountdownService.start(app);
        }).start();
    }

    private static void scheduleDay(Context app, JSONObject settings, Calendar day, JSONObject times, int dayIndex) {
        JSONObject prayers = settings.optJSONObject("prayers");
        int offset = settings.optInt("offsetMinutes", 0);
        long now = System.currentTimeMillis();
        AlarmManager alarms = (AlarmManager) app.getSystemService(Context.ALARM_SERVICE);

        for (int i = 0; i < PRAYERS.length; i++) {
            String name = PRAYERS[i];
            if (prayers != null && !prayers.optBoolean(name, true)) continue;
            long at = timeOn(day, times.optString(name, "")) + offset * 60000L;
            if (at <= now) continue;

            int code = dayIndex * PRAYERS.length + i;
            Intent intent = new Intent(app, PrayerAlarmReceiver.class).putExtra("prayer", name);
            PendingIntent pending = PendingIntent.getBroadcast(app, code, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (Build.VERSION.SDK_INT >= 31 && !alarms.canScheduleExactAlarms()) {
                // Exact alarms are not allowed yet: fall back to an approximate alarm.
                alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            } else {
                alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            }
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
                long at = timeOn(day, times.optString(name, "")) + offset * 60000L;
                if (at > now && (best == null || at < (Long) best[1])) best = new Object[] {name, at};
            }
        }
        return best;
    }

    private static long timeOn(Calendar day, String hhmm) {
        if (hhmm.length() < 5) return 0L;
        Calendar c = (Calendar) day.clone();
        c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(hhmm.substring(0, 2)));
        c.set(Calendar.MINUTE, Integer.parseInt(hhmm.substring(3, 5)));
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
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
