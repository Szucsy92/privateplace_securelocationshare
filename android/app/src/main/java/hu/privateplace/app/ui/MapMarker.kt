package hu.privateplace.app.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp

private val PulseEase = CubicBezierEasing(0f, 0f, .58f, 1f)

/**
 * Térképjelölő (a webes `.map-avatar`): 48 dp-s kör 3 dp-s személyszínű kerettel, profilképpel,
 * a saját jelölőn pulzáló gyűrűvel, mozgásirány esetén irányjelző nyíllal.
 *
 * Compose-rétegként él a térkép fölött (nem GL-szimbólum), ezért:
 *  - ugyanabban a képkockában mozog a kamerával, nem vibrál és nem késik zoomnál;
 *  - a kép színe nem változik (nincs GL-es újramintázás / előszorzott alfa).
 * A pozíciót és a forgatást csak a graphicsLayer/rajzolás olvassa, így mozgás közben nincs rekomponálás.
 */
@Composable
internal fun MapMarker(p: MapPerson, s: MState, onClick: () -> Unit) {
    val pl = pal
    val bmp = remember(p.avatar) { decodeDataUrl(p.avatar) }
    val color = remember(p.color) { parseColor(p.color) }
    Box(Modifier.size(74.dp).graphicsLayer {
        // 74 dp = 48 dp jelölő + 13 dp mindkét oldalon (a webes .heading-arrow inset: -13px)
        translationX = s.sx - size.width / 2f
        translationY = s.sy - size.height / 2f
        alpha = if (s.sx <= HIDDEN + 1f) 0f else 1f
    }) {
        // Irányjelző nyíl (a jelölő közepe körül forog)
        Box(Modifier.fillMaxSize().graphicsLayer { rotationZ = if (s.rot.isNaN()) 0f else s.rot; alpha = if (s.rot.isNaN()) 0f else 1f }
            .drawBehind {
                val w = 5.dp.toPx(); val h = 9.dp.toPx(); val cx = size.width / 2f
                drawPath(Path().apply { moveTo(cx, 0f); lineTo(cx + w, h); lineTo(cx - w, h); close() }, color)
            })
        // Saját jelölő: pulzáló gyűrű (avatar-pulse, 2,2 mp; 0 → 14 px, 50% → 0% átlátszóság a ciklus 70%-áig)
        if (p.isSelf) {
            val t = rememberInfiniteTransition(label = "self-pulse")
            val k by t.animateFloat(0f, 1f, infiniteRepeatable(tween(2200, easing = LinearEasing), RepeatMode.Restart), label = "k")
            Box(Modifier.fillMaxSize().drawBehind {
                val e = PulseEase.transform((k / .7f).coerceAtMost(1f))
                val spread = 14.dp.toPx() * e
                if (spread > .5f) drawCircle(SignalGreen.copy(alpha = .5f * (1f - e)), radius = 24.dp.toPx() + spread / 2f, style = Stroke(spread))
            })
        }
        // Maga a jelölő
        Box(Modifier.align(Alignment.Center).size(48.dp)
            .drawBehind { drawCircle(pl.tint.copy(alpha = .12f), radius = size.minDimension / 2f + 0.5.dp.toPx(), style = Stroke(1.dp.toPx())) }
            .shadow(9.dp, CircleShape, ambientColor = pl.shade.copy(alpha = .6f), spotColor = pl.shade.copy(alpha = .6f))
            .clip(CircleShape).background(pl.glassStrong, CircleShape).border(3.dp, color, CircleShape)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onClick)
            .padding(6.dp),
            contentAlignment = Alignment.Center) {
            if (bmp != null) androidx.compose.foundation.Image(bmp.asImageBitmap(), null, Modifier.fillMaxSize().clip(CircleShape), contentScale = ContentScale.Crop)
            else Txt((p.name.ifBlank { "?" }).take(1).uppercase(), size = 18.4f, weight = 600)
        }
    }
}
