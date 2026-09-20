package co.mealzip.orbit;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.File;
import java.util.List;

/** Native launcher and recovery inbox. No tokens or private workspace data live here. */
public final class HomeActivity extends Activity {
    public static final String SHOW_INBOX = "SHOW_INBOX";
    public static final String LAUNCH_ERROR = "LAUNCH_ERROR";
    private static final int BG = Color.rgb(8, 12, 28);
    private static final int FG = Color.rgb(237, 240, 255);
    private static final int MUTED = Color.rgb(164, 175, 206);
    private LinearLayout page;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        registerShortcuts();
        routeLaunchIntent();
    }

    @Override protected void onResume() { super.onResume(); if (page != null) render(); }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        routeLaunchIntent();
    }

    private void routeLaunchIntent() {
        Intent intent = getIntent();
        if (intent.getBooleanExtra(LAUNCH_ERROR, false)) {
            render();
            showLaunchError();
        } else if (intent.getBooleanExtra(SHOW_INBOX, false)) {
            render();
        } else {
            // First install, subsequent launches and launcher shortcuts use the same path.
            // Do not inflate the welcome page or leave it behind the browser on Back.
            String destination = Intent.ACTION_VIEW.equals(intent.getAction())
                    ? intent.getDataString() : BuildConfig.ORBIT_ORIGIN + "/#today";
            if (openOrbit(destination)) finish();
        }
    }

    private void showLaunchError() {
        // Keep recovery mode through rotation; only an explicit retry may relaunch.
        getIntent().putExtra(LAUNCH_ERROR, true);
        getPreferences(MODE_PRIVATE).edit().putBoolean("opened", false).apply();
        new AlertDialog.Builder(this).setTitle("ORBIT을 열지 못했습니다")
                .setMessage("Chrome 또는 삼성 인터넷이 사용 설정되어 있는지 확인한 뒤 다시 시도해 주세요. 주소를 복사해 브라우저에서 직접 열 수도 있습니다.")
                .setNegativeButton("닫기", null)
                .setNeutralButton("주소 복사", (dialog, which) -> {
                    android.content.ClipboardManager clipboard = getSystemService(android.content.ClipboardManager.class);
                    if (clipboard != null) {
                        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("ORBIT", BuildConfig.ORBIT_START_URL));
                        Toast.makeText(this, "ORBIT 주소를 복사했습니다.", Toast.LENGTH_SHORT).show();
                    }
                })
                .setPositiveButton("다시 시도", (dialog, which) -> openOrbit(BuildConfig.ORBIT_START_URL)).show();
    }

    private void registerShortcuts() {
        android.content.pm.ShortcutManager shortcuts = getSystemService(android.content.pm.ShortcutManager.class);
        if (shortcuts == null) return;
        try {
            android.content.pm.ShortcutInfo inbox = new android.content.pm.ShortcutInfo.Builder(this, "inbox")
                    .setShortLabel("받은 파일")
                    .setIcon(android.graphics.drawable.Icon.createWithResource(this, R.drawable.orbit_logo))
                    .setIntent(new Intent(this, HomeActivity.class).setAction(Intent.ACTION_MAIN).putExtra(SHOW_INBOX, true)).build();
            android.content.pm.ShortcutInfo today = new android.content.pm.ShortcutInfo.Builder(this, "today")
                    .setShortLabel("오늘의 업무")
                    .setIcon(android.graphics.drawable.Icon.createWithResource(this, R.drawable.orbit_logo))
                    .setIntent(new Intent(this, HomeActivity.class).setAction(Intent.ACTION_VIEW)
                            .setData(Uri.parse(BuildConfig.ORBIT_ORIGIN + "/#today"))).build();
            shortcuts.setDynamicShortcuts(java.util.Arrays.asList(today, inbox));
        } catch (IllegalStateException ignored) { /* The launcher may be locked or rate limited. */ }
    }

    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, int color) {
        TextView v = new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(color);
        v.setLineSpacing(dp(3), 1); return v;
    }
    private void space(int height) { View v = new View(this); page.addView(v, new LinearLayout.LayoutParams(1, dp(height))); }
    private Button button(String title, Runnable action) {
        Button b = new Button(this); b.setText(title); b.setAllCaps(false); b.setTextColor(FG);
        b.setTextSize(16); b.setMinHeight(dp(52)); b.setOnClickListener(v -> action.run());
        GradientDrawable bg = new GradientDrawable(); bg.setColor(Color.rgb(39, 46, 88)); bg.setCornerRadius(dp(16));
        b.setBackground(bg); LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2); p.topMargin = dp(10);
        page.addView(b, p); return b;
    }

    private void render() {
        getWindow().setStatusBarColor(BG); getWindow().setNavigationBarColor(BG);
        ScrollView scroll = new ScrollView(this); scroll.setBackgroundColor(BG); scroll.setFillViewport(true);
        page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(24), dp(24), dp(24), dp(28)); scroll.addView(page);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bar = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bar.left, bar.top, bar.right, bar.bottom);
            } else { view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom()); }
            return insets;
        });
        setContentView(scroll);
        TextView badge = text(BuildConfig.DEBUG ? "ANDROID · BETA" : "ANDROID", 12, Color.rgb(148, 151, 255));
        badge.setLetterSpacing(.18f); page.addView(badge); space(26);
        ImageView logo = new ImageView(this); logo.setImageResource(R.drawable.orbit_logo);
        logo.setContentDescription("ORBIT"); page.addView(logo, new LinearLayout.LayoutParams(dp(76), dp(76))); space(20);
        TextView title = text("ORBIT", 38, FG); title.setTypeface(Typeface.DEFAULT, Typeface.BOLD); page.addView(title);
        page.addView(text("목표에 닿을 때까지.\n나의 페이스메이커", 23, FG)); space(12);
        page.addView(text("대화, 일정, 프로젝트와 지식을\n기존 ORBIT 계정 그대로 이어갑니다.", 15, MUTED)); space(14);
        button("ORBIT 열기  →", () -> openOrbit(BuildConfig.ORBIT_START_URL));
        button("오늘의 업무", () -> openOrbit(BuildConfig.ORBIT_ORIGIN + "/#today"));
        button("대시보드", () -> openOrbit(BuildConfig.ORBIT_ORIGIN + "/#dashboard"));
        space(32);
        TextView inbox = text("받은 파일", 23, FG); inbox.setTypeface(Typeface.DEFAULT, Typeface.BOLD); page.addView(inbox);
        page.addView(text("다른 앱에서 공유 → ORBIT을 선택하세요.\n파일은 24시간 동안 첨부할 수 있습니다.", 14, MUTED)); space(14);
        try {
            List<InboxStore.Draft> drafts = InboxStore.list(this);
            if (drafts.isEmpty()) page.addView(text("아직 받은 파일이 없습니다.", 15, MUTED));
            for (InboxStore.Draft draft : drafts) addDraft(draft);
        } catch (Exception e) { page.addView(text("받은 파일을 열지 못했습니다. 앱을 다시 실행해 주세요.", 14, MUTED)); }
        button("첨부하는 방법", this::showAttachHelp);
        space(28);
        page.addView(text("기간이 지난 임시 파일은 다음 실행 시 정리됩니다.\n업무 저장과 AI 대화에는 인터넷이 필요합니다.\n로그인은 연결된 브라우저에서 진행됩니다.", 12, MUTED));
        space(8); page.addView(text("버전 " + BuildConfig.VERSION_NAME, 12, MUTED));
    }

    private void addDraft(InboxStore.Draft draft) {
        LinearLayout card = new LinearLayout(this); card.setOrientation(LinearLayout.VERTICAL); card.setPadding(dp(16),dp(16),dp(16),dp(16));
        GradientDrawable bg = new GradientDrawable(); bg.setColor(Color.rgb(19,27,48)); bg.setCornerRadius(dp(18)); card.setBackground(bg);
        for (File file : draft.files) {
            String size = file.length() >= 1048576 ? String.format(java.util.Locale.KOREA, "%.1f MB", file.length()/1048576.0) : Math.max(1,file.length()/1024) + " KB";
            card.addView(text(file.getName() + "  ·  " + size, 14, FG));
        }
        long hours = Math.max(0, (draft.createdAt + 24*60*60*1000L - System.currentTimeMillis()) / 3600000);
        card.addView(text((hours > 0 ? hours + "시간 후" : "1시간 이내") + " 첨부 기간 만료 · 아직 업로드되지 않음", 12, MUTED));
        Button attach = new Button(this); attach.setText("ORBIT에서 첨부하기"); attach.setAllCaps(false); attach.setOnClickListener(v -> showAttachHelp()); card.addView(attach);
        Button delete = new Button(this); delete.setText("기기의 임시 파일 삭제"); delete.setAllCaps(false);
        delete.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("임시 파일을 삭제할까요?")
                .setMessage("이미 ORBIT에 업로드한 파일은 유지됩니다.")
                .setNegativeButton("취소", null).setPositiveButton("삭제", (d,w) -> {
                    try { InboxStore.delete(this, draft.id); render(); }
                    catch (Exception e) { Toast.makeText(this,"삭제하지 못했습니다.",Toast.LENGTH_LONG).show(); }
                }).show()); card.addView(delete);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1,-2); p.bottomMargin=dp(12); page.addView(card,p);
    }

    private void showAttachHelp() {
        new AlertDialog.Builder(this).setTitle("받은 파일을 ORBIT에 첨부")
                .setMessage("1. ORBIT에서 대화나 일정을 여세요.\n2. 파일 첨부 → 찾아보기를 누르세요.\n3. 파일 선택 화면의 ☰ 메뉴에서 ‘ORBIT 받은 파일’을 선택하세요.\n4. 파일을 선택하고 ORBIT에서 저장·전송하세요.\n\n사진 선택 화면이 뜨면 ‘찾아보기’ 또는 ‘다른 앱에서 선택’을 누르세요. 자동으로 전송되지 않습니다.")
                .setNegativeButton("닫기",null).setPositiveButton("ORBIT 열기",(d,w)->openOrbit(BuildConfig.ORBIT_START_URL)).show();
    }

    private boolean openOrbit(String requested) {
        try {
            startActivity(new Intent(this, OrbitActivity.class).setData(Uri.parse(OrbitUrlPolicy.sanitize(requested, BuildConfig.ORBIT_ORIGIN))));
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            render();
            showLaunchError();
            return false;
        }
    }
}
