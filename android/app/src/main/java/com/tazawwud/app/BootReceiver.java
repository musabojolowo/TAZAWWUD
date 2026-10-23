package com.tazawwud.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After a restart, Android clears the alarms: set them again and restart the card. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        PrayerScheduler.refresh(context);
    }
}
