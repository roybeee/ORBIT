package co.mealzip.orbit;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.ServiceInfo;
import android.content.pm.ShortcutManager;
import android.net.Uri;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.shadows.ShadowAlertDialog;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35)
public class OrbitLaunchTest {
    private Context context() { return RuntimeEnvironment.getApplication(); }
    private ComponentName settingsComponent() {
        return new ComponentName(context(), ManageDataLauncherActivity.class);
    }

    @Test public void browserHelperSettingsComponentExistsInInstalledManifest() throws Exception {
        // Android rejects setComponentEnabledSetting for undeclared components. Robolectric's
        // setter does not enforce that contract, so lifecycle-only tests missed the beta crash.
        ActivityInfo info = context().getPackageManager().getActivityInfo(settingsComponent(),
                PackageManager.GET_META_DATA | PackageManager.MATCH_DISABLED_COMPONENTS);
        assertFalse("Browser settings only need an internal explicit intent", info.exported);
        assertEquals(BuildConfig.ORBIT_START_URL,
                info.metaData.getString("android.support.customtabs.trusted.MANAGE_SPACE_URL"));
    }

    @Test public void missingBrowserDisablesSettingsWithoutLeavingADeadShortcut() {
        ManageDataLauncherActivity.addSiteSettingsShortcut(context(), null);
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                context().getPackageManager().getComponentEnabledSetting(settingsComponent()));
        assertFalse(context().getSystemService(ShortcutManager.class).getDynamicShortcuts().stream()
                .anyMatch(s -> ManageDataLauncherActivity.SITE_SETTINGS_SHORTCUT_ID.equals(s.getId())));
    }

    @Test public void supportedBrowserReenablesSettingsAndCreatesWorkingShortcut() {
        String browser = "test.orbit.browser";
        PackageManager manager = context().getPackageManager();
        ServiceInfo service = shadowOf(manager).addServiceIfNotPresent(
                new ComponentName(browser, browser + ".CustomTabsService"));
        service.exported = true;
        ResolveInfo supported = new ResolveInfo();
        supported.serviceInfo = service;
        Intent query = new Intent("android.support.customtabs.action.CustomTabsService")
                .addCategory("androidx.browser.trusted.category.LaunchSiteSettings")
                .setPackage(browser);
        shadowOf(manager).addResolveInfoForIntent(query, supported);
        ManageDataLauncherActivity.addSiteSettingsShortcut(context(), null);
        ManageDataLauncherActivity.addSiteSettingsShortcut(context(), browser);
        assertEquals(PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
                manager.getComponentEnabledSetting(settingsComponent()));
        var shortcut = context().getSystemService(ShortcutManager.class).getDynamicShortcuts().stream()
                .filter(s -> ManageDataLauncherActivity.SITE_SETTINGS_SHORTCUT_ID.equals(s.getId()))
                .findFirst().orElseThrow();
        assertEquals(settingsComponent(), shortcut.getIntent().getComponent());
    }

    @Test public void openingWorkspaceWithoutBrowserDoesNotCrash() {
        Intent intent = new Intent(context(), OrbitActivity.class)
                .setData(Uri.parse(BuildConfig.ORBIT_START_URL))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try (var controller = Robolectric.buildActivity(OrbitActivity.class, intent)) {
            controller.setup();
        }
    }

    @Test public void allWorkspaceButtonsLaunchTheirExpectedInternalDestination() {
        try (var controller = Robolectric.buildActivity(HomeActivity.class,
                new Intent(context(), HomeActivity.class).putExtra(HomeActivity.SHOW_INBOX, true))) {
            HomeActivity home = controller.setup().get();
            String[][] buttons = {{"ORBIT 열기  →", "/"}, {"오늘의 업무", "/#today"}, {"대시보드", "/#dashboard"}};
            for (String[] entry : buttons) {
                button(home.getWindow().getDecorView(), entry[0]).performClick();
                Intent launched = shadowOf(home).getNextStartedActivity();
                assertNotNull(launched);
                assertEquals(new ComponentName(home, OrbitActivity.class), launched.getComponent());
                assertEquals(BuildConfig.ORBIT_ORIGIN + entry[1], launched.getDataString());
                assertFalse(home.isFinishing());
            }
        }
    }

    @Test public void attachmentHelpOpensADialogWithoutLeavingHome() {
        try (var controller = Robolectric.buildActivity(HomeActivity.class,
                new Intent(context(), HomeActivity.class).putExtra(HomeActivity.SHOW_INBOX, true))) {
            HomeActivity home = controller.setup().get();
            button(home.getWindow().getDecorView(), "첨부하는 방법").performClick();
            AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
            assertNotNull(dialog);
            assertTrue(dialog.isShowing());
            assertNull(shadowOf(home).getNextStartedActivity());
            assertFalse(home.isFinishing());
            dialog.getButton(DialogInterface.BUTTON_NEGATIVE).performClick();
            shadowOf(android.os.Looper.getMainLooper()).idle();
            assertFalse(dialog.isShowing());
        }
    }

    @Test public void attachmentHelpCanOpenWorkspace() {
        try (var controller = Robolectric.buildActivity(HomeActivity.class,
                new Intent(context(), HomeActivity.class).putExtra(HomeActivity.SHOW_INBOX, true))) {
            HomeActivity home = controller.setup().get();
            button(home.getWindow().getDecorView(), "첨부하는 방법").performClick();
            ShadowAlertDialog.getLatestAlertDialog().getButton(DialogInterface.BUTTON_POSITIVE).performClick();
            shadowOf(android.os.Looper.getMainLooper()).idle();
            Intent launched = shadowOf(home).getNextStartedActivity();
            assertEquals(new ComponentName(home, OrbitActivity.class), launched.getComponent());
            assertEquals(BuildConfig.ORBIT_START_URL, launched.getDataString());
        }
    }

    @Test @Config(shadows = FailingSettings.class)
    public void browserLaunchExceptionReturnsToRecoveryHome() {
        Intent intent = new Intent(context(), OrbitActivity.class)
                .setData(Uri.parse(BuildConfig.ORBIT_START_URL))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try (var controller = Robolectric.buildActivity(OrbitActivity.class, intent)) {
            OrbitActivity activity = controller.setup().get();
            Intent recovery = shadowOf(activity).getNextStartedActivity();
            assertNotNull(recovery);
            assertEquals(new ComponentName(context(), HomeActivity.class), recovery.getComponent());
            assertTrue(recovery.getBooleanExtra(HomeActivity.LAUNCH_ERROR, false));
            assertTrue(activity.isFinishing());
        }
    }

    @Test public void recoveryDialogPreventsAutomaticRelaunchAndCanCopyAddress() {
        try (var controller = Robolectric.buildActivity(HomeActivity.class,
                new Intent(context(), HomeActivity.class).putExtra(HomeActivity.SHOW_INBOX, true))) {
            HomeActivity home = controller.setup().get();
            home.getPreferences(Context.MODE_PRIVATE).edit().putBoolean("opened", true).commit();
            home.onNewIntent(new Intent(home, HomeActivity.class).putExtra(HomeActivity.LAUNCH_ERROR, true));
            AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
            assertTrue(dialog.isShowing());
            assertFalse(home.getPreferences(Context.MODE_PRIVATE).getBoolean("opened", true));
            assertNull(shadowOf(home).getNextStartedActivity());
            assertFalse(home.isFinishing());
            dialog.getButton(DialogInterface.BUTTON_NEUTRAL).performClick();
            shadowOf(android.os.Looper.getMainLooper()).idle();
            android.content.ClipboardManager clipboard = home.getSystemService(android.content.ClipboardManager.class);
            assertEquals(BuildConfig.ORBIT_START_URL, clipboard.getPrimaryClip().getItemAt(0).getText().toString());
        }
    }

    @Test public void firstLaunchOpensTodayWithoutWelcomeScreenOrPreference() {
        try (var controller = Robolectric.buildActivity(HomeActivity.class,
                new Intent(context(), HomeActivity.class).setAction(Intent.ACTION_MAIN))) {
            HomeActivity home = controller.setup().get();
            Intent launched = shadowOf(home).getNextStartedActivity();
            assertEquals(new ComponentName(home, OrbitActivity.class), launched.getComponent());
            assertEquals(BuildConfig.ORBIT_ORIGIN + "/#today", launched.getDataString());
            assertTrue(home.isFinishing());
            assertNull(findButton(home.getWindow().getDecorView(), "ORBIT 열기  →"));
            assertNull(shadowOf(home).getNextStartedActivity());
        }
    }

    @Test public void explicitInboxDoesNotAutomaticallyLaunchWorkspace() {
        try (var controller = Robolectric.buildActivity(HomeActivity.class,
                new Intent(context(), HomeActivity.class).putExtra(HomeActivity.SHOW_INBOX, true))) {
            HomeActivity home = controller.setup().get();
            assertNull(shadowOf(home).getNextStartedActivity());
            assertFalse(home.isFinishing());
            assertNotNull(button(home.getWindow().getDecorView(), "첨부하는 방법"));
        }
    }

    @Test public void warmDeepLinkPreservesDestinationAndFinishesLauncher() {
        try (var controller = Robolectric.buildActivity(HomeActivity.class,
                new Intent(context(), HomeActivity.class).putExtra(HomeActivity.SHOW_INBOX, true))) {
            HomeActivity home = controller.setup().get();
            home.onNewIntent(new Intent(home, HomeActivity.class).setAction(Intent.ACTION_VIEW)
                    .setData(Uri.parse(BuildConfig.ORBIT_ORIGIN + "/#calendar")));
            assertEquals(BuildConfig.ORBIT_ORIGIN + "/#calendar",
                    shadowOf(home).getNextStartedActivity().getDataString());
            assertTrue(home.isFinishing());
        }
    }

    @Test public void warmLauncherOpensTodayEvenAfterInbox() {
        try (var controller = Robolectric.buildActivity(HomeActivity.class,
                new Intent(context(), HomeActivity.class).putExtra(HomeActivity.SHOW_INBOX, true))) {
            HomeActivity home = controller.setup().get();
            home.onNewIntent(new Intent(home, HomeActivity.class).setAction(Intent.ACTION_MAIN));
            assertEquals(BuildConfig.ORBIT_ORIGIN + "/#today",
                    shadowOf(home).getNextStartedActivity().getDataString());
            assertTrue(home.isFinishing());
        }
    }

    @Test public void recoveryRecreationDoesNotAutomaticallyRetry() {
        try (var controller = Robolectric.buildActivity(HomeActivity.class,
                new Intent(context(), HomeActivity.class).putExtra(HomeActivity.LAUNCH_ERROR, true))) {
            controller.setup();
            assertNull(shadowOf(controller.get()).getNextStartedActivity());
            controller.recreate();
            assertNull(shadowOf(controller.get()).getNextStartedActivity());
            assertFalse(controller.get().isFinishing());
        }
    }

    @Implements(ManageDataLauncherActivity.class)
    public static class FailingSettings {
        @Implementation protected static void addSiteSettingsShortcut(Context context, String provider) {
            throw new IllegalArgumentException("Simulated Android component activation failure");
        }
    }

    private Button button(View root, String label) {
        Button found = findButton(root, label);
        assertNotNull("Missing button: " + label, found);
        return found;
    }

    private Button findButton(View root, String label) {
        if (root instanceof Button && label.contentEquals(((Button) root).getText())) return (Button) root;
        if (root instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                Button found = findButton(group.getChildAt(i), label);
                if (found != null) return found;
            }
        }
        return null;
    }
}
