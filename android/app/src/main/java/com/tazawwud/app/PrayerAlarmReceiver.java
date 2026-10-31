package com.tazawwud.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires at each alarm time: plays the Adhan or shows the bell, then sets the next alarms. */
public class PrayerAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String kind = intent.getStringExtra("kind");
        if ("card-restore".equals(kind)) {
            PrayerCountdownService.scheduleRestore(context);
            return;
        }
        if ("card-show".equals(kind)) {
            PrayerCountdownService.start(context);
            return;
        }
        String prayer = intent.getStringExtra("prayer");
        String title = intent.getStringExtra("title");
        if (kind != null) {
            // Sunrise, or the evening adhkar reminder: a bell notification only.
            PrayerNotifier.showSunEvent(context, kind);
        } else if (prayer != null) {
            if ("bell".equals(intent.getStringExtra("mode"))) {
                String name = PrayerScheduler.label(prayer, System.currentTimeMillis());
                PrayerNotifier.showReminder(context, name + " — time to pray",
                    "It is time for " + name + ".", "prayer-bell-" + prayer);
            } else {
                PrayerNotifier.showAdhan(context, prayer);
            }
        } else if (title != null) {
            PrayerNotifier.showReminder(context, title, intent.getStringExtra("body"), intent.getStringExtra("tag"));
        }
        PrayerScheduler.refresh(context);
    }
}
