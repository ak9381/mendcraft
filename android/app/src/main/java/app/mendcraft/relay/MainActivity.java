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
        useDarkSystemBarIcons();
    }

    @Override
    public void onResume() {
        super.onResume();
        useDarkSystemBarIcons();
    }

    /** The canvas is light whatever the system theme: dark clock and icons in
     *  the status bar (and dark navigation buttons), or they are invisible. */
    private void useDarkSystemBarIcons() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);
    }
}
