package hu.privateplace.app.domain

enum class HeadingSource { GPS, COMPASS }
data class HeadingState(val source: HeadingSource, val angle: Double?)

/** Hibrid irány: gyorsan (>1,4 m/s) GPS-irány, lassan (<0,8 m/s) iránytű; EMA 0,2. */
fun hybridHeading(previous: HeadingState, speed: Double?, gps: Double?, compass: Double?): HeadingState {
    val source = if (speed != null && speed > 1.4) HeadingSource.GPS
    else if (speed != null && speed < 0.8) HeadingSource.COMPASS else previous.source
    val target = if (source == HeadingSource.GPS) gps else compass
    if (target == null || !target.isFinite()) return HeadingState(source, previous.angle)
    val angle = if (previous.angle == null) target else smoothAngle(previous.angle, target, 0.2)
    return HeadingState(source, ((angle % 360) + 360) % 360)
}
