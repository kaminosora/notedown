# JavaScript bridge methods are referenced by name from the WebView.
-keepclassmembers class io.github.kaminosora.notedown.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
