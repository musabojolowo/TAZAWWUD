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
 * Keeps one card in the notification shade, updated every minute. It shows the next prayer and
 * its time, the city and flag, the time left, a row of today's five prayers (passed, next and
 * upcoming), today's count, the streak, and the prayer after the next one.
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
     * Redraws the card right away, for example after the person ticks a prayer in the app,
     * or when a city name has been looked up. Does nothing if there are no prayer times yet.
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

    static String clock(long millis) {
        return new SimpleDateFormat("h:mm a", Locale.US).format(new Date(millis));
    }

    /**
     * A row of today's five prayers: a filled dot for a prayer that has passed, a ring for the
     * next prayer, and an empty dot for the rest. Each prayer has its name.
     */
    static String dotsLine(List<Object[]> today, Object[] next, long now) {
        StringBuilder row = new StringBuilder();
        for (Object[] prayer : today) {
            String name = (String) prayer[0];
            long at = ((Long) prayer[1]).longValue();
            String dot;
            if (next != null && name.equals(next[0]) && at == ((Long) next[1]).longValue()) {
                dot = "◉";
            } else if (at <= now) {
                dot = "●";
            } else {
                dot = "○";
            }
            if (row.length() > 0) row.append("  ");
            row.append(dot).append(" ").append(PrayerScheduler.label(name, at));
        }
        return row.toString();
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
        long now = System.currentTimeMillis();
        String name = (String) next[0];
        long at = ((Long) next[1]).longValue();

        String place = PrayerLocation.label(context);
        StringBuilder bigText = new StringBuilder(place).append("\n")
            .append(dotsLine(PrayerScheduler.todayPrayers(context), next, now));
        bigText.append("\n").append(prayedText(context));
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
            .setContentTitle("Next: " + PrayerScheduler.label(name, at) + " · " + clock(at))
            .setContentText(place)
            // Android counts down to the prayer itself, showing seconds, with no per-second updates from the app.
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setWhen(at)
            .setShowWhen(true)
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
