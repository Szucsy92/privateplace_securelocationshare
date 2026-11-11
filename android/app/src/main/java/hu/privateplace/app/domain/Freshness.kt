package hu.privateplace.app.domain

const val LOCATION_FRESH_MS = 15000L

/** Az ismételt küldés az eredeti mérési időt őrzi; elavult mérést sosem álcázunk frissnek. */
fun freshLocation(m: LocationMessage?, now: Long): LocationMessage? =
    if (m != null && now - m.t <= LOCATION_FRESH_MS && m.t <= now + 60000) m else null

/**
 * Mit küldjünk újonnan csatlakozónak: Absent = ne küldjünk semmit (a megosztás be van kapcsolva, de a mérés elavult),
 * Send(null) = „a megosztás leállt”, Send(msg) = friss mérés.
 */
sealed class Announcement { object Absent : Announcement(); data class Send(val msg: LocationMessage?) : Announcement() }

fun announcement(latest: LocationMessage?, now: Long): Announcement {
    if (latest == null) return Announcement.Send(null)
    val f = freshLocation(latest, now) ?: return Announcement.Absent
    return Announcement.Send(f)
}

fun acceptMeasurement(previous: Long?, m: LocationMessage): Boolean = previous == null || m.t > previous
