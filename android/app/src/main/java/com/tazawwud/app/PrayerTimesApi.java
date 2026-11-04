package com.tazawwud.app;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.Locale;

import org.json.JSONObject;

/** Fetches one day of prayer times from the same AlAdhan API the web app uses. */
final class PrayerTimesApi {
    private static final String BASE = "https://api.aladhan.com/v1";

    private PrayerTimesApi() {}

    /** Returns {"Fajr":"05:10",...} for the given day, or null if it cannot be fetched. */
    static JSONObject fetchDay(JSONObject settings, Calendar day) {
        try {
            String date = String.format(Locale.US, "%02d-%02d-%04d",
                day.get(Calendar.DAY_OF_MONTH), day.get(Calendar.MONTH) + 1, day.get(Calendar.YEAR));
            JSONObject location = settings.optJSONObject("location");
            if (location == null) return null;

            StringBuilder url = new StringBuilder();
            if ("city".equals(location.optString("type"))) {
                url.append(BASE).append("/timingsByCity/").append(date)
                   .append("?city=").append(enc(location.optString("city")))
                   .append("&country=").append(enc(location.optString("country")));
            } else {
                url.append(BASE).append("/timings/").append(date)
                   .append("?latitude=").append(location.optDouble("latitude"))
                   .append("&longitude=").append(location.optDouble("longitude"));
            }
            url.append("&method=").append(settings.optInt("method", 3))
               .append("&school=").append(settings.optInt("school", 0))
               .append("&latitudeAdjustmentMethod=").append(latitudeAdjustment(settings));

            HttpURLConnection connection = (HttpURLConnection) new URL(url.toString()).openConnection();
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(10000);
            if (connection.getResponseCode() != 200) return null;
            String body;
            try (InputStream in = connection.getInputStream()) {
                body = readText(in);
            } finally {
                connection.disconnect();
            }
            JSONObject timings = new JSONObject(body).getJSONObject("data").getJSONObject("timings");

            JSONObject result = new JSONObject();
            for (String name : new String[] {"Fajr", "Sunrise", "Dhuhr", "Asr", "Sunset", "Maghrib", "Isha"}) {
                // AlAdhan adds a zone, for example "05:10 (CAT)"; keep only HH:MM.
                result.put(name, timings.getString(name).substring(0, 5));
            }
            return result;
        } catch (Exception | LinkageError error) {
            // LinkageError: a method missing on this Android version. Fall back to the saved times.
            return null;
        }
    }

    /** 1 middle of the night, 2 one seventh, 3 angle based. Anything else is 3, the default. */
    static int latitudeAdjustment(JSONObject settings) {
        int value = settings.optInt("latitudeAdjustment", 3);
        return value == 1 || value == 2 || value == 3 ? value : 3;
    }

    private static String enc(String value) throws Exception {
        return URLEncoder.encode(value == null ? "" : value, "UTF-8");
    }

    /** Reads a whole response as UTF-8. Works on every Android version (readAllBytes needs Android 13). */
    private static String readText(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = in.read(buffer)) != -1) {
            out.write(buffer, 0, count);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
}
