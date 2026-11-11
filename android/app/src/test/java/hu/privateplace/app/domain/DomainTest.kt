package hu.privateplace.app.domain

import hu.privateplace.app.p2p.Schnorr
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DomainTest {
    @Test fun roomTokenAndInputParsing() {
        val t = generateRoomToken()
        assertEquals(20, t.length)
        assertEquals(t, parseRoomInput(formatRoomToken(t.lowercase()))?.token)
        val auth = createRoomAuthority()
        val link = buildRoomLink("https://x.test", t, "Család", "rose", auth.ownerKey)
        val inv = parseRoomInput(link)!!
        assertEquals(t, inv.token); assertEquals("Család", inv.name); assertEquals("rose", inv.color); assertEquals(auth.ownerKey, inv.ownerKey)
        assertEquals(auth.ownerKey, parseRoomInput("$t.${auth.ownerKey}")?.ownerKey)
        assertNull(parseRoomInput("nem kód"))
    }

    @Test fun signedControlRoundTrip() {
        val auth = createRoomAuthority(); val t = generateRoomToken()
        val kick = signRoomControl(t, auth, "kick", "abcdef0123456789")
        assertTrue(verifyRoomControl(kick, auth.ownerKey))
        assertFalse(verifyRoomControl(kick.copy(target = "ffffffffffffffff"), auth.ownerKey))
        assertFalse(verifyRoomControl(kick, createRoomAuthority().ownerKey))
        val parsed = parseRoomControl(kick.toJson())!!
        assertTrue(verifyRoomControl(parsed, auth.ownerKey))
        val close = signRoomControl(t, auth, "close", null)
        assertTrue(verifyRoomControl(close, auth.ownerKey))
    }

    @Test fun locationValidation() {
        val now = 1_700_000_000_000L
        val ok = JSONObject().put("lat", 47.5).put("lng", 19.0).put("t", now).put("acc", 5).put("speed", 1.2)
        assertTrue(parseLocation(ok, now) is ParsedLoc.Ok)
        assertTrue(parseLocation(JSONObject.NULL, now) is ParsedLoc.Ok)
        assertEquals(ParsedLoc.Invalid, parseLocation(JSONObject(ok.toString()).put("lat", 91), now))
        assertEquals(ParsedLoc.Invalid, parseLocation(JSONObject(ok.toString()).put("t", now + 10 * 60_000), now))
    }

    @Test fun transportNeedsHold() {
        var s = TransportState(TransportMode.WALK, null, 0)
        s = updateTransport(s, 12.0, 1000); assertEquals(TransportMode.WALK, s.mode)
        s = updateTransport(s, 12.0, 9000); assertEquals(TransportMode.CAR, s.mode)
    }

    @Test fun trailKeepsLastAndTrims() {
        var pts = emptyList<TrackPoint>()
        for (i in 0 until 700) pts = appendTrackPoint(pts, TrackPoint(47.0 + i * 1e-5, 19.0, 1000L + i), 1000L + i)
        assertEquals(TRAIL_MAX_POINTS, pts.size)
    }

    @Test fun stationaryFixesDoNotDrift() {
        val f = DriftFilter(); val rnd = java.util.Random(7)
        var last: FilteredFix? = null; var t = 1_700_000_000_000L
        for (i in 0 until 120) {
            t += 1000
            last = f.filter(RawFix(47.5 + (rnd.nextGaussian() * 4) / 110540, 19.0 + (rnd.nextGaussian() * 4) / 75000, 8.0, 0.0, 0.3, null, t, "gps"))
        }
        assertEquals("still", last!!.mode)
    }

    @Test fun walkingFixesLeaveStill() {
        val f = DriftFilter(); var t = 1_700_000_000_000L; var lat = 47.5
        var last: FilteredFix? = null
        for (i in 0 until 40) { t += 1000; last = f.filter(RawFix(47.5, 19.0, 6.0, 0.0, 0.2, null, t, "gps")) }
        for (i in 0 until 25) { t += 1000; lat += 1.4 / 110540; last = f.filter(RawFix(lat, 19.0, 6.0, 1.4, 0.2, 0.0, t, "gps")) }
        assertEquals("moving", last!!.mode)
    }

    @Test fun schnorrBip340Vector0() {
        val sk = ByteArray(32).also { it[31] = 3 }
        val pk = Schnorr.publicKey(sk).joinToString("") { "%02X".format(it) }
        assertEquals("F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9", pk)
        val sig = Schnorr.sign(sk, ByteArray(32), ByteArray(32)).joinToString("") { "%02X".format(it) }
        assertEquals("E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0", sig)
    }

    @Test fun otaReleaseSelection() {
        val url = "https://github.com/o/r/releases/download/build-2026-11-11_1530-42/private-place-2026-11-11_1530.apk"
        val rel = JSONObject("""{"tag_name":"build-2026-11-11_1530-42","assets":[
            {"name":"private-place-2026-11-11_1530.ipa","browser_download_url":"https://github.com/o/r/releases/download/build-2026-11-11_1530-42/private-place-2026-11-11_1530.ipa"},
            {"name":"private-place-2026-11-11_1530.apk","browser_download_url":"$url"}]}""")
        val r = pickRelease(rel)!!
        assertEquals(42L, r.versionCode); assertEquals(url, r.apk)
        assertTrue(needsUpdate(41, r.versionCode)); assertFalse(needsUpdate(42, r.versionCode))
        assertNull(pickRelease(JSONObject("""{"tag_name":"latest","assets":[]}""")))
        assertFalse(validApkUrl("http://github.com/o/r/releases/download/t/a.apk"))
        assertFalse(validApkUrl("https://evil.example/o/r/releases/download/t/a.apk"))
        assertTrue(validRepository("o/r")); assertFalse(validRepository("o/r/x"))
    }
}
