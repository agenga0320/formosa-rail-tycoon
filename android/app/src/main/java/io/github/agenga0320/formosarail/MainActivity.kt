package io.github.agenga0320.formosarail

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    private lateinit var web: WebView
    private val handler = Handler(Looper.getMainLooper())
    private var downloadId = -1L
    private var installAfterPermission = false

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true // save game lives in localStorage
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.addJavascriptInterface(Bridge(), "AndroidApp")
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
        web.loadUrl(GAME_URL)
    }

    override fun onPause() { super.onPause(); web.onPause() }
    override fun onResume() {
        super.onResume()
        web.onResume()
        if (installAfterPermission && packageManager.canRequestPackageInstalls()) {
            installAfterPermission = false
            install()
        }
        checkForUpdate()
    }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); web.destroy(); super.onDestroy() }

    /** Called from the game's update screen (js/game.js showAppUpdate). */
    inner class Bridge {
        @JavascriptInterface fun version() = installedVersion()
        @JavascriptInterface fun download(v: String) = runOnUiThread { startDownload(v) }
        @JavascriptInterface fun install() = runOnUiThread { this@MainActivity.install() }
        @JavascriptInterface fun allowInstall() = runOnUiThread {
            installAfterPermission = true
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
        }
        @JavascriptInterface fun quit() = runOnUiThread { finish() }
    }

    private fun installedVersion() = packageManager.getPackageInfo(packageName, 0).versionName.orEmpty()
    private fun js(code: String) = web.evaluateJavascript("window.appUpdate && appUpdate.$code", null)
    private val updating get() = web.url.orEmpty().contains("?update=")

    /** Blocks play while a newer release exists, so online opponents always run the same game code. */
    private fun checkForUpdate() {
        if (updating) return
        val installed = installedVersion()
        Thread {
            // Offline or GitHub unreachable: allow play, since online games need the network anyway.
            val latest = latestVersion() ?: return@Thread
            if (!isNewer(latest, installed)) return@Thread
            runOnUiThread {
                // Reloading also stops any game or online room in progress.
                if (!isDestroyed && !updating) web.loadUrl("$GAME_URL?update=$latest")
            }
        }.start()
    }

    private fun startDownload(v: String) {
        if (!VERSION.matches(v)) return
        val dm = getSystemService(DownloadManager::class.java)
        if (downloadId >= 0) dm.remove(downloadId)
        val name = apkName(v)
        downloadId = dm.enqueue(
            DownloadManager.Request(Uri.parse(apkUrl(v)))
                .setTitle(name)
                .setMimeType(MIME)
                .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "${System.currentTimeMillis()}-$name")
        )
        handler.removeCallbacks(poll)
        handler.post(poll)
    }

    /** Reports download progress to the game's update screen every half second until it ends. */
    private val poll = object : Runnable {
        override fun run() {
            val dm = getSystemService(DownloadManager::class.java)
            var status = -1
            var done = 0L
            var total = -1L
            dm.query(DownloadManager.Query().setFilterById(downloadId))?.use {
                if (it.moveToFirst()) {
                    status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    done = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                }
            }
            when (status) {
                DownloadManager.STATUS_SUCCESSFUL -> { js("ready()"); install() }
                DownloadManager.STATUS_FAILED, -1 -> js("failed()")
                else -> {
                    js("progress(${if (total > 0) done * 100 / total else -1})")
                    handler.postDelayed(this, 500)
                }
            }
        }
    }

    private fun install() {
        if (!packageManager.canRequestPackageInstalls()) { js("permission()"); return }
        val uri = getSystemService(DownloadManager::class.java).getUriForDownloadedFile(downloadId)
        if (uri == null) { js("failed()"); return }
        try {
            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, MIME).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        } catch (e: RuntimeException) {
            js("failed()")
        }
    }

    private companion object {
        const val HOST = "appassets.androidplatform.net"
        const val GAME_URL = "https://$HOST/index.html"
        const val REPO = "agenga0320/formosa-rail-tycoon"
        const val MIME = "application/vnd.android.package-archive"
        val VERSION = Regex("""\d+\.\d+\.\d+""")

        fun apkName(v: String) = "FormosaRailTycoon-v$v-release.apk"

        /** Only this exact file of this repo's release is ever downloaded. */
        fun apkUrl(v: String) = "https://github.com/$REPO/releases/download/v$v/${apkName(v)}"

        /** Latest release version, or null when it can't be determined. Blocks. */
        fun latestVersion(): String? = runCatching {
            val c = URL("https://api.github.com/repos/$REPO/releases/latest").openConnection() as HttpURLConnection
            c.connectTimeout = 8000
            c.readTimeout = 8000
            c.setRequestProperty("Accept", "application/vnd.github+json")
            try {
                if (c.responseCode != HttpURLConnection.HTTP_OK) return@runCatching null
                val release = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                val v = release.getString("tag_name").trimStart('v', 'V')
                val assets = release.getJSONArray("assets")
                val hasApk = (0 until assets.length()).any {
                    assets.getJSONObject(it).optString("browser_download_url") == apkUrl(v)
                }
                // A release without its APK can't be installed, so it must not lock players out.
                if (VERSION.matches(v) && hasApk) v else null
            } finally {
                c.disconnect()
            }
        }.getOrNull()

        fun isNewer(remote: String, local: String): Boolean {
            val a = remote.split('.').map { it.toIntOrNull() ?: 0 }
            val b = local.split('.').map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(a.size, b.size)) {
                val x = a.getOrElse(i) { 0 }
                val y = b.getOrElse(i) { 0 }
                if (x != y) return x > y
            }
            return false
        }
    }
}
