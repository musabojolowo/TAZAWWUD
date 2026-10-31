package com.tazawwud.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PrayerBridgePlugin.class);
        super.onCreate(savedInstanceState);
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
