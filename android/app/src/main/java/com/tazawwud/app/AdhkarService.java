package com.tazawwud.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

/**
 * Plays the morning or evening Adhkar for at most one minute. The notification has a Stop button,
 * which ends it at any time. Swiping the notification away does not stop the audio on its own.
 */
public class AdhkarService extends Service {
    static final String ACTION_STOP = "com.tazawwud.app.ADHKAR_STOP";
    static final int NOTIFICATION_ID = 9002;
    static final long MAX_MILLIS = 60000L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private MediaPlayer player;

    static void start(Context context, String kind) {
        Intent intent = new Intent(context, AdhkarService.class);
        intent.putExtra("kind", kind);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            finish();
            return START_NOT_STICKY;
        }
        boolean sunrise = "sunrise".equals(intent.getStringExtra("kind"));
        PrayerNotifier.createChannels(this);
        Notification card = card(sunrise);
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, card, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, card);
        }
        if (player != null) player.release();
        player = MediaPlayer.create(this, R.raw.adhkar_placeholder);
        if (player == null) {
            finish();
            return START_NOT_STICKY;
        }
        player.setLooping(true);
        player.start();
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(this::finish, MAX_MILLIS);
        return START_NOT_STICKY;
    }

    private Notification card(boolean sunrise) {
        Intent stop = new Intent(this, AdhkarService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 1, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, PrayerNotifier.COUNTDOWN_CHANNEL)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(sunrise ? "Morning Adhkar" : "Evening Adhkar")
            .setContentText("Playing for one minute. Tap Stop to end it.")
            .setOngoing(true)
            .setSilent(true)
            .addAction(0, "Stop", stopPending)
            .build();
    }

    /** Ends the audio, removes the notification and stops the service. */
    private void finish() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            player.stop();
            player.release();
            player = null;
        }
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
