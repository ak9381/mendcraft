package app.mendcraft.relay.assist;

import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tiny bridge the Relay remote page (webview) uses to talk to the assist
 * service. Note the deliberate asymmetry: the webview can STAGE a draft and
 * drive scrolling, but the send confirm lives with the user (pinch relayed as
 * confirmSend only after Mendcraft showed the draft, or the big overlay
 * button). There is no API that both types and sends.
 */
@CapacitorPlugin(name = "AssistBridge")
public class AssistBridgePlugin extends Plugin {

    private AssistAccessibilityService service() {
        return AssistAccessibilityService.getInstance();
    }

    @PluginMethod
    public void isServiceEnabled(PluginCall call) {
        JSObject out = new JSObject();
        out.put("enabled", service() != null);
        call.resolve(out);
    }

    /** Opens Android Settings so the user can enable/disable the service. */
    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void scroll(PluginCall call) {
        AssistAccessibilityService s = service();
        if (s == null) { call.reject("assist service not enabled"); return; }
        s.scrollOnce(!"up".equals(call.getString("direction")));
        call.resolve();
    }

    @PluginMethod
    public void setAutoScroll(PluginCall call) {
        AssistAccessibilityService s = service();
        if (s == null) { call.reject("assist service not enabled"); return; }
        Boolean enabled = call.getBoolean("enabled", false);
        s.setAutoScroll(Boolean.TRUE.equals(enabled));
        call.resolve();
    }

    /** Lets the webview resync its toggle with the overlay's actual state. */
    @PluginMethod
    public void getAutoScrollState(PluginCall call) {
        AssistAccessibilityService s = service();
        JSObject out = new JSObject();
        out.put("running", s != null && s.isAutoScrollRunning());
        call.resolve(out);
    }

    @PluginMethod
    public void pauseAutoScroll(PluginCall call) {
        AssistAccessibilityService s = service();
        if (s == null) { call.reject("assist service not enabled"); return; }
        s.pauseAutoScroll();
        call.resolve();
    }

    /** Types the already-confirmed reply into WhatsApp. NEVER sends. */
    @PluginMethod
    public void stageDraft(PluginCall call) {
        AssistAccessibilityService s = service();
        if (s == null) { call.reject("assist service not enabled"); return; }
        String text = call.getString("text", "");
        JSObject out = new JSObject();
        out.put("staged", s.stageDraft(text));
        call.resolve(out);
    }

    /** Explicit user confirm (e.g. pinch detected by Mendcraft's camera). */
    @PluginMethod
    public void confirmSend(PluginCall call) {
        AssistAccessibilityService s = service();
        if (s == null) { call.reject("assist service not enabled"); return; }
        s.confirmSend();
        call.resolve();
    }

    @PluginMethod
    public void cancelDraft(PluginCall call) {
        AssistAccessibilityService s = service();
        if (s == null) { call.reject("assist service not enabled"); return; }
        s.cancelDraft();
        call.resolve();
    }
}
