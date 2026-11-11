package hu.privateplace.app.domain

data class TrackPoint(val lat: Double, val lng: Double, val t: Long)

const val TRAIL_WINDOW_MS = 30L * 60 * 1000
const val TRAIL_MAX_POINTS = 600
const val PUBLISH_INTERVAL_MS = 1000L
const val HIDDEN_PUBLISH_INTERVAL_MS = 2000L
const val STILL_PUBLISH_INTERVAL_MS = 4000L

fun publishIntervalMs(visible: Boolean, still: Boolean): Long =
    if (still) STILL_PUBLISH_INTERVAL_MS else if (visible) PUBLISH_INTERVAL_MS else HIDDEN_PUBLISH_INTERVAL_MS

fun shouldPublishLocation(sharing: Boolean, now: Long, lastSent: Long, intervalMs: Long = PUBLISH_INTERVAL_MS) =
    sharing && now - lastSent >= intervalMs

/** Új pont a nyomvonalhoz; azonos koordinátánál csak az időbélyeg frissül. */
fun appendTrackPoint(points: List<TrackPoint>, point: TrackPoint, now: Long): List<TrackPoint> {
    val last = points.lastOrNull()
    val next = when {
        last != null && point.t < last.t -> points
        last != null && last.lat == point.lat && last.lng == point.lng -> points.dropLast(1) + point
        else -> points + point
    }
    val cutoff = now - TRAIL_WINDOW_MS
    val trimmed = next.filterIndexed { i, p -> p.t >= cutoff || i == next.size - 1 }
    return if (trimmed.size > TRAIL_MAX_POINTS) trimmed.takeLast(TRAIL_MAX_POINTS) else trimmed
}

fun clearTrackHistory(points: List<TrackPoint>): List<TrackPoint> = points.takeLast(1)
