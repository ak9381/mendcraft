package app.mendcraft.relay.assist;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Java mirror of src/assist/policy.ts — that file is the unit-tested source of
 * truth; keep the two in sync. Hard rules enforced here AND by the
 * accessibility_service_config.xml packageNames filter (the OS never delivers
 * events from other apps to the service in the first place):
 *
 *  - ALLOWLIST ONLY: Instagram, Pinterest, WhatsApp, WhatsApp Business.
 *  - Instagram/Pinterest: scroll gestures only.
 *  - WhatsApp: a reply draft may be placed in the compose field; the single
 *    send click happens only after an explicit user confirm (pinch relayed
 *    from Mendcraft, or the big overlay button) AFTER the draft is visible.
 *    Never on a timer, never because the compose field filled.
 */
public final class AssistPolicy {

    public static final Set<String> ALLOWLIST = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
            "com.instagram.android",
            "com.pinterest",
            "com.whatsapp",
            "com.whatsapp.w4b"
    )));

    /** Fastest cadence auto-scroll may ever run at (mirror of policy.ts). */
    public static final long AUTO_SCROLL_MIN_INTERVAL_MS = 1500;
    public static final long AUTO_SCROLL_DEFAULT_INTERVAL_MS = 3000;

    public static boolean isAllowedPackage(CharSequence pkg) {
        return pkg != null && ALLOWLIST.contains(pkg.toString());
    }

    public static boolean canScroll(CharSequence pkg) {
        return isAllowedPackage(pkg);
    }

    public static boolean canDraftReply(CharSequence pkg) {
        if (pkg == null) return false;
        String p = pkg.toString();
        return p.equals("com.whatsapp") || p.equals("com.whatsapp.w4b");
    }

    /** Draft lifecycle. The ONLY edge that sends is PLACED --confirm--> done. */
    public enum DraftPhase { IDLE, STAGED, PLACED }

    public static long clampAutoScrollInterval(long intervalMs) {
        return Math.max(AUTO_SCROLL_MIN_INTERVAL_MS, intervalMs);
    }

    private AssistPolicy() {}
}
