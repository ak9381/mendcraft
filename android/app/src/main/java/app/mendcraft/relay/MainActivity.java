package app.mendcraft.relay;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

import app.mendcraft.relay.assist.AssistBridgePlugin;
import app.mendcraft.relay.nano.MendcraftNanoPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AssistBridgePlugin.class);
        registerPlugin(MendcraftNanoPlugin.class);
        super.onCreate(savedInstanceState);
        darkSystemBarIcons();
    }

    @Override
    public void onResume() {
        super.onResume();
        darkSystemBarIcons();
    }

    /** The canvas is light in both system themes, so the status-bar and
     *  navigation-bar icons are always dark (white ones were invisible). */
    private void darkSystemBarIcons() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);
    }
}
