package app.mendcraft.relay.nano;

import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.lang.reflect.Method;
import java.util.concurrent.TimeUnit;

/**
 * Native Gemini Nano availability via ML Kit GenAI {@code checkStatus}.
 * FeatureStatus: UNAVAILABLE=0, DOWNLOADABLE=1, DOWNLOADING=2, AVAILABLE=3.
 * Uses reflection so the shell still compiles if genai-prompt is missing;
 * a missing class or GenAiException is reported as unavailable
 * (e.g. a Nothing Phone 3a with no Nano).
 */
@CapacitorPlugin(name = "MendcraftNano")
public class MendcraftNanoPlugin extends Plugin {

    @PluginMethod
    public void checkStatus(PluginCall call) {
        JSObject out = new JSObject();
        if (Build.VERSION.SDK_INT < 26) {
            out.put("status", 0);
            call.resolve(out);
            return;
        }
        try {
            out.put("status", invokeCheckStatus());
        } catch (Throwable t) {
            out.put("status", 0);
        }
        call.resolve(out);
    }

    static int invokeCheckStatus() throws Exception {
        Object model = getModel();
        if (model == null) return 0;
        Method check = model.getClass().getMethod("checkStatus");
        Object result = check.invoke(model);
        if (result instanceof Number) return ((Number) result).intValue();
        if (result != null && result.getClass().getName().contains("ListenableFuture")) {
            Method get = result.getClass().getMethod("get", long.class, TimeUnit.class);
            Object v = get.invoke(result, 3L, TimeUnit.SECONDS);
            return v instanceof Number ? ((Number) v).intValue() : 0;
        }
        return 0;
    }

    private static Object getModel() throws Exception {
        try {
            Class<?> gen = Class.forName("com.google.mlkit.genai.prompt.Generation");
            try {
                return gen.getMethod("getClient").invoke(null);
            } catch (NoSuchMethodException ignored) { /* try GenerativeModel */ }
        } catch (ClassNotFoundException ignored) { /* optional dep */ }
        try {
            return Class.forName("com.google.mlkit.genai.prompt.GenerativeModel")
                .getDeclaredConstructor().newInstance();
        } catch (Throwable ignored) {
            return null;
        }
    }
}
