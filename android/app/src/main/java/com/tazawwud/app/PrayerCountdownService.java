package com.tazawwud.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

/** Keeps the silent "Next prayer" card in the notification shade, updated every minute. */
public class PrayerCountdownService extends Service {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            Notification card = buildCard();
            if (card != null) PrayerNotifier.notify(PrayerCountdownService.this, PrayerNotifier.COUNTDOWN_ID, card);
            handler.postDelayed(this, 60000L);
        }
    };

    static void start(Context context) {
        if (PrayerStore.loadSettings(context) == null) return;
        Intent intent = new Intent(context, PrayerCountdownService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        PrayerNotifier.createChannels(this);
        Notification card = buildCard();
        if (card == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(PrayerNotifier.COUNTDOWN_ID, card, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(PrayerNotifier.COUNTDOWN_ID, card);
        }
        handler.removeCallbacks(tick);
        handler.postDelayed(tick, 60000L);
        return START_STICKY;
    }

    private Notification buildCard() {
        Object[] next = PrayerScheduler.nextPrayer(this);
        if (next == null) return null;
        long minutes = Math.max(0, ((Long) next[1] - System.currentTimeMillis()) / 60000L);
        String left = minutes >= 60 ? (minutes / 60) + "h " + (minutes % 60) + "m" : minutes + "m";

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent tap = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, PrayerNotifier.COUNTDOWN_CHANNEL)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("Next: " + next[0])
            .setContentText(left + " left")
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(tap)
            .build();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tick);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
