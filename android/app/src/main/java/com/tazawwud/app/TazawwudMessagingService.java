package com.tazawwud.app;

import android.content.Context;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives the admin's "Send now" reminders from the server, and shows each one as a notification.
 * Messages are data-only, so this service receives them even when the app is closed.
 */
public class TazawwudMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String id = data.get("id");
        if (id == null || id.isEmpty()) return;
        String title = data.get("title");
        String body = data.get("body");
        PrayerNotifier.showReminder(getApplicationContext(),
            title == null || title.isEmpty() ? "TAZAWWUD" : title,
            body == null ? "" : body,
            "tazawwud-push-" + id);
    }

    /** Keeps the newest token, so the app can register it with the server. */
    @Override
    public void onNewToken(String token) {
        Context context = getApplicationContext();
        context.getSharedPreferences("tazawwud-push", Context.MODE_PRIVATE).edit().putString("token", token).apply();
    }
}
