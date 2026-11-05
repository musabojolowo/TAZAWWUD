package com.tazawwud.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    static final String PENDING_PREFS = "tazawwud-pending";
    static final String PENDING_KEY = "action";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrayerBridgePlugin.class);
        super.onCreate(savedInstanceState);
        handleReminderIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleReminderIntent(intent);
    }

    /**
     * A tapped reminder is saved here, and the web app shows it as a card when it next comes to the
     * front. The extras are removed so the same reminder is not shown twice.
     */
    private void handleReminderIntent(Intent intent) {
        if (intent == null || !"reminder".equals(intent.getStringExtra("tazawwud_action"))) return;
        try {
            JSONObject action = new JSONObject();
            action.put("type", "reminder");
            action.put("title", intent.getStringExtra("tazawwud_title"));
            action.put("body", intent.getStringExtra("tazawwud_body"));
            SharedPreferences prefs = getSharedPreferences(PENDING_PREFS, MODE_PRIVATE);
            prefs.edit().putString(PENDING_KEY, action.toString()).apply();
        } catch (Exception error) {
            // A malformed reminder is ignored; the app still opens normally.
        }
        intent.removeExtra("tazawwud_action");
        intent.removeExtra("tazawwud_title");
        intent.removeExtra("tazawwud_body");
    }

    /**
     * The phone's back button. The web app goes back one step first (returns to the page before, or
     * to Home). Only when there is nothing to go back to does the app leave, by moving to the
     * background, as Android expects.
     */
    @Override
    public void onBackPressed() {
        getBridge().getWebView().evaluateJavascript(
            "(function(){ return typeof window.tazawwudHandleBack === 'function' && window.tazawwudHandleBack() === true; })()",
            (value) -> {
                if (!"true".equals(value)) {
                    moveTaskToBack(true);
                }
            });
    }
}
