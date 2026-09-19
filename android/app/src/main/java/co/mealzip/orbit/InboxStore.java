package co.mealzip.orbit;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.OperationCanceledException;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/** Device-only staging area. Nothing here is uploaded or backed up. */
public final class InboxStore {
    public static final String ROOT_DOCUMENT_ID = "root";
    public static final int MAX_FILES = 8;
    public static final int MAX_DRAFTS = 10;
    public static final long EXPIRY_MILLIS = 24L * 60 * 60 * 1000;
    private static final long NORMAL_LIMIT = 25L * 1024 * 1024;
    private static final long VIDEO_LIMIT = 100L * 1024 * 1024;
    private static final long TOTAL_LIMIT = 150L * 1024 * 1024;
    private static final int TEXT_LIMIT = 64 * 1024;
    private static final String CREATED = ".created";
    private static final Object LOCK = new Object();
    private static final Set<String> ACTIVE = new HashSet<>();
    private static final Set<String> EXTENSIONS = new HashSet<>(Arrays.asList(
            "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "mp4", "mov", "webm", "mkv",
            "pdf", "txt", "md", "csv", "doc", "docx", "xls", "xlsx", "ppt", "pptx"));
    private static final Set<String> VIDEO_EXTENSIONS = new HashSet<>(Arrays.asList("mp4", "mov", "webm", "mkv"));

    public static final class Draft {
        public final String id;
        public final long createdAt;
        public final List<File> files;

        Draft(String id, long createdAt, List<File> files) {
            this.id = id;
            this.createdAt = createdAt;
            this.files = Collections.unmodifiableList(files);
        }
    }

    private InboxStore() {}

    public static String authority(Context context) { return context.getPackageName() + ".inbox"; }

    public static File root(Context context) throws IOException {
        File root = new File(context.getNoBackupFilesDir(), "share-inbox");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("받은 파일 보관함을 열 수 없습니다.");
        return root.getCanonicalFile();
    }

    /** Lists only fully copied groups; also removes expired and interrupted copies. */
    public static List<Draft> list(Context context) throws IOException {
        synchronized (LOCK) {
            File root = root(context);
            cleanup(root);
            List<Draft> drafts = new ArrayList<>();
            File[] children = root.listFiles();
            if (children == null) throw new IOException("받은 파일 목록을 읽을 수 없습니다.");
            for (File child : children) {
                if (!validGroupId(child.getName()) || !child.isDirectory() || !inside(child, root)) continue;
                List<File> files = new ArrayList<>();
                File[] contents = child.listFiles();
                if (contents != null) for (File file : contents) {
                    if (validFileName(file.getName()) && file.isFile() && inside(file, child)) files.add(file);
                }
                files.sort(Comparator.comparing(File::getName));
                drafts.add(new Draft(child.getName(), createdAt(child), files));
            }
            drafts.sort((a, b) -> Long.compare(b.createdAt, a.createdAt));
            return drafts;
        }
    }

    /** Must be called off the main thread. Incoming URI permissions live until this Activity finishes. */
    public static Draft stage(Context context, Intent intent) throws IOException {
        return stage(context, intent, new CancellationSignal());
    }

    public static Draft stage(Context context, Intent intent, CancellationSignal cancellation) throws IOException {
        if (intent == null || (!Intent.ACTION_SEND.equals(intent.getAction())
                && !Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))) {
            throw new IOException("지원하지 않는 공유 요청입니다.");
        }
        LinkedHashSet<Uri> uris = collectUris(intent);
        byte[] text = sharedText(intent);
        int count = uris.size() + (text.length == 0 ? 0 : 1);
        if (count == 0) throw new IOException("공유할 파일이나 텍스트가 없습니다.");
        if (count > MAX_FILES) throw new IOException("텍스트를 포함해 한 번에 파일 8개까지 공유할 수 있습니다.");
        File inbox = root(context);
        String id = UUID.randomUUID().toString();
        File pending = new File(inbox, ".pending-" + id);
        synchronized (LOCK) {
            cleanup(inbox);
            File[] groups = inbox.listFiles();
            if (groups == null) throw new IOException("받은 파일 보관함을 확인할 수 없습니다.");
            int pendingCount = 0;
            for (File group : groups) if (group.isDirectory()
                    && (validGroupId(group.getName()) || ACTIVE.contains(group.getName()))) pendingCount++;
            if (pendingCount >= MAX_DRAFTS) throw new IOException("받은 파일이 10건 있습니다. 보관함에서 정리한 뒤 다시 공유하세요.");
            if (!pending.mkdir()) throw new IOException("파일을 임시 보관할 공간을 만들 수 없습니다.");
            ACTIVE.add(pending.getName());
        }
        boolean committed = false;
        try {
            long total = 0;
            List<File> copied = new ArrayList<>();
            for (Uri uri : uris) {
                cancellation.throwIfCanceled();
                if (Thread.currentThread().isInterrupted()) throw new IOException("파일 가져오기가 취소되었습니다.");
                if (authority(context).equals(uri.getAuthority()))
                    throw new IOException("이미 ORBIT에 보관된 파일입니다. 받은 파일 화면에서 선택해 주세요.");
                String name = displayName(context, uri, cancellation);
                String mime = extension(name).isEmpty() ? context.getContentResolver().getType(uri) : null;
                name = supportedName(name, mime);
                String extension = extension(name);
                long limit = VIDEO_EXTENSIONS.contains(extension) ? VIDEO_LIMIT : NORMAL_LIMIT;
                File destination = uniqueFile(pending, name);
                long bytes = copy(context, uri, destination, Math.min(limit, TOTAL_LIMIT - total), cancellation);
                total += bytes;
                copied.add(destination);
            }
            if (text.length > 0) {
                if (total + text.length > TOTAL_LIMIT) throw new IOException("공유한 파일의 합계는 150 MB 이하여야 합니다.");
                File destination = uniqueFile(pending, "공유한 내용.txt");
                try (FileOutputStream out = new FileOutputStream(destination)) { out.write(text); out.getFD().sync(); }
                copied.add(destination);
            }
            long createdAt = System.currentTimeMillis();
            cancellation.throwIfCanceled();
            try (FileOutputStream out = new FileOutputStream(new File(pending, CREATED))) {
                out.write(Long.toString(createdAt).getBytes(StandardCharsets.US_ASCII)); out.getFD().sync();
            }
            File complete = new File(inbox, id);
            synchronized (LOCK) {
                cancellation.throwIfCanceled();
                if (!pending.renameTo(complete)) throw new IOException("파일 보관을 완료하지 못했습니다.");
                ACTIVE.remove(pending.getName());
                committed = true;
            }
            List<File> finalFiles = new ArrayList<>();
            for (File file : copied) finalFiles.add(new File(complete, file.getName()));
            changed(context);
            return new Draft(id, createdAt, finalFiles);
        } catch (OperationCanceledException e) {
            throw new IOException("파일 가져오기를 취소했습니다. 필요한 파일만 다시 공유하세요.", e);
        } catch (SecurityException e) {
            throw new IOException("파일을 읽을 권한이 없습니다. 원래 앱에서 다시 공유해 주세요.", e);
        } catch (RuntimeException e) {
            throw new IOException("공유 파일을 읽지 못했습니다. 원래 앱에서 다시 공유해 주세요.", e);
        } finally {
            if (!committed) synchronized (LOCK) {
                ACTIVE.remove(pending.getName());
                erase(pending);
            }
        }
    }

    public static void delete(Context context, String id) throws IOException {
        if (!validGroupId(id)) throw new IOException("올바르지 않은 보관함 번호입니다.");
        synchronized (LOCK) {
            File directory = new File(root(context), id);
            if (directory.exists() && !erase(directory)) throw new IOException("일부 파일을 정리하지 못했습니다. 다시 시도하세요.");
        }
        changed(context);
    }

    public static String documentId(Draft draft, File file) {
        if (draft == null || file == null || !validGroupId(draft.id) || !validFileName(file.getName()))
            throw new IllegalArgumentException("Invalid document");
        return draft.id + "/" + file.getName();
    }

    /** Only known, unexpired groups and direct children can be exposed by DocumentsProvider. */
    public static File resolveDocument(Context context, String documentId) throws FileNotFoundException {
        try {
            synchronized (LOCK) {
                File root = root(context);
                if (ROOT_DOCUMENT_ID.equals(documentId)) return root;
                if (documentId == null) throw new IOException("missing id");
                int slash = documentId.indexOf('/');
                String group = slash < 0 ? documentId : documentId.substring(0, slash);
                if (!validGroupId(group)) throw new IOException("invalid group");
                File directory = new File(root, group);
                if (!directory.isDirectory() || !inside(directory, root) || expired(directory))
                    throw new IOException("expired or missing");
                if (slash < 0) return directory;
                String name = documentId.substring(slash + 1);
                if (!validFileName(name)) throw new IOException("invalid name");
                File file = new File(directory, name);
                if (!file.isFile() || !inside(file, directory)) throw new IOException("missing file");
                return file;
            }
        } catch (IOException | RuntimeException e) {
            throw new FileNotFoundException("파일이 없거나 보관 기간(24시간)이 지났습니다.");
        }
    }

    public static String mimeType(File file) {
        if (file.isDirectory()) return DocumentsContract.Document.MIME_TYPE_DIR;
        // The picker must advertise every supported format consistently, including
        // on devices whose system MIME registry lacks a document/image extension.
        switch (extension(file.getName())) {
            case "txt": case "md": return "text/plain";
            case "csv": return "text/csv";
            case "pdf": return "application/pdf";
            case "jpg": case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "heic": return "image/heic";
            case "heif": return "image/heif";
            case "mp4": return "video/mp4";
            case "mov": return "video/quicktime";
            case "webm": return "video/webm";
            case "mkv": return "video/x-matroska";
            case "doc": return "application/msword";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xls": return "application/vnd.ms-excel";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "ppt": return "application/vnd.ms-powerpoint";
            case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
            default: return "application/octet-stream";
        }
    }

    private static LinkedHashSet<Uri> collectUris(Intent intent) throws IOException {
        LinkedHashSet<Uri> uris = new LinkedHashSet<>();
        try {
            if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                ArrayList<?> streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (streams != null) for (Object value : streams) {
                    if (!(value instanceof Uri)) throw new IOException("올바르지 않은 공유 파일입니다.");
                    uris.add((Uri) value);
                }
            } else {
                Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream != null) {
                    if (!(stream instanceof Uri)) throw new IOException("올바르지 않은 공유 파일입니다.");
                    uris.add((Uri) stream);
                }
            }
            ClipData clip = intent.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
                if (uris.size() > MAX_FILES) throw new IOException("한 번에 파일 8개까지 공유할 수 있습니다.");
            }
            for (Uri uri : uris) if (!"content".equalsIgnoreCase(uri.getScheme()) || uri.getAuthority() == null)
                throw new IOException("이 앱에서 제공한 파일은 읽을 수 없습니다. 파일 앱에서 다시 공유하세요.");
            return uris;
        } catch (RuntimeException e) { throw new IOException("공유 요청을 읽지 못했습니다.", e); }
    }

    private static byte[] sharedText(Intent intent) throws IOException {
        LinkedHashSet<String> pieces = new LinkedHashSet<>();
        try {
            CharSequence subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (subject != null && subject.length() > 0) pieces.add(boundedText(subject));
            if (text != null && text.length() > 0) pieces.add(boundedText(text));
            ClipData clip = intent.getClipData();
            if (clip != null) for (int i = 0; i < clip.getItemCount(); i++) {
                CharSequence itemText = clip.getItemAt(i).getText();
                if (itemText != null && itemText.length() > 0) pieces.add(boundedText(itemText));
                if (pieces.size() > 16) throw new IOException("공유한 텍스트가 너무 깁니다.");
            }
            byte[] bytes = String.join("\n\n", pieces).getBytes(StandardCharsets.UTF_8);
            if (bytes.length > TEXT_LIMIT) throw new IOException("공유할 텍스트는 64 KB 이하여야 합니다.");
            return bytes;
        } catch (RuntimeException e) { throw new IOException("공유 텍스트를 읽지 못했습니다.", e); }
    }

    private static String boundedText(CharSequence value) throws IOException {
        if (value.length() > TEXT_LIMIT) throw new IOException("공유할 텍스트는 64 KB 이하여야 합니다.");
        return value.toString().trim();
    }

    private static String displayName(Context context, Uri uri, CancellationSignal cancellation) {
        try (Cursor cursor = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null, cancellation)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getString(0);
        } catch (OperationCanceledException cancelled) { throw cancelled;
        } catch (RuntimeException ignored) { /* A provider may omit display-name metadata. */ }
        return "공유파일";
    }

    private static String supportedName(String input, String mime) throws IOException {
        String name = input == null ? "공유파일" : input.replaceAll("[\\p{Cntrl}/\\\\]", "_").trim();
        while (name.startsWith(".")) name = name.substring(1);
        if (name.isEmpty()) name = "공유파일";
        String ext = extension(name);
        if (ext.isEmpty()) {
            String inferred = mime == null ? null : MimeTypeMap.getSingleton().getExtensionFromMimeType(mime.toLowerCase(Locale.ROOT));
            if (inferred == null || !EXTENSIONS.contains(inferred)) throw new IOException("지원하지 않는 파일 형식입니다.");
            name += "." + inferred;
            ext = inferred;
        }
        if (!EXTENSIONS.contains(ext)) throw new IOException("지원하지 않는 파일 형식입니다. 사진·영상·PDF·문서·텍스트 파일을 선택하세요.");
        String stem = name.substring(0, name.length() - ext.length() - 1);
        // Keep UTF-8 names comfortably below filesystem limits, preserving the extension.
        while (stem.getBytes(StandardCharsets.UTF_8).length > 160) stem = stem.substring(0, stem.offsetByCodePoints(stem.length(), -1));
        return (stem.isEmpty() ? "공유파일" : stem) + "." + ext;
    }

    private static File uniqueFile(File parent, String name) {
        File file = new File(parent, name);
        int dot = name.lastIndexOf('.');
        String stem = dot < 0 ? name : name.substring(0, dot), suffix = dot < 0 ? "" : name.substring(dot);
        for (int i = 2; file.exists(); i++) file = new File(parent, stem + " (" + i + ")" + suffix);
        return file;
    }

    private static long copy(Context context, Uri uri, File destination, long limit, CancellationSignal cancellation) throws IOException {
        if (limit <= 0) throw new IOException("공유한 파일의 합계는 150 MB 이하여야 합니다.");
        long bytes = 0;
        cancellation.throwIfCanceled();
        try (AssetFileDescriptor descriptor = context.getContentResolver().openAssetFileDescriptor(uri, "r", cancellation);
             InputStream in = descriptor == null ? null : descriptor.createInputStream();
             FileOutputStream out = new FileOutputStream(destination)) {
            if (in == null) throw new IOException("공유한 원본 파일을 열 수 없습니다.");
            cancellation.setOnCancelListener(() -> { try { in.close(); } catch (IOException ignored) {} });
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = in.read(buffer)) != -1) {
                cancellation.throwIfCanceled();
                if (Thread.currentThread().isInterrupted()) throw new IOException("파일 가져오기가 취소되었습니다.");
                bytes += count;
                if (bytes > limit) throw new IOException("일반 파일 25 MB, 영상 100 MB, 전체 150 MB 이내로 공유해 주세요.");
                out.write(buffer, 0, count);
            }
            if (bytes == 0) throw new IOException("내용이 없는 파일은 공유할 수 없습니다.");
            out.getFD().sync();
        } finally {
            cancellation.setOnCancelListener(null);
        }
        return bytes;
    }

    private static long createdAt(File directory) {
        try (FileInputStream in = new FileInputStream(new File(directory, CREATED))) {
            byte[] buffer = new byte[32];
            int count = in.read(buffer);
            if (count > 0) return Long.parseLong(new String(buffer, 0, count, StandardCharsets.US_ASCII));
        } catch (IOException | RuntimeException ignored) {}
        return 0;
    }

    private static boolean expired(File directory) {
        long created = createdAt(directory), now = System.currentTimeMillis();
        return created <= 0 || created > now + 60_000 || now - created >= EXPIRY_MILLIS;
    }

    private static void cleanup(File root) {
        File[] children = root.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (child.getName().startsWith(".pending-") && !ACTIVE.contains(child.getName())) erase(child);
            else if (validGroupId(child.getName()) && expired(child)) erase(child);
        }
    }

    private static boolean validGroupId(String id) {
        return id != null && id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    }

    private static boolean validFileName(String name) {
        return name != null && !name.isEmpty() && !name.startsWith(".")
                && !name.contains("/") && !name.contains("\\") && !name.matches("(?s).*[\\p{Cntrl}].*");
    }

    private static String extension(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static boolean inside(File file, File parent) throws IOException {
        return file.getCanonicalFile().getParentFile().equals(parent.getCanonicalFile());
    }

    private static boolean erase(File file) {
        boolean success = true;
        try {
            // Never follow a symlink while removing device-local staging data.
            if (file.isDirectory() && file.getCanonicalFile().equals(file.getAbsoluteFile())) {
                File[] children = file.listFiles();
                if (children != null) for (File child : children) success &= erase(child);
            }
        } catch (IOException e) {
            return false;
        }
        return (!file.exists() || file.delete()) && success;
    }

    private static void changed(Context context) {
        try {
            context.getContentResolver().notifyChange(
                    DocumentsContract.buildChildDocumentsUri(authority(context), ROOT_DOCUMENT_ID), null);
            context.getContentResolver().notifyChange(DocumentsContract.buildRootsUri(authority(context)), null);
        } catch (RuntimeException ignored) { /* A notification failure must not undo a committed local copy. */ }
    }
}
