package app.mendcraft.relay;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import app.mendcraft.relay.assist.AssistBridgePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AssistBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
