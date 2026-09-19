package co.mealzip.orbit;

import android.database.Cursor;
import android.database.MatrixCursor;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsProvider;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/** Read-only Storage Access Framework source, protected by MANAGE_DOCUMENTS in the manifest. */
public final class InboxDocumentsProvider extends DocumentsProvider {
    private static final String[] ROOT_COLUMNS = {
            DocumentsContract.Root.COLUMN_ROOT_ID, DocumentsContract.Root.COLUMN_FLAGS,
            DocumentsContract.Root.COLUMN_TITLE, DocumentsContract.Root.COLUMN_SUMMARY,
            DocumentsContract.Root.COLUMN_DOCUMENT_ID, DocumentsContract.Root.COLUMN_MIME_TYPES,
            DocumentsContract.Root.COLUMN_ICON, DocumentsContract.Root.COLUMN_AVAILABLE_BYTES
    };
    private static final String[] DOCUMENT_COLUMNS = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_FLAGS,
            DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED
    };

    @Override public boolean onCreate() { return true; }

    @Override public Cursor queryRoots(String[] projection) throws FileNotFoundException {
        MatrixCursor cursor = new MatrixCursor(projection == null ? ROOT_COLUMNS : projection);
        File root = InboxStore.resolveDocument(getContext(), InboxStore.ROOT_DOCUMENT_ID);
        MatrixCursor.RowBuilder row = cursor.newRow();
        put(cursor, row, DocumentsContract.Root.COLUMN_ROOT_ID, "inbox");
        put(cursor, row, DocumentsContract.Root.COLUMN_FLAGS,
                DocumentsContract.Root.FLAG_LOCAL_ONLY | DocumentsContract.Root.FLAG_SUPPORTS_IS_CHILD);
        put(cursor, row, DocumentsContract.Root.COLUMN_TITLE, "ORBIT 받은 파일");
        put(cursor, row, DocumentsContract.Root.COLUMN_SUMMARY, "공유받은 파일 · 24시간 동안 첨부 가능");
        put(cursor, row, DocumentsContract.Root.COLUMN_DOCUMENT_ID, InboxStore.ROOT_DOCUMENT_ID);
        put(cursor, row, DocumentsContract.Root.COLUMN_MIME_TYPES, "*/*");
        put(cursor, row, DocumentsContract.Root.COLUMN_ICON, android.R.drawable.ic_menu_save);
        put(cursor, row, DocumentsContract.Root.COLUMN_AVAILABLE_BYTES, root.getUsableSpace());
        return cursor;
    }

    @Override public Cursor queryDocument(String documentId, String[] projection) throws FileNotFoundException {
        MatrixCursor cursor = documents(projection);
        File file = InboxStore.resolveDocument(getContext(), documentId);
        addDocument(cursor, documentId, file, null);
        return cursor;
    }

    @Override public Cursor queryChildDocuments(String parentDocumentId, String[] projection, String sortOrder)
            throws FileNotFoundException {
        MatrixCursor cursor = documents(projection);
        File parent = InboxStore.resolveDocument(getContext(), parentDocumentId);
        if (!parent.isDirectory()) throw new FileNotFoundException("폴더가 아닙니다.");
        try {
            List<InboxStore.Draft> drafts = InboxStore.list(getContext());
            for (InboxStore.Draft draft : drafts) {
                if (InboxStore.ROOT_DOCUMENT_ID.equals(parentDocumentId)) {
                    addDocument(cursor, draft.id, InboxStore.resolveDocument(getContext(), draft.id), draft);
                } else if (draft.id.equals(parentDocumentId)) {
                    for (File file : draft.files) {
                        String id = InboxStore.documentId(draft, file);
                        addDocument(cursor, id, InboxStore.resolveDocument(getContext(), id), null);
                    }
                }
            }
        } catch (IOException e) { throw new FileNotFoundException("받은 파일 목록을 읽지 못했습니다."); }
        cursor.setNotificationUri(getContext().getContentResolver(),
                DocumentsContract.buildChildDocumentsUri(InboxStore.authority(getContext()), parentDocumentId));
        return cursor;
    }

    @Override public boolean isChildDocument(String parentDocumentId, String documentId) {
        try {
            File parent = InboxStore.resolveDocument(getContext(), parentDocumentId);
            File child = InboxStore.resolveDocument(getContext(), documentId);
            if (!parent.isDirectory() || parent.equals(child)) return false;
            if (InboxStore.ROOT_DOCUMENT_ID.equals(parentDocumentId)) return true;
            return parent.equals(child.getParentFile());
        } catch (FileNotFoundException e) { return false; }
    }

    @Override public String getDocumentType(String documentId) throws FileNotFoundException {
        return InboxStore.mimeType(InboxStore.resolveDocument(getContext(), documentId));
    }

    @Override public ParcelFileDescriptor openDocument(String documentId, String mode, CancellationSignal signal)
            throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("받은 파일은 읽기만 가능합니다.");
        if (signal != null) signal.throwIfCanceled();
        File file = InboxStore.resolveDocument(getContext(), documentId);
        if (!file.isFile()) throw new FileNotFoundException("파일을 선택해 주세요.");
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    private static MatrixCursor documents(String[] projection) {
        return new MatrixCursor(projection == null ? DOCUMENT_COLUMNS : projection);
    }

    private void addDocument(MatrixCursor cursor, String id, File file, InboxStore.Draft draft) {
        String display = file.getName();
        if (InboxStore.ROOT_DOCUMENT_ID.equals(id)) display = "ORBIT 받은 파일";
        else if (file.isDirectory()) {
            long time = draft == null ? file.lastModified() : draft.createdAt;
            display = new SimpleDateFormat("MM.dd HH:mm", Locale.KOREA).format(new Date(time)) + " 공유";
            if (draft != null) display += " (" + draft.files.size() + "개)";
        }
        MatrixCursor.RowBuilder row = cursor.newRow();
        put(cursor, row, DocumentsContract.Document.COLUMN_DOCUMENT_ID, id);
        put(cursor, row, DocumentsContract.Document.COLUMN_DISPLAY_NAME, display);
        put(cursor, row, DocumentsContract.Document.COLUMN_MIME_TYPE, InboxStore.mimeType(file));
        // No write/delete/create flags: mutation is available only inside the native app.
        put(cursor, row, DocumentsContract.Document.COLUMN_FLAGS, 0);
        put(cursor, row, DocumentsContract.Document.COLUMN_SIZE, file.isFile() ? file.length() : null);
        put(cursor, row, DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                draft == null ? file.lastModified() : draft.createdAt);
    }

    private static void put(MatrixCursor cursor, MatrixCursor.RowBuilder row, String column, Object value) {
        if (cursor.getColumnIndex(column) >= 0) row.add(column, value);
    }
}
