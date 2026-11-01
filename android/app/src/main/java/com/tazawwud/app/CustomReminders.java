package com.tazawwud.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * Admin-scheduled reminders. The list comes from the database when the app opens, and is kept on
 * the phone. Each enabled reminder is scheduled at its local time for the next week, using the
 * same alarms as the prayer reminders. Times are the phone's own local time.
 */
final class CustomReminders {
    static final String PREFS = "tazawwud-custom-reminders";
    static final String KEY = "list";
    /** Codes start after the prayer and Adhkar codes, and each reminder has one code per day. */
    static final int BASE = 300;
    static final int PER_REMINDER = 8;
    static final int MAX_REMINDERS = 80;

    private CustomReminders() {}

    /** Replaces the stored list. The caller refreshes the alarms afterwards. */
    static void save(Context context, String json) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY, json == null ? "[]" : json).apply();
    }

    /** Schedules the enabled reminders that fall on this day. */
    static void scheduleDay(Context app, Calendar day, int dayIndex) {
        SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY, "[]");
        JSONArray list;
        try {
            list = new JSONArray(raw);
        } catch (Exception error) {
            return;
        }
        for (int i = 0; i < list.length() && i < MAX_REMINDERS; i++) {
            JSONObject item = list.optJSONObject(i);
            if (item == null || !item.optBoolean("enabled", false)) continue;
            long at = clockOn(day, item.optString("time", ""));
            if (at < 0) continue;
            String title = item.optString("title", "TAZAWWUD");
            String body = item.optString("body", "");
            String tag = "tazawwud-admin-" + item.optString("id", String.valueOf(i));
            int code = BASE + i * PER_REMINDER + dayIndex;
            PrayerScheduler.scheduleOne(app, code, at, null, title, body, tag, null);
        }
    }

    /** The time of day, in the phone's local time, as millis. -1 if the time is not HH:MM. */
    static long clockOn(Calendar day, String hhmm) {
        if (hhmm == null || !hhmm.matches("([01]\\d|2[0-3]):[0-5]\\d")) return -1;
        Calendar c = (Calendar) day.clone();
        c.set(Calendar.HOUR_OF_DAY, Integer.parseInt(hhmm.substring(0, 2)));
        c.set(Calendar.MINUTE, Integer.parseInt(hhmm.substring(3, 5)));
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }
}
