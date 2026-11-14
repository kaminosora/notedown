package io.github.kaminosora.notedown;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.OpenableColumns;
import android.util.AtomicFile;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final String TAG = "Notedown";
    private static final String APP_URL = "file:///android_asset/www/index.html";
    private static final int REQUEST_OPEN_FILES = 4711;
    private static final int MAX_FILES = 20;
    private static final long MAX_FILE_BYTES = 1536L * 1024L;
    private static final long MAX_TOTAL_BYTES = 6L * 1024L * 1024L;
    private static final long MAX_SAVED_DATA_BYTES = 12L * 1024L * 1024L;
    private static final int LIGHT_BACKGROUND = Color.rgb(244, 240, 231);
    private static final int DARK_BACKGROUND = Color.rgb(23, 22, 19);
    private static final int SAFE_TOP_EXTRA_DP = 10;

    private static final String BACK_SCRIPT =
            "(function(){try{return !!(window.Notedown&&window.Notedown.handleBack&&window.Notedown.handleBack());}catch(e){return false;}})()";

    private WebView webView;
    private FrameLayout rootLayout;
    private int safeTopExtraPx;
    private AtomicFile notesFile;
    private final ExecutorService ioExecutor = Executors.newSingleThreadExecutor();
    private boolean pageReady;
    private boolean filePickerOpen;
    private long lastBackRequestAt;
    private OnBackInvokedCallbackHolder backCallbackHolder;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();
        safeTopExtraPx = Math.round(
                SAFE_TOP_EXTRA_DP * getResources().getDisplayMetrics().density);
        createLayout();
        configureWebView();
        configureContentView();

        // The decor view does not exist until setContentView has run. Applying
        // system-bar appearance before that point crashes on some Android 15
        // builds (including MuMu), so wait until the root view is attached.
        rootLayout.post(() -> applyTheme(false));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backCallbackHolder = new OnBackInvokedCallbackHolder(this);
            backCallbackHolder.register(this::requestBack);
        }

        webView.loadUrl(APP_URL);
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
        } else {
            window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(LIGHT_BACKGROUND);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new NativeBridge(), "NotedownNative");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleNavigation(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleNavigation(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                rootLayout.requestApplyInsets();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                if (BuildConfig.DEBUG) {
                    Log.d(TAG, message.message() + " @" + message.sourceId() + ":" + message.lineNumber());
                }
                return true;
            }
        });
    }

    private void createLayout() {
        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(LIGHT_BACKGROUND);
        rootLayout.setOnApplyWindowInsetsListener((view, insets) -> applySafeArea(insets));
        notesFile = new AtomicFile(new java.io.File(getFilesDir(), "notes.json"));
        setContentView(rootLayout);
    }

    @Override
    protected void onDestroy() {
        if (backCallbackHolder != null) {
            backCallbackHolder.unregister();
            backCallbackHolder = null;
        }
        ioExecutor.shutdownNow();
        if (webView != null) {
            webView.removeJavascriptInterface("NotedownNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        requestBack();
    }

    private void requestBack() {
        long now = SystemClock.uptimeMillis();
        if (now - lastBackRequestAt < 280) {
            return;
        }
        lastBackRequestAt = now;

        if (webView == null || !pageReady) {
            finish();
            return;
        }
        webView.evaluateJavascript(BACK_SCRIPT, value -> {
            if (!"true".equals(value)) {
                finish();
            }
        });
    }

    private void configureContentView() {
        rootLayout.removeAllViews();
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        rootLayout.addView(webView, params);
        rootLayout.requestApplyInsets();
    }

    private boolean handleNavigation(Uri uri) {
        if (uri == null) {
            return true;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if ("file".equals(scheme) && uri.toString().startsWith("file:///android_asset/")) {
            return false;
        }
        if ("http".equals(scheme) || "https".equals(scheme) || "mailto".equals(scheme)) {
            openExternal(uri);
        }
        return true;
    }

    private void openExternal(Uri uri) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException exception) {
            toast("没有找到可以打开这个链接的应用");
        }
    }

    /**
     * Resize the WebView's actual bounds, rather than padding its contents:
     * fixed/sticky web controls and the editor's scroller must fit above IME.
     * Return zeroed handled insets so newer WebViews do not apply them again.
     * Keep dispatching an inset object when IME hides, avoiding stale padding.
     */
    @SuppressWarnings("deprecation")
    private WindowInsets applySafeArea(WindowInsets insets) {
        int left;
        int top;
        int right;
        int bottom;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.graphics.Insets safe = insets.getInsets(
                    WindowInsets.Type.systemBars()
                            | WindowInsets.Type.displayCutout()
                            | WindowInsets.Type.ime());
            left = safe.left;
            top = safe.top;
            right = safe.right;
            bottom = safe.bottom;
        } else {
            // On API 26-29 adjustResize supplies the keyboard obstruction via
            // the legacy system-window insets. Do not add it a second time.
            left = insets.getSystemWindowInsetLeft();
            top = insets.getSystemWindowInsetTop();
            right = insets.getSystemWindowInsetRight();
            bottom = insets.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    && insets.getDisplayCutout() != null) {
                left = Math.max(left, insets.getDisplayCutout().getSafeInsetLeft());
                top = Math.max(top, insets.getDisplayCutout().getSafeInsetTop());
                right = Math.max(right, insets.getDisplayCutout().getSafeInsetRight());
                bottom = Math.max(bottom, insets.getDisplayCutout().getSafeInsetBottom());
            }
        }

        int reservedTop = top + safeTopExtraPx;
        if (rootLayout.getPaddingLeft() != left
                || rootLayout.getPaddingTop() != reservedTop
                || rootLayout.getPaddingRight() != right
                || rootLayout.getPaddingBottom() != bottom) {
            rootLayout.setPadding(left, reservedTop, right, bottom);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return new WindowInsets.Builder(insets)
                    .setInsets(WindowInsets.Type.systemBars()
                                    | WindowInsets.Type.displayCutout()
                                    | WindowInsets.Type.ime(),
                            android.graphics.Insets.NONE)
                    .setInsetsIgnoringVisibility(WindowInsets.Type.systemBars()
                                    | WindowInsets.Type.displayCutout(),
                            android.graphics.Insets.NONE)
                    .setDisplayCutout(null)
                    .build();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return new WindowInsets.Builder(insets)
                    .setSystemWindowInsets(android.graphics.Insets.NONE)
                    .setStableInsets(android.graphics.Insets.NONE)
                    .setDisplayCutout(null)
                    .build();
        }
        WindowInsets remaining = new WindowInsets(insets)
                .replaceSystemWindowInsets(0, 0, 0, 0)
                .consumeStableInsets();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            remaining = remaining.consumeDisplayCutout();
        }
        return remaining;
    }

    private void setSystemBarAppearance(boolean dark) {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = null;
            try {
                // getDecorView() is intentionally used instead of
                // Window.getInsetsController(): several OEM/emulator builds
                // throw if the decor has not been installed yet.
                controller = window.getDecorView().getWindowInsetsController();
            } catch (RuntimeException exception) {
                Log.w(TAG, "System bar appearance is not available yet", exception);
            }
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        } else {
            int flags = window.getDecorView().getSystemUiVisibility();
            flags |= View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (dark) {
                flags &= ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            } else {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    private void applyTheme(boolean dark) {
        int background = dark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
        if (rootLayout != null) {
            rootLayout.setBackgroundColor(background);
        }
        if (webView != null) {
            webView.setBackgroundColor(background);
        }
        setSystemBarAppearance(dark);
    }

    private void toast(String message) {
        if (message == null) {
            return;
        }
        String safe = message.length() > 200 ? message.substring(0, 200) : message;
        Toast.makeText(this, safe, Toast.LENGTH_SHORT).show();
    }

    private void openFilePicker() {
        if (filePickerOpen) {
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "text/*",
                "application/xhtml+xml",
                "application/octet-stream"
        });
        try {
            filePickerOpen = true;
            startActivityForResult(intent, REQUEST_OPEN_FILES);
        } catch (ActivityNotFoundException exception) {
            filePickerOpen = false;
            toast("没有找到文件选择器");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_OPEN_FILES) {
            return;
        }
        filePickerOpen = false;

        if (resultCode != RESULT_OK || data == null) {
            deliverFiles("{\"files\":[],\"errors\":[],\"cancelled\":true}");
            return;
        }

        Set<Uri> uris = new LinkedHashSet<>();
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int index = 0; index < clipData.getItemCount(); index++) {
                Uri uri = clipData.getItemAt(index).getUri();
                if (uri != null) {
                    uris.add(uri);
                }
            }
        }
        Uri single = data.getData();
        if (single != null) {
            uris.add(single);
        }

        if (uris.isEmpty()) {
            deliverFiles("{\"files\":[],\"errors\":[],\"cancelled\":true}");
            return;
        }

        List<Uri> selected = new ArrayList<>(uris);
        ioExecutor.execute(() -> deliverFiles(readSelectedFiles(selected)));
    }

    private String readSelectedFiles(List<Uri> uris) {
        JSONArray files = new JSONArray();
        JSONArray errors = new JSONArray();
        long totalBytes = 0;
        int accepted = 0;

        for (Uri uri : uris) {
            if (accepted >= MAX_FILES) {
                errors.put("一次最多导入 " + MAX_FILES + " 个文件");
                break;
            }
            try {
                String name = queryDisplayName(uri);
                String mime = getContentResolver().getType(uri);
                String format = detectFormat(name, mime);
                if (format == null) {
                    errors.put(name + "：不支持的文件类型（仅支持 Markdown / HTML / 文本）");
                    continue;
                }
                byte[] bytes = readBytes(uri, MAX_FILE_BYTES);
                if (bytes == null) {
                    errors.put(name + "：文件超过 1.5 MB");
                    continue;
                }
                totalBytes += bytes.length;
                if (totalBytes > MAX_TOTAL_BYTES) {
                    errors.put("本次导入的文件总大小超过 6 MB");
                    break;
                }
                String text = decodeText(bytes);
                if (text == null) {
                    errors.put(name + "：无法识别文件编码");
                    continue;
                }
                // UTF-16 text routinely contains zero bytes. Reject actual
                // NUL characters only after BOM-aware decoding instead.
                if (text.indexOf('\0') >= 0) {
                    errors.put(name + "：看起来不是文本文件");
                    continue;
                }
                JSONObject file = new JSONObject();
                file.put("name", name);
                file.put("format", format);
                file.put("text", text);
                file.put("size", bytes.length);
                files.put(file);
                accepted++;
            } catch (FileNotFoundException exception) {
                errors.put("文件已不可访问：" + uri.getLastPathSegment());
            } catch (Exception exception) {
                Log.w(TAG, "Could not import " + uri, exception);
                errors.put("读取文件失败：" + safeName(uri));
            }
        }

        JSONObject payload = new JSONObject();
        try {
            payload.put("files", files);
            payload.put("errors", errors);
            payload.put("cancelled", false);
        } catch (JSONException ignored) {
            return "{\"files\":[],\"errors\":[\"读取文件失败\"]}";
        }
        return payload.toString();
    }

    private String queryDisplayName(Uri uri) {
        String name = null;
        try (Cursor cursor = getContentResolver().query(
                uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    name = cursor.getString(index);
                }
            }
        } catch (Exception ignored) {
            // Fall through to the URI segment.
        }
        if (name == null || name.trim().isEmpty()) {
            name = safeName(uri);
        }
        return name;
    }

    private String safeName(Uri uri) {
        String segment = uri.getLastPathSegment();
        if (segment == null || segment.trim().isEmpty()) {
            return "未命名文件";
        }
        int slash = Math.max(segment.lastIndexOf('/'), segment.lastIndexOf('\\'));
        return slash >= 0 ? segment.substring(slash + 1) : segment;
    }

    private String detectFormat(String name, String mime) {
        String extension = "";
        int dot = name.lastIndexOf('.');
        if (dot >= 0) {
            extension = name.substring(dot + 1).toLowerCase(Locale.ROOT);
        }
        switch (extension) {
            case "md":
            case "markdown":
            case "mdown":
            case "mkd":
                return "markdown";
            case "html":
            case "htm":
            case "xhtml":
                return "html";
            case "txt":
            case "text":
                return "text";
            default:
                break;
        }
        if (mime == null) {
            return null;
        }
        String normalized = mime.toLowerCase(Locale.ROOT);
        if (normalized.contains("markdown")) {
            return "markdown";
        }
        if (normalized.contains("html")) {
            return "html";
        }
        if (normalized.startsWith("text/")) {
            return "text";
        }
        return null;
    }

    private byte[] readBytes(Uri uri, long limit) throws IOException {
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            if (input == null) {
                throw new FileNotFoundException(uri.toString());
            }
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            long total = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > limit) {
                    return null;
                }
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private String decodeText(byte[] bytes) {
        if (bytes.length >= 3
                && (bytes[0] & 0xFF) == 0xEF
                && (bytes[1] & 0xFF) == 0xBB
                && (bytes[2] & 0xFF) == 0xBF) {
            return new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xFE) {
            return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16LE);
        }
        if (bytes.length >= 2 && (bytes[0] & 0xFF) == 0xFE && (bytes[1] & 0xFF) == 0xFF) {
            return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16BE);
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes))
                    .toString();
        } catch (CharacterCodingException ignored) {
            // Many Chinese note files still use the GB18030 family. It is a
            // safe superset fallback and does not modify the original file.
            try {
                return Charset.forName("GB18030").newDecoder()
                        .onMalformedInput(CodingErrorAction.REPLACE)
                        .onUnmappableCharacter(CodingErrorAction.REPLACE)
                        .decode(ByteBuffer.wrap(bytes))
                        .toString();
            } catch (CharacterCodingException impossible) {
                return null;
            }
        }
    }

    private void deliverFiles(String json) {
        if (webView == null) {
            return;
        }
        String script = "(function(){if(window.Notedown&&window.Notedown.onNativeFiles){"
                + "window.Notedown.onNativeFiles(" + JSONObject.quote(json) + ");}})()";
        webView.post(() -> {
            if (webView != null) {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private static final class OnBackInvokedCallbackHolder {
        private final Activity activity;
        private android.window.OnBackInvokedCallback callback;

        OnBackInvokedCallbackHolder(Activity activity) {
            this.activity = activity;
        }

        @TargetApi(Build.VERSION_CODES.TIRAMISU)
        void register(Runnable action) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                return;
            }
            callback = action::run;
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    callback);
        }

        @TargetApi(Build.VERSION_CODES.TIRAMISU)
        void unregister() {
            if (callback != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(callback);
            }
            callback = null;
        }
    }

    public final class NativeBridge {
        @JavascriptInterface
        public String loadData() {
            try {
                if (!notesFile.getBaseFile().exists()) {
                    return "";
                }
                byte[] bytes = notesFile.readFully();
                if (bytes.length > MAX_SAVED_DATA_BYTES) {
                    Log.w(TAG, "Saved data is unexpectedly large: " + bytes.length);
                    return "";
                }
                return new String(bytes, StandardCharsets.UTF_8);
            } catch (IOException exception) {
                Log.e(TAG, "Could not read notes", exception);
                return "";
            }
        }

        @JavascriptInterface
        public boolean saveData(String json) {
            if (json == null) {
                return false;
            }
            byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_SAVED_DATA_BYTES) {
                Log.w(TAG, "Refusing to save oversized note data: " + bytes.length);
                return false;
            }
            java.io.FileOutputStream stream = null;
            try {
                stream = notesFile.startWrite();
                stream.write(bytes);
                stream.flush();
                notesFile.finishWrite(stream);
                return true;
            } catch (IOException exception) {
                Log.e(TAG, "Could not save notes", exception);
                if (stream != null) {
                    notesFile.failWrite(stream);
                }
                return false;
            }
        }

        /**
         * Copy the last readable document to "notes.json.prev" once at startup.
         * AtomicFile already keeps a ".bak" copy only while a write is in
         * progress, so a rolling snapshot is what makes recovery possible after
         * a later corruption. This never replaces the live document.
         */
        @JavascriptInterface
        public void snapshotBackup() {
            java.io.File base = notesFile.getBaseFile();
            if (!base.isFile() || base.length() == 0 || base.length() > MAX_SAVED_DATA_BYTES) {
                return;
            }
            java.io.File target = new java.io.File(base.getPath() + ".prev");
            java.io.File temp = new java.io.File(base.getPath() + ".prev.tmp");
            try (java.io.FileInputStream input = new java.io.FileInputStream(base);
                 java.io.FileOutputStream output = new java.io.FileOutputStream(temp)) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                }
                output.flush();
                output.getFD().sync();
            } catch (IOException exception) {
                Log.w(TAG, "Could not snapshot the notes backup", exception);
                temp.delete();
                return;
            }
            if (!temp.renameTo(target)) {
                Log.w(TAG, "Could not replace the notes backup");
                temp.delete();
            }
        }

        /**
         * Recovery reads the startup snapshot, falling back to the copy that
         * AtomicFile leaves behind when a write is interrupted. It never writes.
         */
        @JavascriptInterface
        public String loadBackupData() {
            java.io.File backup = new java.io.File(notesFile.getBaseFile().getPath() + ".prev");
            if (!backup.isFile()) {
                backup = new java.io.File(notesFile.getBaseFile().getPath() + ".bak");
            }
            if (!backup.isFile()) {
                return "";
            }
            if (backup.length() > MAX_SAVED_DATA_BYTES) {
                Log.w(TAG, "Backup data is unexpectedly large: " + backup.length());
                return "";
            }
            try (java.io.FileInputStream input = new java.io.FileInputStream(backup)) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                }
                return new String(output.toByteArray(), StandardCharsets.UTF_8);
            } catch (IOException exception) {
                Log.e(TAG, "Could not read the automatic backup", exception);
                return "";
            }
        }

        @JavascriptInterface
        public void pickFiles() {
            runOnUiThread(MainActivity.this::openFilePicker);
        }

        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> toast(message));
        }

        @JavascriptInterface
        public void haptic() {
            try {
                Vibrator vibrator;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    VibratorManager manager = (VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE);
                    vibrator = manager == null ? null : manager.getDefaultVibrator();
                } else {
                    vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                }
                if (vibrator != null && vibrator.hasVibrator()) {
                    vibrator.vibrate(VibrationEffect.createOneShot(12, VibrationEffect.DEFAULT_AMPLITUDE));
                }
            } catch (Exception ignored) {
                // Haptics are an enhancement; never fail a note action for them.
            }
        }

        @JavascriptInterface
        public void setTheme(String theme) {
            boolean dark = "dark".equalsIgnoreCase(theme);
            runOnUiThread(() -> applyTheme(dark));
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (url == null) {
                return;
            }
            Uri uri;
            try {
                uri = Uri.parse(url);
            } catch (Exception ignored) {
                return;
            }
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!"http".equals(scheme) && !"https".equals(scheme) && !"mailto".equals(scheme)) {
                return;
            }
            runOnUiThread(() -> openExternal(uri));
        }

        @JavascriptInterface
        public String getVersionName() {
            return BuildConfig.VERSION_NAME;
        }
    }
}
