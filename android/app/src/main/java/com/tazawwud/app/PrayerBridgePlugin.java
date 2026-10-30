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

    /** Whether location services are on, and whether the app has location permission. */
    @PluginMethod
    public void getLocationStatus(PluginCall call) {
        android.content.Context context = getContext();
        boolean servicesOn = true;
        android.location.LocationManager manager = (android.location.LocationManager) context.getSystemService(android.content.Context.LOCATION_SERVICE);
        if (manager != null) {
            servicesOn = android.os.Build.VERSION.SDK_INT >= 28
                ? manager.isLocationEnabled()
                : (manager.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)
                    || manager.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER));
        }
        boolean permission = androidx.core.content.ContextCompat.checkSelfPermission(context,
            android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
            || androidx.core.content.ContextCompat.checkSelfPermission(context,
            android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("servicesOn", servicesOn);
        result.put("permission", permission);
        call.resolve(result);
    }

    /** Opens the phone's location settings (services on or off). */
    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            getActivity().startActivity(new android.content.Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS));
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the location settings.");
        }
    }

    /** Opens this app's permission page, where location can be allowed. */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            android.content.Intent intent = new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open the app settings.");
        }
    }

    /** Stores the admin reminders and rebuilds the alarms. */
    @PluginMethod
    public void saveCustomReminders(PluginCall call) {
        String json = call.getString("json", "[]");
        CustomReminders.save(getContext(), json);
        PrayerScheduler.refresh(getContext());
        call.resolve();
    }

    /** Shows an admin reminder right away, once per id. */
    @PluginMethod
    public void showNowReminder(PluginCall call) {
        String title = call.getString("title", "TAZAWWUD");
        String body = call.getString("body", "");
        String id = call.getString("id", "");
        PrayerNotifier.showReminder(getContext(), title, body, "tazawwud-immediate-" + id);
        call.resolve();
    }
}
