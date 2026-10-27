package com.tazawwud.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Called from the web app: stores the current settings and sets the native alarms. */
@CapacitorPlugin(name = "PrayerBridge")
public class PrayerBridgePlugin extends Plugin {
    @PluginMethod
    public void saveSettings(PluginCall call) {
        JSObject data = call.getData();
        PrayerStore.saveSettings(getContext(), data.toString());
        PrayerNotifier.createChannels(getContext());
        PrayerScheduler.refresh(getContext());
        PrayerCountdownService.refreshCard(getContext()); // shows the new prayer count at once
        call.resolve();
    }

    /** Resolves a city name for coordinates. Resolves with an empty result if it cannot. */
    @PluginMethod
    public void resolvePlace(PluginCall call) {
        final double latitude = call.getDouble("latitude", Double.NaN);
        final double longitude = call.getDouble("longitude", Double.NaN);
        final android.content.Context app = getContext().getApplicationContext();
        new Thread(() -> {
            String[] place = PrayerLocation.reverse(app, latitude, longitude);
            JSObject result = new JSObject();
            if (place != null) {
                result.put("name", place[0]);
                result.put("countryCode", place[1]);
            }
            call.resolve(result);
        }).start();
    }
}
