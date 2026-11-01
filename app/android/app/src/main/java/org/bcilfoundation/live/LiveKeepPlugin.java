package org.bcilfoundation.live;

import android.content.Context;
import android.os.PowerManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// While someone is in a live room, keep the app's web page running when they leave the app
// or turn the screen off, so the microphone and sound keep working.
@CapacitorPlugin(name = "LiveKeep")
public class LiveKeepPlugin extends Plugin {
    static volatile boolean active = false;
    private PowerManager.WakeLock wakeLock;

    @PluginMethod
    public void start(PluginCall call) {
        active = true;
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bcil:live");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) wakeLock.acquire(4 * 60 * 60 * 1000L); // safety cap: 4 hours
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        active = false;
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        call.resolve();
    }
}
