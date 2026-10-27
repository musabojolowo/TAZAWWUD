package com.tazawwud.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Address;
import android.location.Geocoder;
import android.os.Build;

import org.json.JSONObject;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The city name and country flag for the notification card, from the saved location.
 *
 * Names come only from Android's geocoder, for the saved coordinates or city. Nothing is guessed:
 * if the geocoder cannot resolve a place, the card shows the plain fallback, and tries again later.
 */
final class PrayerLocation {
    private static final String PREFS = "tazawwud-place";
    private static final String FALLBACK = "Your location";
    private static final Set<String> inFlight = new HashSet<>();

    private PrayerLocation() {}

    /** The flag emoji for a two-letter country code, such as "NG". Empty if the code is not valid. */
    static String flag(String countryCode) {
        if (countryCode == null || countryCode.length() != 2) return "";
        String code = countryCode.toUpperCase(Locale.US);
        char first = code.charAt(0);
        char second = code.charAt(1);
        if (first < 'A' || first > 'Z' || second < 'A' || second > 'Z') return "";
        return new String(Character.toChars(0x1F1E6 + (first - 'A')))
            + new String(Character.toChars(0x1F1E6 + (second - 'A')));
    }

    /** The label for the card, for example "🇳🇬 Babadudu". Starts a background lookup when needed. */
    static String label(Context context) {
        JSONObject location = savedLocation(context);
        if (location == null) return FALLBACK;
        String type = location.optString("type");
        String key;
        if ("city".equals(type)) {
            String city = location.optString("city", "").trim();
            String country = location.optString("country", "").trim();
            if (city.isEmpty()) return FALLBACK;
            key = "city|" + city.toLowerCase(Locale.US) + "|" + country.toLowerCase(Locale.US);
            return resolved(context, key, location, city);
        }
        if ("coordinates".equals(type) && location.has("latitude") && location.has("longitude")) {
            key = String.format(Locale.US, "coords|%.2f|%.2f", location.optDouble("latitude"), location.optDouble("longitude"));
            return resolved(context, key, location, FALLBACK);
        }
        return FALLBACK;
    }

    /** The saved name and flag if already resolved; otherwise the fallback, while a lookup runs. */
    private static String resolved(Context context, String key, JSONObject location, String fallback) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String saved = prefs.getString(key, null);
        if (saved == null) {
            lookup(context, key, location);
            return fallback;
        }
        String[] parts = saved.split("\n", 2);
        String name = parts[0];
        String flag = parts.length > 1 ? flag(parts[1]) : "";
        return flag.isEmpty() ? name : flag + " " + name;
    }

    /** Asks the geocoder in the background, saves the answer, and redraws the card. */
    private static void lookup(Context context, String key, JSONObject location) {
        synchronized (inFlight) {
            if (!inFlight.add(key)) return;
        }
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try {
                Geocoder geocoder = new Geocoder(app, Locale.getDefault());
                List<Address> results;
                String typedCity = location.optString("city", "").trim();
                if ("city".equals(location.optString("type"))) {
                    String query = typedCity + ", " + location.optString("country", "").trim();
                    results = forwardGeocode(geocoder, query);
                } else {
                    results = reverseGeocode(geocoder, location.optDouble("latitude"), location.optDouble("longitude"));
                }
                if (results != null && !results.isEmpty()) {
                    Address address = results.get(0);
                    String name = firstNonEmpty(address.getLocality(), address.getSubAdminArea(), address.getAdminArea());
                    if (name == null) name = typedCity.isEmpty() ? null : typedCity;
                    String code = address.getCountryCode();
                    if (name != null) {
                        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                            .putString(key, name + "\n" + (code == null ? "" : code))
                            .apply();
                        PrayerCountdownService.refreshCard(app);
                    }
                }
            } catch (Exception error) {
                // No network, or the geocoder is unavailable: the fallback stays, and a later refresh tries again.
            } finally {
                synchronized (inFlight) {
                    inFlight.remove(key);
                }
            }
        }).start();
    }

    /**
     * The city name and country code for coordinates, from the geocoder, or null if it cannot resolve them.
     * Used by the Salah page through the bridge. Call it from a background thread.
     */
    static String[] reverse(Context context, double latitude, double longitude) {
        if (Double.isNaN(latitude) || Double.isNaN(longitude)) return null;
        try {
            Geocoder geocoder = new Geocoder(context.getApplicationContext(), Locale.getDefault());
            List<Address> results = reverseGeocode(geocoder, latitude, longitude);
            if (results == null || results.isEmpty()) return null;
            Address address = results.get(0);
            String name = firstNonEmpty(address.getLocality(), address.getSubAdminArea(), address.getAdminArea());
            if (name == null) return null;
            String code = address.getCountryCode();
            return new String[] {name, code == null ? "" : code};
        } catch (Exception error) {
            return null;
        }
    }

    /** Android 13 and later: the callback method, waited for on this background thread. */
    private static List<Address> reverseGeocode(Geocoder geocoder, double latitude, double longitude) throws Exception {
        if (Build.VERSION.SDK_INT >= 33) {
            AtomicReference<List<Address>> result = new AtomicReference<>();
            CountDownLatch done = new CountDownLatch(1);
            geocoder.getFromLocation(latitude, longitude, 1, addresses -> {
                result.set(addresses);
                done.countDown();
            });
            done.await(20, TimeUnit.SECONDS);
            return result.get();
        }
        return legacyReverseGeocode(geocoder, latitude, longitude);
    }

    /** Android 13 and later: the callback method, waited for on this background thread. */
    private static List<Address> forwardGeocode(Geocoder geocoder, String query) throws Exception {
        if (Build.VERSION.SDK_INT >= 33) {
            AtomicReference<List<Address>> result = new AtomicReference<>();
            CountDownLatch done = new CountDownLatch(1);
            geocoder.getFromLocationName(query, 1, addresses -> {
                result.set(addresses);
                done.countDown();
            });
            done.await(20, TimeUnit.SECONDS);
            return result.get();
        }
        return legacyForwardGeocode(geocoder, query);
    }

    /** Older Android versions only. The method is deprecated on newer ones, which use the callback above. */
    @SuppressWarnings("deprecation")
    private static List<Address> legacyReverseGeocode(Geocoder geocoder, double latitude, double longitude) throws Exception {
        return geocoder.getFromLocation(latitude, longitude, 1);
    }

    /** Older Android versions only. The method is deprecated on newer ones, which use the callback above. */
    @SuppressWarnings("deprecation")
    private static List<Address> legacyForwardGeocode(Geocoder geocoder, String query) throws Exception {
        return geocoder.getFromLocationName(query, 1);
    }

    private static String firstNonEmpty(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) return value.trim();
        }
        return null;
    }

    private static JSONObject savedLocation(Context context) {
        try {
            String json = PrayerStore.loadSettings(context);
            if (json == null) return null;
            return new JSONObject(json).optJSONObject("location");
        } catch (Exception error) {
            return null;
        }
    }
}
