package hu.privateplace.app.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import hu.privateplace.app.domain.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

enum class InstallState { INSTALLING, NEEDS_PERMISSION, FAILED }

/** OTA-frissítő: legújabb kiadás a GitHubról (saját szerver nélkül), letöltés, telepítés a rendszer telepítőjével. */
class Updater(private val ctx: Context) {
    fun installedVersionCode(): Long = runCatching {
        val i = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
        if (Build.VERSION.SDK_INT >= 28) i.longVersionCode else @Suppress("DEPRECATION") i.versionCode.toLong()
    }.getOrDefault(0L)

    fun installedVersionName(): String = runCatching { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "" }.getOrDefault("")

    /** Hiba esetén kivételt dob (a hívó dönti el, jelezze-e). */
    suspend fun latest(repo: String): AppRelease? = withContext(Dispatchers.IO) {
        if (!validRepository(repo)) return@withContext null
        val c = URL("https://api.github.com/repos/$repo/releases/latest").openConnection() as HttpURLConnection
        c.setRequestProperty("Accept", "application/vnd.github+json"); c.useCaches = false; c.connectTimeout = 10_000; c.readTimeout = 10_000
        if (c.responseCode != 200) throw java.io.IOException("status ${c.responseCode}")
        pickRelease(JSONObject(c.inputStream.bufferedReader().readText()))
    }

    suspend fun downloadAndInstall(url: String, onProgress: (Int?) -> Unit): InstallState = withContext(Dispatchers.IO) {
        if (!validApkUrl(url)) return@withContext InstallState.FAILED
        if (Build.VERSION.SDK_INT >= 26 && !ctx.packageManager.canRequestPackageInstalls()) {
            // Ismeretlen forrásból való telepítés engedélyezése: a rendszer beállításai nyílnak meg, utána újra a Letöltésre kell koppintani
            ctx.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${ctx.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return@withContext InstallState.NEEDS_PERMISSION
        }
        runCatching {
            val dir = File(ctx.cacheDir, "updates").apply { deleteRecursively(); mkdirs() }
            val apk = File(dir, "private-place-update.apk")
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = 15_000; c.readTimeout = 30_000
            if (c.responseCode != 200) error("status ${c.responseCode}")
            val total = c.contentLengthLong
            var done = 0L; var lastPct = -1
            c.inputStream.use { inp -> apk.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = inp.read(buf); if (n < 0) break
                    out.write(buf, 0, n); done += n
                    val pct = if (total > 0) (done * 100 / total).toInt() else null
                    if (pct != lastPct) { lastPct = pct ?: -1; onProgress(pct) }
                }
            } }
            if (apk.length() < 1_000_000) error("túl kicsi fájl")   // hibaoldal vagy csonka letöltés ne jusson a telepítőhöz
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.updates", apk)
            ctx.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
            InstallState.INSTALLING
        }.getOrDefault(InstallState.FAILED)
    }

    /** Tartalék: a böngésző veszi át a letöltést. */
    fun openInBrowser(url: String) = ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}
