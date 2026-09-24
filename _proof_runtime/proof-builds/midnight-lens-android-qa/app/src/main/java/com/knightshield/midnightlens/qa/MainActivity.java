package com.knightshield.midnightlens.qa;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.util.Arrays;

public final class MainActivity extends Activity {
    private static final String BASE_URL = "https://midnight-lens.com/";
    private static final String ALLOWED_HOST = "midnight-lens.com";
    private static final int FILE_CHOOSER_REQUEST = 4102;
    private static final int CAMERA_PERMISSION_REQUEST = 4103;

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileChooser;
    private PermissionRequest pendingCameraPermission;
    private OnBackInvokedCallback backInvokedCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setSaveFormData(true);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (request == null || !isAllowed(request.getOrigin())) {
                    if (request != null) request.deny();
                    return;
                }

                boolean requestsVideo = Arrays.asList(request.getResources())
                        .contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
                if (!requestsVideo || request.getResources().length != 1) {
                    request.deny();
                    return;
                }

                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    return;
                }

                if (pendingCameraPermission != null) {
                    pendingCameraPermission.deny();
                }
                pendingCameraPermission = request;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingCameraPermission == request) {
                    pendingCameraPermission = null;
                }
                super.onPermissionRequestCanceled(request);
            }

            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams fileChooserParams) {
                if (pendingFileChooser != null) {
                    pendingFileChooser.onReceiveValue(null);
                }
                pendingFileChooser = callback;
                try {
                    Intent intent = fileChooserParams != null
                            ? fileChooserParams.createIntent()
                            : new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*");
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception ignored) {
                    pendingFileChooser = null;
                    return false;
                }
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isAllowed(uri)) {
                    return false;
                }
                if (request.isForMainFrame()) {
                    openExternal(uri);
                    return true;
                }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) {
                    showUnavailable();
                }
            }
        });

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            backInvokedCallback = this::handleBackNavigation;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    backInvokedCallback);
        }

        Uri incoming = getIntent() != null ? getIntent().getData() : null;
        webView.loadUrl(isAllowed(incoming) ? incoming.toString() : BASE_URL);
    }

    private boolean isAllowed(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) {
            return false;
        }
        String host = uri.getHost();
        return host != null && (ALLOWED_HOST.equalsIgnoreCase(host)
                || ("www." + ALLOWED_HOST).equalsIgnoreCase(host));
    }

    private void openExternal(Uri uri) {
        if (uri == null) {
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
            showUnavailable();
        }
    }

    private void showUnavailable() {
        if (webView == null) {
            return;
        }
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>body{margin:0;background:#111113;color:#f2f4f7;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;padding:28px;box-sizing:border-box}"
                + ".c{max-width:420px;text-align:center}h1{font-size:26px}p{color:#b8bec8;line-height:1.5}button{margin-top:16px;border:0;border-radius:14px;padding:14px 20px;font-weight:700}</style></head>"
                + "<body><div class='c'><h1>Midnight Lens is temporarily unavailable.</h1><p>No proof or disclosure action was sent. Check your connection and try again.</p>"
                + "<button onclick=\"location.href='" + BASE_URL + "'\">Try again</button></div></body></html>";
        webView.loadDataWithBaseURL(BASE_URL, html, "text/html", "UTF-8", null);
    }

    private void handleBackNavigation() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        finish();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU && keyCode == KeyEvent.KEYCODE_BACK) {
            handleBackNavigation();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri uri = intent != null ? intent.getData() : null;
        webView.loadUrl(isAllowed(uri) ? uri.toString() : BASE_URL);
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || pendingFileChooser == null) {
            return;
        }
        Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        pendingFileChooser.onReceiveValue(result);
        pendingFileChooser = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST || pendingCameraPermission == null) {
            return;
        }
        PermissionRequest request = pendingCameraPermission;
        pendingCameraPermission = null;
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (granted && isAllowed(request.getOrigin())) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            request.deny();
        }
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backInvokedCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backInvokedCallback);
            backInvokedCallback = null;
        }
        if (pendingCameraPermission != null) {
            pendingCameraPermission.deny();
            pendingCameraPermission = null;
        }
        if (pendingFileChooser != null) {
            pendingFileChooser.onReceiveValue(null);
            pendingFileChooser = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
