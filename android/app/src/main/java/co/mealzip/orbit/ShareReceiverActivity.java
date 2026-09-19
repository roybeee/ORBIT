package co.mealzip.orbit;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.IOException;
import java.lang.ref.WeakReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Receives shares into a local inbox; never sends messages or uploads content. */
public final class ShareReceiverActivity extends Activity {
    private StageJob job;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setTitle("ORBIT으로 가져오기");
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        int padding = (int) (28 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding, padding, padding);
        panel.addView(new ProgressBar(this));
        TextView message = new TextView(this);
        message.setText("공유받은 파일을 이 기기에 보관하고 있습니다.\n보관이 끝날 때까지 기다려 주세요.\n파일은 자동으로 업로드되지 않습니다.");
        message.setTextSize(16);
        message.setGravity(Gravity.CENTER);
        message.setPadding(0, padding, 0, 0);
        panel.addView(message);
        Button cancel = new Button(this);
        cancel.setText("가져오기 취소");
        cancel.setOnClickListener(view -> {
            cancel.setEnabled(false);
            message.setText("가져오기를 취소하고 임시 파일을 정리하고 있습니다.");
            if (job != null) job.cancel(false);
        });
        panel.addView(cancel);
        setContentView(panel);

        Object retained = getLastNonConfigurationInstance();
        if (retained instanceof StageJob) {
            job = (StageJob) retained;
        } else {
            job = new StageJob(getApplicationContext(), new Intent(getIntent()));
        }
        job.attach(this);
        job.start();
    }

    @Override public Object onRetainNonConfigurationInstance() { return job; }

    @Override protected void onDestroy() {
        if (job != null) job.detach(this);
        super.onDestroy();
    }

    @Override public void onBackPressed() {
        // Preserve temporary URI grants until the worker has finished copying.
        Toast.makeText(this, "파일 보관이 끝나면 받은 파일 화면으로 이동합니다.", Toast.LENGTH_SHORT).show();
    }

    private void completed(InboxStore.Draft draft, String error) {
        if (error != null) {
            Toast.makeText(this, error, Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, draft.files.size() + "개 파일을 받았습니다. ORBIT에서 첨부할 파일을 선택하세요.",
                    Toast.LENGTH_LONG).show();
        }
        Intent home = new Intent(this, HomeActivity.class);
        home.putExtra("SHOW_INBOX", true);
        if (draft != null) home.putExtra("INBOX_DRAFT_ID", draft.id);
        home.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(home);
        finish();
    }

    /** Retained across rotation; one worker and one completion per received Intent. */
    private static final class StageJob {
        private final Context context;
        private final Intent intent;
        private final Handler main = new Handler(Looper.getMainLooper());
        private final CancellationSignal cancellation = new CancellationSignal();
        private final Runnable timeout = () -> cancel(true);
        private WeakReference<ShareReceiverActivity> activity = new WeakReference<>(null);
        private boolean started;
        private boolean done;
        private boolean delivered;
        private InboxStore.Draft draft;
        private String error;
        private boolean timedOut;

        StageJob(Context context, Intent intent) { this.context = context; this.intent = intent; }

        void attach(ShareReceiverActivity receiver) {
            activity = new WeakReference<>(receiver);
            main.post(this::deliver);
        }

        void detach(ShareReceiverActivity receiver) {
            if (activity.get() == receiver) activity.clear();
        }

        void start() {
            if (started) return;
            started = true;
            main.postDelayed(timeout, 180_000);
            ExecutorService executor = Executors.newSingleThreadExecutor();
            executor.execute(() -> {
                InboxStore.Draft result = null;
                String failure = null;
                try { result = InboxStore.stage(context, intent, cancellation); }
                catch (IOException e) {
                    failure = e.getMessage();
                    if (failure == null || !failure.matches("(?s).*[가-힣].*"))
                        failure = "공유 파일을 보관하지 못했습니다. 원본 앱에서 다시 공유해 주세요.";
                }
                catch (RuntimeException e) { failure = "공유 파일을 보관하지 못했습니다. 다시 공유해 주세요."; }
                InboxStore.Draft completed = result;
                String message = failure;
                main.post(() -> {
                    main.removeCallbacks(timeout);
                    draft = completed;
                    error = completed != null ? null : timedOut ? "파일 가져오기 시간이 초과되었습니다. 원본 파일을 내려받은 뒤 다시 공유하세요."
                            : cancellation.isCanceled() ? "파일 가져오기를 취소했습니다." : message;
                    done = true;
                    deliver();
                });
                executor.shutdown();
            });
        }

        void cancel(boolean timeoutExpired) {
            if (done) return;
            timedOut = timeoutExpired;
            cancellation.cancel();
        }

        private void deliver() {
            ShareReceiverActivity receiver = activity.get();
            if (!done || delivered || receiver == null || receiver.isFinishing() || receiver.isDestroyed()) return;
            delivered = true;
            receiver.completed(draft, error);
        }
    }
}
