package com.tazawwud.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * After the phone restarts, or after TAZAWWUD is updated, sets the prayer alarms again and shows
 * the prayer card. It uses the prayer times already saved on the phone, so it works offline.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (action == null) return;
        boolean restart = "android.intent.action.BOOT_COMPLETED".equals(action)
                || "android.intent.action.MY_PACKAGE_REPLACED".equals(action);
        if (!restart) return;
        PrayerScheduler.refresh(context);
        PrayerCountdownService.start(context);
    }
}
