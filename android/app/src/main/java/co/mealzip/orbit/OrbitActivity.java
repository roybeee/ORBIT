package co.mealzip.orbit;

import android.content.Intent;
import android.net.Uri;
import com.google.androidbrowserhelper.trusted.LauncherActivity;

/** Browser-backed activity deliberately preserves the existing Sites login cookie jar. */
public final class OrbitActivity extends LauncherActivity {
    @Override protected Uri getLaunchingUrl() {
        return getUrlForIntent(getIntent());
    }

    @Override protected Uri getUrlForIntent(Intent intent) {
        return Uri.parse(OrbitUrlPolicy.sanitize(intent == null ? null : intent.getDataString(),
                BuildConfig.ORBIT_ORIGIN));
    }
}
