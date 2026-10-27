package com.tazawwud.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Channels and notifications for the Adhan, the reminders and the countdown card. */
final class PrayerNotifier {
    // A new channel name, so the Adhan sound is set when it is created. Android keeps the sound
    // of an existing channel, so an older channel named "adhan" could still play a normal chime.
    static final String ADHAN_CHANNEL = "adhan_v2";
    private static final String OLD_ADHAN_CHANNEL = "adhan";
    static final String REMINDER_CHANNEL = "reminders";
    static final String COUNTDOWN_CHANNEL = "countdown";
    static final int COUNTDOWN_ID = 9001;
    private static final int ADHAN_BASE_ID = 9100;
    private static final int REMINDER_BASE_ID = 9200;

    private PrayerNotifier() {}

    static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);

        // Remove the older Adhan channel, which may have been created with the wrong sound.
        manager.deleteNotificationChannel(OLD_ADHAN_CHANNEL);

        // The Adhan channel plays the recording. Its sound is fixed once created.
        NotificationChannel adhan = new NotificationChannel(ADHAN_CHANNEL,
            "Prayer times and Adhan", NotificationManager.IMPORTANCE_HIGH);
        adhan.setDescription("Plays the Adhan at each prayer time");
        Uri sound = Uri.parse("android.resource://" + context.getPackageName() + "/raw/adhan_default");
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        adhan.setSound(sound, attributes);
        manager.createNotificationChannel(adhan);

        // Reminders use the normal notification sound.
        NotificationChannel reminders = new NotificationChannel(REMINDER_CHANNEL,
            "Qur'an, Adhkar and Friday reminders", NotificationManager.IMPORTANCE_HIGH);
        reminders.setDescription("Qur'an, Adhkar and Jumu'ah reminders");
        manager.createNotificationChannel(reminders);

        // The countdown channel is silent and cannot be swiped to make a sound.
        NotificationChannel countdown = new NotificationChannel(COUNTDOWN_CHANNEL,
            "Next prayer countdown", NotificationManager.IMPORTANCE_LOW);
        countdown.setDescription("Shows the next prayer and the time left");
        countdown.setSound(null, null);
        manager.createNotificationChannel(countdown);
    }

    static void showAdhan(Context context, String prayer) {
        createChannels(context);
        String shownName = "Test".equals(prayer) ? prayer : PrayerScheduler.label(prayer, System.currentTimeMillis());
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = PendingIntent.getActivity(context, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ADHAN_CHANNEL)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle("Test".equals(prayer) ? "Background Adhan test" : shownName + " — time to pray")
            .setContentText("Test".equals(prayer)
                ? "If you can read this with the app closed, background alerts work."
                : "The Adhan for " + shownName + " is starting.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(tap);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
        }
        notify(context, ADHAN_BASE_ID + Math.abs(prayer.hashCode() % 50), builder.build());
    }

    static void showReminder(Context context, String title, String body, String tag) {
        createChannels(context);
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = PendingIntent.getActivity(context, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, REMINDER_CHANNEL)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(tap);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
        }
        notify(context, REMINDER_BASE_ID + Math.abs((tag == null ? "" : tag).hashCode() % 50), builder.build());
    }

    /** The bell for Sunrise or Sunset. The Adhkar audio is started separately. */
    static void showSunEvent(Context context, String kind) {
        boolean sunrise = "sunrise".equals(kind);
        showReminder(context,
            sunrise ? "Sunrise" : "Evening adhkar",
            sunrise ? "Sunrise has begun." : "One hour after Asr. Time for the evening remembrance.",
            "tazawwud-" + kind);
    }

    static void notify(Context context, int id, android.app.Notification notification) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        try {
            NotificationManagerCompat.from(context).notify(id, notification);
        } catch (SecurityException ignored) {
            // The notification permission was revoked; nothing to show.
        }
    }
}
