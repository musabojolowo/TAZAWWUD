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

    /** Whether exact alarms and unrestricted battery are on, so Adhan rings on time. */
    @PluginMethod
    public void getAlarmStatus(PluginCall call) {
        android.content.Context context = getContext();
        boolean exact = true;
        if (android.os.Build.VERSION.SDK_INT >= 31) {
            android.app.AlarmManager alarms = (android.app.AlarmManager) context.getSystemService(android.content.Context.ALARM_SERVICE);
            exact = alarms != null && alarms.canScheduleExactAlarms();
        }
        boolean battery = true;
        if (android.os.Build.VERSION.SDK_INT >= 23) {
            android.os.PowerManager power = (android.os.PowerManager) context.getSystemService(android.content.Context.POWER_SERVICE);
            battery = power != null && power.isIgnoringBatteryOptimizations(context.getPackageName());
        }
        JSObject result = new JSObject();
        result.put("exactAlarms", exact);
        result.put("batteryUnrestricted", battery);
        call.resolve(result);
    }

    /** Opens the phone's "Alarms & reminders" page for this app. */
    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 31) {
                android.content.Intent intent = new android.content.Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(intent);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the alarm settings.");
        }
    }

    /** Opens the phone's battery settings, where the app can be set to Unrestricted. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            getActivity().startActivity(new android.content.Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the battery settings.");
        }
    }
}
