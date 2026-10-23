package com.tazawwud.app;

import android.content.Context;
import android.content.SharedPreferences;

/** Saved settings from the web app, and prayer times per day, kept on the phone. */
final class PrayerStore {
    private static final String PREFS = "tazawwud_prayer";
    private static final String SETTINGS = "settings";

    private PrayerStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void saveSettings(Context context, String json) {
        prefs(context).edit().putString(SETTINGS, json).apply();
    }

    static String loadSettings(Context context) {
        return prefs(context).getString(SETTINGS, null);
    }

    static void saveDay(Context context, String date, String json) {
        prefs(context).edit().putString("day_" + date, json).apply();
    }

    static String loadDay(Context context, String date) {
        return prefs(context).getString("day_" + date, null);
    }
}
