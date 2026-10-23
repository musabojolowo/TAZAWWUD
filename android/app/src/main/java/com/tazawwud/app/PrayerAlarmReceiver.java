package com.tazawwud.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fires at a prayer time: shows the Adhan notification, then sets the next alarms. */
public class PrayerAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String prayer = intent.getStringExtra("prayer");
        if (prayer != null) PrayerNotifier.showAdhan(context, prayer);
        PrayerScheduler.refresh(context);
    }
}
