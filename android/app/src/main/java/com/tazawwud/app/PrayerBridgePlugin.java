package com.tazawwud.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Called from the web app: stores the current settings, sets the native alarms, and tests them. */
@CapacitorPlugin(name = "PrayerBridge")
public class PrayerBridgePlugin extends Plugin {
    /** Request code reserved for the test Adhan, so it never clashes with a prayer alarm. */
    private static final int TEST_REQUEST_CODE = 99;

    @PluginMethod
    public void saveSettings(PluginCall call) {
        JSObject data = call.getData();
        PrayerStore.saveSettings(getContext(), data.toString());
        PrayerNotifier.createChannels(getContext());
        PrayerScheduler.refresh(getContext());
        call.resolve();
    }

    /** Rings the Adhan notification after a short delay, to check background delivery. */
    @PluginMethod
    public void testAdhan(PluginCall call) {
        Context context = getContext();
        int seconds = Math.max(10, Math.min(600, call.getInt("seconds", 120)));
        long at = System.currentTimeMillis() + seconds * 1000L;

        Intent intent = new Intent(context, PrayerAlarmReceiver.class).putExtra("prayer", "Test");
        PendingIntent pending = PendingIntent.getBroadcast(context, TEST_REQUEST_CODE, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (Build.VERSION.SDK_INT >= 31 && !alarms.canScheduleExactAlarms()) {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        } else {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        }
        JSObject result = new JSObject();
        result.put("at", at);
        call.resolve(result);
    }
}
