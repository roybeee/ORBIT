package co.mealzip.orbit;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

/** Browser-backed activity deliberately preserves the existing Sites login cookie jar. */
public final class OrbitActivity extends LauncherActivity {
    @Override protected void launchTwa() {
        try {
            super.launchTwa();
        } catch (RuntimeException e) {
            returnToHome(e);
        }
    }

    @Override protected TwaLauncher.FallbackStrategy getFallbackStrategy() {
        TwaLauncher.FallbackStrategy fallback = super.getFallbackStrategy();
        return (context, builder, provider, completed) -> {
            try {
                fallback.launch(context, builder, provider, completed);
            } catch (RuntimeException e) {
                returnToHome(e);
            }
        };
    }

    private void returnToHome(RuntimeException error) {
        // Do not log workspace URLs, browser state, or user data.
        Log.w("ORBIT", "Browser launch failed: " + error.getClass().getSimpleName());
        startActivity(new Intent(this, HomeActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(HomeActivity.LAUNCH_ERROR, true));
        finish();
    }

    @Override protected Uri getLaunchingUrl() {
        return getUrlForIntent(getIntent());
    }

    @Override protected Uri getUrlForIntent(Intent intent) {
        return Uri.parse(OrbitUrlPolicy.sanitize(intent == null ? null : intent.getDataString(),
                BuildConfig.ORBIT_ORIGIN));
    }
}
