package com.tazawwud.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Called from the web app: stores the current settings and sets the native alarms. */
@CapacitorPlugin(name = "PrayerBridge")
public class PrayerBridgePlugin extends Plugin {
    @PluginMethod
    public void saveSettings(PluginCall call) {
        JSObject data = call.getData();
        PrayerStore.saveSettings(getContext(), data.toString());
        PrayerNotifier.createChannels(getContext());
        PrayerScheduler.refresh(getContext());
        PrayerCountdownService.refreshCard(getContext()); // shows the new prayer count at once
        call.resolve();
    }
}
