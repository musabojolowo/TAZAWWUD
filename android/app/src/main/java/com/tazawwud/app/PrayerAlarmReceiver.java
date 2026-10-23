package com.tazawwud.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires at each alarm time: shows the Adhan or the reminder, then sets the next alarms. */
public class PrayerAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String prayer = intent.getStringExtra("prayer");
        String title = intent.getStringExtra("title");
        if (prayer != null) {
            PrayerNotifier.showAdhan(context, prayer);
        } else if (title != null) {
            PrayerNotifier.showReminder(context, title, intent.getStringExtra("body"), intent.getStringExtra("tag"));
        }
        PrayerScheduler.refresh(context);
    }
}
