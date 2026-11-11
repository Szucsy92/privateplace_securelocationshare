package hu.privateplace.app.domain

import org.json.JSONObject
import java.net.URI

/** OTA: a kiadások helye a GitHub Releases; a címke a futás sorszámával végződik (build-2026-11-11_1530-42): ez a versionCode. */
data class AppRelease(val versionCode: Long, val version: String, val apk: String)

private val REPO_RE = Regex("^[\\w.-]{1,100}/[\\w.-]{1,100}$")
private val APK_PATH = Regex("/releases/download/[^/]+/[\\w.-]+\\.apk$")

fun validRepository(r: String?) = r != null && REPO_RE.matches(r)
fun needsUpdate(installed: Long, latest: Long) = latest > installed

fun validApkUrl(v: String?): Boolean = runCatching {
    val u = URI(v ?: return false)
    u.scheme == "https" && u.host == "github.com" && APK_PATH.containsMatchIn(u.path)
}.getOrDefault(false)

fun buildFromTag(tag: String): Long? = Regex("-(\\d+)$").find(tag)?.groupValues?.get(1)?.toLongOrNull()

/** A kiadásból a letölthető APK és a build száma; null, ha nincs APK vagy nem olvasható a címke. */
fun pickRelease(data: JSONObject): AppRelease? {
    val build = buildFromTag(data.optString("tag_name")) ?: return null
    val assets = data.optJSONArray("assets") ?: return null
    val list = (0 until assets.length()).map { assets.getJSONObject(it) }
    val apk = list.firstOrNull { it.optString("name") == "private-place-latest.apk" } ?: list.firstOrNull { it.optString("name").endsWith(".apk") } ?: return null
    val url = apk.optString("browser_download_url")
    if (!validApkUrl(url)) return null
    return AppRelease(build, "#$build", url)
}
