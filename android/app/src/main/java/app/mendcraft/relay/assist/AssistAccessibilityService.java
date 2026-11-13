package app.mendcraft.relay.assist;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Color;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.List;

/**
 * Assistive service the user must explicitly enable in Android Settings →
 * Accessibility. Scope is deliberately tiny — see AssistPolicy (and the
 * unit-tested src/assist/policy.ts it mirrors):
 *
 *  - The OS-level packageNames filter in accessibility_service_config.xml
 *    means this service only ever receives events from Instagram, Pinterest
 *    and WhatsApp (+Business). Every action here re-checks AssistPolicy too.
 *  - It performs scroll/swipe gestures, places a WhatsApp reply draft, and —
 *    only after an explicit user confirm WITH the draft visible — one single
 *    click on WhatsApp's send button. There is no timer path and no
 *    "compose filled" path to sending. Cancel is always one tap away.
 *  - It never reads or stores message content, passwords or notifications;
 *    the only text it writes is the draft the user already composed.
 */
public class AssistAccessibilityService extends AccessibilityService {

    private static volatile AssistAccessibilityService instance;

    public static AssistAccessibilityService getInstance() {
        return instance;
    }

    private final Handler handler = new Handler(Looper.getMainLooper());

    private String currentPackage = "";

    // Auto-scroll: OFF by default, pausable instantly (mirror of policy.ts).
    private boolean autoScrollEnabled = false;
    private boolean autoScrollPaused = false;
    private long autoScrollIntervalMs = AssistPolicy.AUTO_SCROLL_DEFAULT_INTERVAL_MS;

    // Draft state machine. The pending text lives only in memory, never logged.
    private AssistPolicy.DraftPhase draftPhase = AssistPolicy.DraftPhase.IDLE;
    private String draftText = "";

    private LinearLayout overlay;
    private LinearLayout confirmRow;
    private Button autoButton;

    private final Runnable autoScrollTick = new Runnable() {
        @Override
        public void run() {
            // Re-checked every tick so pause/app-switch stops it immediately.
            if (autoScrollEnabled && !autoScrollPaused && AssistPolicy.canScroll(currentPackage)) {
                performScroll(true);
            }
            if (autoScrollEnabled) {
                handler.postDelayed(this, autoScrollIntervalMs);
            }
        }
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
        showOverlay();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        CharSequence pkg = event.getPackageName();
        if (pkg == null) return;
        // The config packageNames filter already restricts delivery, but
        // double-check so a misconfigured build still refuses to act.
        if (!AssistPolicy.isAllowedPackage(pkg)) return;
        currentPackage = pkg.toString();

        // A staged draft gets placed as soon as a WhatsApp window is in front.
        if (draftPhase == AssistPolicy.DraftPhase.STAGED && AssistPolicy.canDraftReply(currentPackage)) {
            attemptPlaceDraft();
        }
    }

    @Override
    public void onInterrupt() {
        autoScrollPaused = true;
    }

    @Override
    public void onDestroy() {
        instance = null;
        handler.removeCallbacksAndMessages(null);
        hideOverlay();
        super.onDestroy();
    }

    // ------------------------------------------------------------------ scroll

    /** One swipe (up = feed advances). Allowed only inside allowlisted apps. */
    public void scrollOnce(final boolean forward) {
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (AssistPolicy.canScroll(currentPackage)) performScroll(forward);
            }
        });
    }

    public void setAutoScroll(final boolean enabled) {
        handler.post(new Runnable() {
            @Override
            public void run() {
                autoScrollEnabled = enabled;
                autoScrollPaused = false; // re-enable always starts un-paused
                handler.removeCallbacks(autoScrollTick);
                if (enabled) handler.postDelayed(autoScrollTick, autoScrollIntervalMs);
                refreshOverlay();
            }
        });
    }

    public void pauseAutoScroll() {
        handler.post(new Runnable() {
            @Override
            public void run() {
                autoScrollPaused = true;
                refreshOverlay();
            }
        });
    }

    public void setAutoScrollInterval(long intervalMs) {
        autoScrollIntervalMs = AssistPolicy.clampAutoScrollInterval(intervalMs);
    }

    /** Snapshot for the webview so its toggle stays in sync with the overlay. */
    public boolean isAutoScrollRunning() {
        return autoScrollEnabled && !autoScrollPaused;
    }

    private void performScroll(boolean forward) {
        DisplayMetrics dm = getResources().getDisplayMetrics();
        float x = dm.widthPixels / 2f;
        float fromY = forward ? dm.heightPixels * 0.70f : dm.heightPixels * 0.35f;
        float toY = forward ? dm.heightPixels * 0.35f : dm.heightPixels * 0.70f;
        Path path = new Path();
        path.moveTo(x, fromY);
        path.lineTo(x, toY);
        GestureDescription.Builder builder = new GestureDescription.Builder();
        builder.addStroke(new GestureDescription.StrokeDescription(path, 0, 300));
        dispatchGesture(builder.build(), null, null);
    }

    // ------------------------------------------------------------- draft/send

    /**
     * Stage a reply the user already confirmed in Mendcraft. This only TYPES
     * the draft into WhatsApp's compose field — it never sends.
     */
    public boolean stageDraft(final String text) {
        if (text == null || text.trim().isEmpty()) return false;
        handler.post(new Runnable() {
            @Override
            public void run() {
                draftText = text;
                draftPhase = AssistPolicy.DraftPhase.STAGED;
                if (AssistPolicy.canDraftReply(currentPackage)) attemptPlaceDraft();
                refreshOverlay();
            }
        });
        return true;
    }

    /**
     * Explicit user confirm (pinch relayed from Mendcraft, or the big overlay
     * button). The ONLY code path that clicks send, valid only while the
     * placed draft is visible, and it clicks exactly once.
     */
    public void confirmSend() {
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (draftPhase != AssistPolicy.DraftPhase.PLACED) return;
                if (!AssistPolicy.canDraftReply(currentPackage)) return;
                AccessibilityNodeInfo send = findByViewId(currentPackage + ":id/send");
                draftPhase = AssistPolicy.DraftPhase.IDLE; // single-shot, even if the click fails
                draftText = "";
                if (send != null) send.performAction(AccessibilityNodeInfo.ACTION_CLICK);
                refreshOverlay();
            }
        });
    }

    /** Always available; clears the compose field we filled and resets. */
    public void cancelDraft() {
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (draftPhase == AssistPolicy.DraftPhase.PLACED && AssistPolicy.canDraftReply(currentPackage)) {
                    setComposeText("");
                }
                draftPhase = AssistPolicy.DraftPhase.IDLE;
                draftText = "";
                refreshOverlay();
            }
        });
    }

    private void attemptPlaceDraft() {
        if (setComposeText(draftText)) {
            draftPhase = AssistPolicy.DraftPhase.PLACED;
            refreshOverlay();
        }
    }

    private boolean setComposeText(String text) {
        AccessibilityNodeInfo entry = findByViewId(currentPackage + ":id/entry");
        if (entry == null || !entry.isEditable()) return false;
        Bundle args = new Bundle();
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        return entry.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args);
    }

    // canRetrieveWindowContent in accessibility_service_config.xml exists ONLY
    // so this by-view-id lookup works (compose field + send button). Nothing
    // here reads node text/content — keep it that way; widening this is scope
    // creep the config diff won't show.
    private AccessibilityNodeInfo findByViewId(String viewId) {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        List<AccessibilityNodeInfo> nodes = root.findAccessibilityNodeInfosByViewId(viewId);
        return nodes == null || nodes.isEmpty() ? null : nodes.get(0);
    }

    // ---------------------------------------------------------------- overlay

    /** Big, high-contrast controls drawn over the allowlisted apps. */
    private void showOverlay() {
        if (overlay != null) return;
        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);

        overlay = new LinearLayout(this);
        overlay.setOrientation(LinearLayout.VERTICAL);
        overlay.setBackgroundColor(Color.argb(170, 16, 20, 28));
        int pad = dp(8);
        overlay.setPadding(pad, pad, pad, pad);

        LinearLayout scrollRow = new LinearLayout(this);
        scrollRow.setOrientation(LinearLayout.HORIZONTAL);
        scrollRow.addView(bigButton("▲", new View.OnClickListener() {
            @Override public void onClick(View v) { scrollOnce(false); }
        }));
        scrollRow.addView(bigButton("▼", new View.OnClickListener() {
            @Override public void onClick(View v) { scrollOnce(true); }
        }));
        autoButton = bigButton("Auto: off", new View.OnClickListener() {
            @Override public void onClick(View v) {
                if (autoScrollEnabled && !autoScrollPaused) pauseAutoScroll();
                else setAutoScroll(true);
            }
        });
        scrollRow.addView(autoButton);
        scrollRow.addView(bigButton("Stop", new View.OnClickListener() {
            @Override public void onClick(View v) { setAutoScroll(false); }
        }));
        overlay.addView(scrollRow);

        confirmRow = new LinearLayout(this);
        confirmRow.setOrientation(LinearLayout.HORIZONTAL);
        TextView label = new TextView(this);
        label.setText("Draft ready — send?");
        label.setTextColor(Color.WHITE);
        label.setTextSize(20);
        label.setPadding(pad, pad, pad, pad);
        confirmRow.addView(label);
        Button sendBtn = bigButton("✓ Send", new View.OnClickListener() {
            @Override public void onClick(View v) { confirmSend(); }
        });
        sendBtn.setBackgroundColor(Color.rgb(27, 94, 32));
        sendBtn.setTextColor(Color.WHITE);
        confirmRow.addView(sendBtn);
        Button cancelBtn = bigButton("✕ Cancel", new View.OnClickListener() {
            @Override public void onClick(View v) { cancelDraft(); }
        });
        cancelBtn.setBackgroundColor(Color.rgb(127, 29, 29));
        cancelBtn.setTextColor(Color.WHITE);
        confirmRow.addView(cancelBtn);
        confirmRow.setVisibility(View.GONE);
        overlay.addView(confirmRow);

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        lp.y = dp(24);
        wm.addView(overlay, lp);
    }

    private void hideOverlay() {
        if (overlay == null) return;
        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        wm.removeView(overlay);
        overlay = null;
        confirmRow = null;
        autoButton = null;
    }

    private void refreshOverlay() {
        if (confirmRow != null) {
            confirmRow.setVisibility(draftPhase == AssistPolicy.DraftPhase.PLACED ? View.VISIBLE : View.GONE);
        }
        if (autoButton != null) {
            autoButton.setText(!autoScrollEnabled ? "Auto: off" : (autoScrollPaused ? "Auto: paused" : "Auto: on"));
        }
    }

    private Button bigButton(String text, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextSize(22);
        b.setMinimumWidth(dp(96));
        b.setMinimumHeight(dp(72));
        b.setOnClickListener(onClick);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
