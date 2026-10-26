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
import java.util.List;
import java.util.Locale;

/**
 * Keeps one card in the notification shade, updated every minute. It shows the next prayer
 * and its time, the city, the prayer after it, the time left, today's count and the streak:
 * for example "Dhuhr · 12:25 PM", "5h 20m left · 0/5 prayed · 3-day streak", and under it
 * "Babadudu" and "After Asr at 3:46 PM". The count and the streak come from the settings the
 * web app saved, and the count only counts if it is for today.
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

    /** Today's count and streak, for example "2/5 prayed · 3-day streak". */
    static String prayedText(Context context) {
        int count = 0;
        int streak = 0;
        try {
            String json = PrayerStore.loadSettings(context);
            JSONObject tracker = json == null ? null : new JSONObject(json).optJSONObject("tracker");
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
            if (tracker != null) {
                streak = Math.max(0, tracker.optInt("streak", 0));
                if (today.equals(tracker.optString("date"))) {
                    count = Math.max(0, Math.min(5, tracker.optInt("count", 0)));
                }
            }
        } catch (Exception error) {
            // Unreadable settings: show what can be shown rather than failing the card.
        }
        String text = count + "/5 prayed";
        if (streak > 0) text += " · " + streak + "-day streak";
        return text;
    }

    /** The city from the saved location, or a plain label when only coordinates are saved. */
    static String cityLabel(Context context) {
        try {
            String json = PrayerStore.loadSettings(context);
            JSONObject location = json == null ? null : new JSONObject(json).optJSONObject("location");
            if (location != null && "city".equals(location.optString("type"))) {
                String city = location.optString("city", "");
                if (!city.isEmpty()) return city;
            }
        } catch (Exception error) {
            // Fall through to the plain label.
        }
        return "Your location";
    }

    static String clock(long millis) {
        return new SimpleDateFormat("h:mm a", Locale.US).format(new Date(millis));
    }

    /** The prayer after the given one, or the first upcoming prayer when Imsak is the next item. */
    static Object[] afterPrayer(Context context, String name, long at) {
        List<Object[]> list = PrayerScheduler.upcoming(context);
        for (int i = 0; i < list.size(); i++) {
            if (name.equals(list.get(i)[0]) && ((Long) list.get(i)[1]).longValue() == at) {
                return i + 1 < list.size() ? list.get(i + 1) : null;
            }
        }
        return list.isEmpty() ? null : list.get(0);
    }

    private static Notification buildCard(Context context) {
        Object[] next = PrayerScheduler.nextPrayer(context);
        if (next == null) return null;
        String name = (String) next[0];
        long at = ((Long) next[1]).longValue();
        long minutes = Math.max(0, (at - System.currentTimeMillis()) / 60000L);
        String left = minutes >= 60 ? (minutes / 60) + "h " + (minutes % 60) + "m" : minutes + "m";

        StringBuilder bigText = new StringBuilder(cityLabel(context));
        Object[] after = afterPrayer(context, name, at);
        if (after != null) {
            String afterName = PrayerScheduler.label((String) after[0], ((Long) after[1]).longValue());
            bigText.append("\nAfter ").append(afterName).append(" at ").append(clock(((Long) after[1]).longValue()));
        }

        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = PendingIntent.getActivity(context, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(context, PrayerNotifier.COUNTDOWN_CHANNEL)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(PrayerScheduler.label(name, at) + " · " + clock(at))
            .setContentText(left + " left · " + prayedText(context))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(bigText.toString()))
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
