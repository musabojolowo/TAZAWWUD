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

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Keeps the silent "Next prayer" card in the notification shade, updated every minute.
 *
 * The card also shows how many of today's five prayers have been ticked in the app, for
 * example "1h 20m left · 2/5 prayed". The count comes from the settings the web app saved,
 * and only counts if it is for today.
 *
 * Android requires a service started with startForegroundService() to call startForeground()
 * within a few seconds. Every path below therefore shows a notification first, even when
 * there are no prayer times yet, so the app is never killed for that reason.
 */
public class PrayerCountdownService extends Service {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            Notification card = buildCard(PrayerCountdownService.this);
            if (card != null) PrayerNotifier.notify(PrayerCountdownService.this, PrayerNotifier.COUNTDOWN_ID, card);
            handler.postDelayed(this, 60000L);
        }
    };

    /** Starts the card only when there are cached prayer times to show. */
    static void start(Context context) {
        if (PrayerStore.loadSettings(context) == null) return;
        if (PrayerScheduler.nextPrayer(context) == null) return;
        Intent intent = new Intent(context, PrayerCountdownService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (RuntimeException error) {
            // Android refused to start the service in the background: the card is simply not shown.
        }
    }

    /**
     * Redraws the card right away, for example after the person ticks a prayer in the app.
     * Does nothing if there are no prayer times yet.
     */
    static void refreshCard(Context context) {
        Notification card = buildCard(context);
        if (card != null) PrayerNotifier.notify(context, PrayerNotifier.COUNTDOWN_ID, card);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        PrayerNotifier.createChannels(this);
        Notification card = buildCard(this);
        boolean hasPrayers = card != null;
        if (!hasPrayers) card = placeholderCard(this);

        // Must happen on every path, or Android stops the app.
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(PrayerNotifier.COUNTDOWN_ID, card, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(PrayerNotifier.COUNTDOWN_ID, card);
        }

        if (!hasPrayers) {
            stopSelf();
            return START_NOT_STICKY;
        }
        handler.removeCallbacks(tick);
        handler.postDelayed(tick, 60000L);
        return START_STICKY;
    }

    private static Notification placeholderCard(Context context) {
        return new NotificationCompat.Builder(context, PrayerNotifier.COUNTDOWN_CHANNEL)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle("TAZAWWUD")
            .setContentText("Prayer times will show here once loaded.")
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .build();
    }

    /** "2/5 prayed" for today, or "0/5 prayed" if nothing has been ticked for today yet. */
    static String prayedText(Context context) {
        int count = 0;
        try {
            String json = PrayerStore.loadSettings(context);
            JSONObject tracker = json == null ? null : new JSONObject(json).optJSONObject("tracker");
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
            if (tracker != null && today.equals(tracker.optString("date"))) {
                count = Math.max(0, Math.min(5, tracker.optInt("count", 0)));
            }
        } catch (Exception error) {
            // Unreadable settings: show 0/5 rather than failing the card.
        }
        return count + "/5 prayed";
    }

    private static Notification buildCard(Context context) {
        Object[] next = PrayerScheduler.nextPrayer(context);
        if (next == null) return null;
        long minutes = Math.max(0, ((Long) next[1] - System.currentTimeMillis()) / 60000L);
        String left = minutes >= 60 ? (minutes / 60) + "h " + (minutes % 60) + "m" : minutes + "m";

        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = PendingIntent.getActivity(context, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(context, PrayerNotifier.COUNTDOWN_CHANNEL)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle("Next: " + next[0])
            .setContentText(left + " left · " + prayedText(context))
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
