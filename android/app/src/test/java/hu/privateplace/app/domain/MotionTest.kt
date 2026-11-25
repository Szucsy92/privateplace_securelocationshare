package hu.privateplace.app.domain

import org.junit.Assert.*
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

class MotionTest {
    @Test fun stillnessDetectedOnMotionlessPhone() {
        var state: Boolean? = null
        val d = StillnessDetector { state = it }
        var t = 0L
        repeat(200) { d.onSample(t, 0.02, 0.03, 9.81 + (if (it % 2 == 0) 0.01 else -0.01)); t += 50 }
        assertEquals(true, state)
        // erős rázkódás: újra mozgásban
        repeat(60) { d.onSample(t, 0.0, 0.0, 9.81 + 3 * sin(it * PI / 3)); t += 50 }
        assertEquals(false, state)
    }

    @Test fun stepWindowExpires() {
        val w = StepWindow(2500)
        assertFalse(w.active(1000))
        w.hit(1000)
        assertTrue(w.active(3000)); assertFalse(w.active(4000))
    }

    @Test fun fingerprintSimilarity() {
        assertEquals(1.0, fingerprintSimilarity(emptySet(), emptySet()), 0.0)
        assertEquals(1.0, fingerprintSimilarity(setOf("a", "b"), setOf("a", "b")), 0.0)
        assertEquals(0.0, fingerprintSimilarity(setOf("a", "b"), setOf("c", "d")), 0.0)
        assertEquals(1.0 / 3, fingerprintSimilarity(setOf("a", "b"), setOf("b", "c")), 1e-9)
    }

    @Test fun environmentNeedsTwoChannels() {
        var moved = 0
        val e = EnvironmentTracker({ moved++ })
        e.observe(EnvironmentTracker.WIFI, setOf("a", "b", "c"), 0)
        e.observe(EnvironmentTracker.CELL, setOf("x"), 0, 1)
        e.observe(EnvironmentTracker.WIFI, setOf("d", "e", "f"), 10_000)   // csak a Wi-Fi változott
        assertEquals(0, moved)
        e.observe(EnvironmentTracker.CELL, setOf("y"), 20_000, 1)          // a cella is: elmozdulás
        assertEquals(1, moved)
        // régi változás lejár
        e.observe(EnvironmentTracker.WIFI, setOf("g", "h", "i"), 200_000)
        assertEquals(1, moved)
    }

    @Test fun walkingDetectorRecognisesStepCadence() {
        var walking = false
        val d = WalkingDetector { walking = it }
        var t = 0L
        repeat(120) { d.onSample(t, 0.0, 0.0, 9.81 + 2.0 * sin(2 * PI * 2.0 * t / 1000.0)); t += 20 }
        assertTrue(walking)
    }
}
