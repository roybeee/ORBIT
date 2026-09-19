package co.mealzip.orbit;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.io.FileNotFoundException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class InboxDocumentsProviderTest {
    private Context context;
    private InboxDocumentsProvider provider;
    private InboxStore.Draft draft;
    private String documentId;

    @Before public void setup() throws Exception {
        context = RuntimeEnvironment.getApplication();
        for (InboxStore.Draft existing : InboxStore.list(context)) InboxStore.delete(context, existing.id);
        provider = new InboxDocumentsProvider();
        ProviderInfo info = new ProviderInfo();
        info.authority = InboxStore.authority(context);
        info.exported = true;
        info.grantUriPermissions = true;
        info.readPermission = "android.permission.MANAGE_DOCUMENTS";
        info.writePermission = "android.permission.MANAGE_DOCUMENTS";
        provider.attachInfo(context, info);
        draft = InboxStore.stage(context, InboxStoreTest.text("Synthetic file content"));
        documentId = InboxStore.documentId(draft, draft.files.get(0));
    }

    @Test public void fileReadReturnsExactContentAndWriteModesAreRejected() throws Exception {
        try (ParcelFileDescriptor fd = provider.openDocument(documentId, "r", null);
             ParcelFileDescriptor.AutoCloseInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(fd)) {
            assertEquals("Synthetic file content", new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
        for (String mode : Arrays.asList("w", "wt", "wa", "rw", "rwt", "", null))
            assertThrows(FileNotFoundException.class, () -> provider.openDocument(documentId, mode, null));
        assertThrows(FileNotFoundException.class, () -> provider.openDocument(draft.id, "r", null));
        assertThrows(FileNotFoundException.class, () -> provider.openDocument("root", "r", null));
    }

    @Test public void cancelledDocumentOpenCannotProduceDescriptor() {
        CancellationSignal signal = new CancellationSignal();
        signal.cancel();
        assertThrows(OperationCanceledException.class, () -> provider.openDocument(documentId, "r", signal));
    }

    @Test public void onlyActualDescendantsPassChildCheck() throws Exception {
        InboxStore.Draft another = InboxStore.stage(context, InboxStoreTest.text("other draft"));
        String anotherId = InboxStore.documentId(another, another.files.get(0));
        assertTrue(provider.isChildDocument("root", draft.id));
        assertTrue(provider.isChildDocument("root", documentId));
        assertTrue(provider.isChildDocument(draft.id, documentId));
        assertFalse(provider.isChildDocument(draft.id, anotherId));
        assertFalse(provider.isChildDocument(draft.id, draft.id));
        assertFalse(provider.isChildDocument(documentId, draft.id));
        assertFalse(provider.isChildDocument("root", draft.id + "/../private.txt"));
        assertFalse(provider.isChildDocument("missing", documentId));
    }

    @Test public void pickerListsGroupsThenFilesWithoutMetadataOrWriteFlags() throws Exception {
        try (Cursor root = provider.queryChildDocuments("root", null, (String) null)) {
            assertEquals(1, root.getCount());
            assertTrue(root.moveToFirst());
            assertEquals(draft.id, root.getString(root.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)));
            assertEquals(DocumentsContract.Document.MIME_TYPE_DIR,
                    root.getString(root.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)));
        }
        try (Cursor files = provider.queryChildDocuments(draft.id, null, (String) null)) {
            assertEquals("Hidden retention metadata must not enter picker", 1, files.getCount());
            assertTrue(files.moveToFirst());
            assertEquals(documentId, files.getString(files.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)));
            assertEquals("text/plain", files.getString(files.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)));
            assertEquals(0, files.getInt(files.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_FLAGS)));
            assertEquals(draft.files.get(0).length(), files.getLong(files.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_SIZE)));
        }
    }

    @Test public void customProjectionIsRespectedAndDeletedUrisStopWorking() throws Exception {
        String[] projection = {DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_SIZE};
        try (Cursor cursor = provider.queryDocument(documentId, projection)) {
            assertArrayEquals(projection, cursor.getColumnNames());
            assertTrue(cursor.moveToFirst());
            assertEquals(draft.files.get(0).getName(), cursor.getString(0));
        }
        InboxStore.delete(context, draft.id);
        assertThrows(FileNotFoundException.class, () -> provider.openDocument(documentId, "r", null));
        assertThrows(FileNotFoundException.class, () -> provider.queryDocument(documentId, null));
        assertFalse(provider.isChildDocument("root", documentId));
    }
}
