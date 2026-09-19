package co.mealzip.orbit;

import static org.junit.Assert.*;

import android.content.ClipData;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowContentResolver;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Real temporary files and a synthetic provider; never reads personal device data. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class InboxStoreTest {
    static final String SOURCE_AUTHORITY = "co.mealzip.orbit.synthetic";
    Context context;
    SyntheticShareProvider sources;

    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        sources = new SyntheticShareProvider();
        ProviderInfo info = new ProviderInfo();
        info.authority = SOURCE_AUTHORITY;
        sources.attachInfo(context, info);
        ShadowContentResolver.registerProviderInternal(SOURCE_AUTHORITY, sources);
        for (InboxStore.Draft draft : InboxStore.list(context)) InboxStore.delete(context, draft.id);
    }

    @Test public void rejectsNonContentUrisBeforeMakingAnyDraft() throws Exception {
        for (String raw : Arrays.asList("file:///data/private.txt", "https://example.test/file.pdf",
                "javascript:alert(1)", "content:/missing-authority.pdf")) {
            assertThrows(IOException.class, () -> InboxStore.stage(context, send(Uri.parse(raw))));
        }
        assertEquals(0, InboxStore.root(context).list().length);
    }

    @Test public void rejectsInvalidAndEmptyIntents() throws Exception {
        assertThrows(IOException.class, () -> InboxStore.stage(context, null));
        assertThrows(IOException.class, () -> InboxStore.stage(context, new Intent(Intent.ACTION_VIEW)));
        assertThrows(IOException.class, () -> InboxStore.stage(context, new Intent(Intent.ACTION_SEND)));
        Intent malformed = new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, new Intent());
        assertThrows(IOException.class, () -> InboxStore.stage(context, malformed));
        assertEquals(0, InboxStore.list(context).size());
    }

    @Test public void cannotUseShareReceiverToRecopyItsOwnPrivateProvider() throws Exception {
        InboxStore.Draft existing = InboxStore.stage(context, text("already staged"));
        Uri own = DocumentsContract.buildDocumentUri(InboxStore.authority(context),
                InboxStore.documentId(existing, existing.files.get(0)));
        assertThrows(IOException.class, () -> InboxStore.stage(context, send(own)));
        assertEquals(1, InboxStore.list(context).size());
        assertEquals(existing.id, InboxStore.list(context).get(0).id);
    }

    @Test public void cancellationBeforeCommitLeavesNoTextDraft() throws Exception {
        CancellationSignal signal = new CancellationSignal();
        signal.cancel();
        assertThrows(IOException.class, () -> InboxStore.stage(context, text("cancelled draft"), signal));
        assertTrue(InboxStore.list(context).isEmpty());
        assertEquals(0, InboxStore.root(context).list().length);
    }

    @Test public void sanitizesUntrustedDisplayNamesAndAvoidsDuplicateOverwrite() throws Exception {
        Uri a = sources.add("one", "../../outside\\name.pdf", "application/pdf", "first");
        Uri b = sources.add("two", "../../outside\\name.pdf", "application/pdf", "second");
        InboxStore.Draft draft = InboxStore.stage(context, multiple(a, b));
        assertEquals(2, draft.files.size());
        assertNotEquals(draft.files.get(0).getName(), draft.files.get(1).getName());
        for (File file : draft.files) {
            assertEquals(new File(InboxStore.root(context), draft.id).getCanonicalFile(), file.getCanonicalFile().getParentFile());
            assertFalse(file.getName().contains("/"));
            assertFalse(file.getName().contains("\\"));
            assertFalse(file.getName().startsWith("."));
            assertEquals(file.getCanonicalFile(), InboxStore.resolveDocument(context, InboxStore.documentId(draft, file)).getCanonicalFile());
        }
        assertEquals("first", readText(draft.files.get(0)));
        assertEquals("second", readText(draft.files.get(1)));
    }

    @Test public void mimeClaimCannotPermitUnsupportedExecutableExtension() throws Exception {
        Uri uri = sources.add("executable", "invoice.apk", "application/pdf", "synthetic");
        assertThrows(IOException.class, () -> InboxStore.stage(context, send(uri)));
        assertEquals(0, InboxStore.root(context).list().length);
    }

    @Test public void duplicatesAcrossStreamAndClipDataAreCopiedOnlyOnce() throws Exception {
        Uri uri = sources.add("same", "memo.txt", "text/plain", "hello");
        Intent intent = send(uri);
        intent.setClipData(ClipData.newUri(context.getContentResolver(), "same", uri));
        InboxStore.Draft draft = InboxStore.stage(context, intent);
        assertEquals(1, draft.files.size());
        assertEquals(1, sources.openCount);
    }

    @Test public void aFailedSecondCopyRollsBackTheEntireDraft() throws Exception {
        Uri good = sources.add("good", "memo.txt", "text/plain", "keep existing draft");
        InboxStore.Draft existing = InboxStore.stage(context, send(good));
        Uri bad = sources.add("unreadable", "broken.pdf", "application/pdf", "temporary");
        sources.entries.get("unreadable").file.delete();
        assertThrows(IOException.class, () -> InboxStore.stage(context, multiple(good, bad)));
        List<InboxStore.Draft> drafts = InboxStore.list(context);
        assertEquals(1, drafts.size());
        assertEquals(existing.id, drafts.get(0).id);
        assertEquals(1, InboxStore.root(context).list().length);
        assertEquals("keep existing draft", readText(existing.files.get(0)));
    }

    @Test public void inProgressCopyIsNotVisibleAndCannotBeDeletedByConcurrentListing() throws Exception {
        Uri uri = sources.add("blocked", "memo.txt", "text/plain", "complete bytes");
        sources.openStarted = new CountDownLatch(1);
        sources.releaseOpen = new CountDownLatch(1);
        AtomicReference<InboxStore.Draft> result = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread worker = new Thread(() -> {
            try { result.set(InboxStore.stage(context, send(uri))); }
            catch (Throwable t) { failure.set(t); }
        });
        worker.start();
        try {
            assertTrue("Synthetic copy started", sources.openStarted.await(5, TimeUnit.SECONDS));
            assertTrue("Pending copy must be hidden", InboxStore.list(context).isEmpty());
            assertEquals("Listing must preserve the active copy", 1, InboxStore.root(context).list().length);
        } finally {
            sources.releaseOpen.countDown();
            worker.join(5000);
        }
        assertFalse("Copy completed", worker.isAlive());
        if (failure.get() != null) throw new AssertionError("Background stage failed", failure.get());
        assertNotNull(result.get());
        assertEquals("complete bytes", readText(result.get().files.get(0)));
        assertEquals(1, InboxStore.list(context).size());
    }

    @Test public void expiredFilesCannotBeResolvedBeforeCleanupRuns() throws Exception {
        InboxStore.Draft draft = InboxStore.stage(context, text("temporary"));
        String documentId = InboxStore.documentId(draft, draft.files.get(0));
        File directory = draft.files.get(0).getParentFile();
        Files.write(new File(directory, ".created").toPath(),
                Long.toString(System.currentTimeMillis() - InboxStore.EXPIRY_MILLIS - 1000).getBytes(StandardCharsets.UTF_8));
        assertThrows(FileNotFoundException.class, () -> InboxStore.resolveDocument(context, documentId));
        assertTrue(InboxStore.list(context).isEmpty());
        assertFalse(directory.exists());
    }

    @Test public void listingRemovesInterruptedCopiesButKeepsCompleteDrafts() throws Exception {
        InboxStore.Draft draft = InboxStore.stage(context, text("complete"));
        File interrupted = new File(InboxStore.root(context), ".pending-crashed-copy");
        assertTrue(interrupted.mkdir());
        Files.write(new File(interrupted, "partial.txt").toPath(), "partial".getBytes(StandardCharsets.UTF_8));
        assertEquals(1, InboxStore.list(context).size());
        assertFalse(interrupted.exists());
        assertTrue(draft.files.get(0).isFile());
    }

    @Test public void capacityRejectionDoesNotEvictExistingDrafts() throws Exception {
        for (int i = 0; i < InboxStore.MAX_DRAFTS; i++) InboxStore.stage(context, text("draft " + i));
        assertThrows(IOException.class, () -> InboxStore.stage(context, text("one too many")));
        assertEquals(InboxStore.MAX_DRAFTS, InboxStore.list(context).size());
        assertEquals(InboxStore.MAX_DRAFTS, InboxStore.root(context).list().length);
    }

    @Test public void actualByteLimitRejectsOversizedSourceAndRemovesPartialCopy() throws Exception {
        Uri uri = sources.add("oversized", "large.pdf", "application/pdf", "initial");
        try (RandomAccessFile file = new RandomAccessFile(sources.entries.get("oversized").file, "rw")) {
            file.setLength(25L * 1024 * 1024 + 1);
        }
        assertThrows(IOException.class, () -> InboxStore.stage(context, send(uri)));
        assertTrue(InboxStore.list(context).isEmpty());
        assertEquals(0, InboxStore.root(context).list().length);
    }

    @Test public void textCountsTowardAttachmentCountAndLimitUsesUtf8Bytes() throws Exception {
        ArrayList<Uri> streams = new ArrayList<>();
        for (int i = 0; i < InboxStore.MAX_FILES; i++) streams.add(sources.add("file" + i, "memo.txt", "text/plain", "test"));
        Intent tooMany = new Intent(Intent.ACTION_SEND_MULTIPLE)
                .putParcelableArrayListExtra(Intent.EXTRA_STREAM, streams).putExtra(Intent.EXTRA_TEXT, "ninth attachment");
        assertThrows(IOException.class, () -> InboxStore.stage(context, tooMany));
        assertThrows(IOException.class, () -> InboxStore.stage(context, text("한".repeat(22000))));
        assertEquals(0, InboxStore.root(context).list().length);
    }

    @Test public void traversalAndMetadataDocumentsAreNeverExposed() throws Exception {
        InboxStore.Draft draft = InboxStore.stage(context, text("protected"));
        for (String id : Arrays.asList("../private", draft.id + "/../private.txt", draft.id + "/.created",
                draft.id + "/../../private.txt", draft.id + "\\private.txt", draft.id + "/%2e%2e%2fprivate.txt",
                draft.id + "/nested/file.txt", draft.id + "/", "root/../private")) {
            assertThrows(id, FileNotFoundException.class, () -> InboxStore.resolveDocument(context, id));
        }
        assertThrows(IOException.class, () -> InboxStore.delete(context, "../private"));
        assertTrue(draft.files.get(0).isFile());
    }

    @Test public void symlinkToOutsideFileCannotBeResolved() throws Exception {
        InboxStore.Draft draft = InboxStore.stage(context, text("protected"));
        File outside = new File(context.getCacheDir(), "outside-test.txt");
        Files.write(outside.toPath(), "synthetic outside file".getBytes(StandardCharsets.UTF_8));
        File link = new File(draft.files.get(0).getParentFile(), "link.txt");
        Files.createSymbolicLink(link.toPath(), outside.toPath());
        assertThrows(FileNotFoundException.class, () -> InboxStore.resolveDocument(context, draft.id + "/link.txt"));
        assertEquals(1, InboxStore.list(context).get(0).files.size());
        Files.delete(link.toPath());
    }

    static String readText(File file) throws IOException {
        return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
    }
    static Intent text(String value) { return new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, value); }
    static Intent send(Uri uri) { return new Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uri); }
    static Intent multiple(Uri... uris) {
        return new Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, new ArrayList<>(Arrays.asList(uris)));
    }

    public static final class SyntheticShareProvider extends ContentProvider {
        final Map<String, Entry> entries = new HashMap<>();
        int openCount;
        CountDownLatch openStarted;
        CountDownLatch releaseOpen;
        @Override public boolean onCreate() { return true; }
        Uri add(String id, String name, String mime, String data) throws IOException {
            File file = File.createTempFile("orbit-synthetic-", ".data", getContext().getCacheDir());
            Files.write(file.toPath(), data.getBytes(StandardCharsets.UTF_8));
            entries.put(id, new Entry(file, name, mime));
            return Uri.parse("content://" + SOURCE_AUTHORITY + "/" + id);
        }
        @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sortOrder) {
            Entry entry = entries.get(uri.getLastPathSegment());
            MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME});
            if (entry != null) cursor.addRow(new Object[]{entry.name});
            return cursor;
        }
        @Override public String getType(Uri uri) { Entry e = entries.get(uri.getLastPathSegment()); return e == null ? null : e.mime; }
        @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
            openCount++;
            if (openStarted != null) {
                openStarted.countDown();
                try {
                    if (!releaseOpen.await(5, TimeUnit.SECONDS)) throw new FileNotFoundException("Synthetic test timed out");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new FileNotFoundException("Synthetic test interrupted");
                }
            }
            Entry e = entries.get(uri.getLastPathSegment());
            if (e == null) throw new FileNotFoundException("Synthetic source missing");
            return ParcelFileDescriptor.open(e.file, ParcelFileDescriptor.MODE_READ_ONLY);
        }
        @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
        @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
        @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    }

    static final class Entry {
        final File file;
        final String name;
        final String mime;
        Entry(File file, String name, String mime) { this.file = file; this.name = name; this.mime = mime; }
    }
}
