package io.github.agenga0320.formosarail

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true // save game lives in localStorage
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.webViewClient = object : WebViewClient() {
            // Serve the bundled game from an https origin so WebRTC/PeerJS and localStorage behave as on the web.
            override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
                if (req.url.host != HOST) return null
                val path = req.url.path.orEmpty().trimStart('/').ifEmpty { "index.html" }
                val mime = when (path.substringAfterLast('.')) {
                    "html" -> "text/html"
                    "css" -> "text/css"
                    "js" -> "application/javascript"
                    else -> "application/octet-stream"
                }
                return try {
                    WebResourceResponse(mime, "utf-8", assets.open(path))
                } catch (e: java.io.IOException) {
                    WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null)
                }
            }
        }
        setContentView(web)
        web.loadUrl("https://$HOST/index.html")
    }

    override fun onPause() { super.onPause(); web.onPause() }
    override fun onResume() { super.onResume(); web.onResume() }
    override fun onDestroy() { web.destroy(); super.onDestroy() }

    private companion object {
        const val HOST = "appassets.androidplatform.net"
    }
}
