package org.bcilfoundation.live;

import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LiveKeepPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onPause() { super.onPause(); keepLiveRunning(); }

    @Override
    public void onStop() { super.onStop(); keepLiveRunning(); }

    // Android normally pauses the page when the app is hidden, which cuts the microphone.
    // During a live session we tell the page it is still visible so audio keeps flowing.
    private void keepLiveRunning() {
        if (!LiveKeepPlugin.active || bridge == null) return;
        final WebView v = bridge.getWebView();
        if (v == null) return;
        v.post(() -> {
            v.onResume();
            v.resumeTimers();
            v.dispatchWindowVisibilityChanged(View.VISIBLE);
        });
    }
}
