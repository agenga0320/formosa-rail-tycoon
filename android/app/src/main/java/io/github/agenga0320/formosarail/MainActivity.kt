package io.github.agenga0320.formosarail

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : Activity() {
    private lateinit var web: WebView
    private var updateDialog: AlertDialog? = null

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
        web.loadUrl(GAME_URL)
    }

    override fun onPause() { super.onPause(); web.onPause() }
    override fun onResume() { super.onResume(); web.onResume(); checkForUpdate() }
    override fun onDestroy() { web.destroy(); super.onDestroy() }

    /** Blocks play while a newer release exists, so online opponents always run the same game code. */
    private fun checkForUpdate() {
        if (updateDialog?.isShowing == true) return
        val installed = packageManager.getPackageInfo(packageName, 0).versionName ?: return
        Thread {
            // Offline or GitHub unreachable: allow play, since online games need the network anyway.
            val latest = latestVersion()
            if (latest == null || !isNewer(latest, installed)) {
                // Back from an earlier block (e.g. now offline): bring the game back instead of a blank screen.
                runOnUiThread { if (!isDestroyed && web.url == "about:blank") web.loadUrl(GAME_URL) }
                return@Thread
            }
            runOnUiThread {
                if (isFinishing || isDestroyed || updateDialog?.isShowing == true) return@runOnUiThread
                web.loadUrl("about:blank") // stop the game, including any online room
                updateDialog = AlertDialog.Builder(this)
                    .setTitle("需要更新")
                    .setMessage("新版本 v$latest 已推出（目前 v$installed）。\n請下載並安裝新版後才能繼續遊玩。\n\n下載完成後，點通知或下載資料夾中的 APK 安裝。")
                    .setCancelable(false)
                    .setPositiveButton("下載更新") { _, _ ->
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl(latest))))
                    }
                    .setNegativeButton("離開") { _, _ -> finish() }
                    .show()
            }
        }.start()
    }

    private companion object {
        const val HOST = "appassets.androidplatform.net"
        const val GAME_URL = "https://$HOST/index.html"
        const val REPO = "agenga0320/formosa-rail-tycoon"

        /** Only this exact file of this repo's release is ever opened for download. */
        fun apkUrl(v: String) = "https://github.com/$REPO/releases/download/v$v/FormosaRailTycoon-v$v-release.apk"

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
                if (Regex("""\d+\.\d+\.\d+""").matches(v) && hasApk) v else null
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
