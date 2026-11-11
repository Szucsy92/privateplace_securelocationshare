package hu.privateplace.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class HintPlace { SHARE, TRANSPORT, ADDRESS, MARKER, RAIL, ASK }
data class Hint(val place: HintPlace, val text: String)

/** Kompakt, egymondatos súgóbuborékok (a régi, hosszabb szövegek rövidítve). */
val HINTS = listOf(
    Hint(HintPlace.SHARE, "Egy koppintás: megosztás be/ki. Leállítva kíméli az akkut."),
    Hint(HintPlace.TRANSPORT, "Közlekedési mód: magától vált, rábökve te is választhatsz."),
    Hint(HintPlace.ADDRESS, "Cím: csak a megnyitott jelölő helye megy a címkeresőhöz. A Beállításokban kapcsolható."),
    Hint(HintPlace.MARKER, "Koppints egy jelölőre: akku, cím, mióta áll."),
    Hint(HintPlace.RAIL, "Koppints egy személyre a követéshez. Ha nem oszt meg, innen kérheted."),
    Hint(HintPlace.ASK, "Megosztáskérésnél felül üzenet jön – a „Megosztás” gombbal azonnal bekapcsolod."),
)

/** Egy buborék, a célelem közelében; a szöveg és a méret lágyan (harmónikaszerűen) cserélődik. */
@Composable
fun BoxScope.HintBubble(step: Int, onNext: () -> Unit, onSkip: () -> Unit) {
    val hint = HINTS.getOrNull(step) ?: return
    val (align, pad) = when (hint.place) {
        HintPlace.SHARE, HintPlace.ASK -> Alignment.TopStart to PaddingValues(start = 12.dp, top = 84.dp)
        HintPlace.TRANSPORT -> Alignment.BottomStart to PaddingValues(start = 12.dp, bottom = 150.dp)
        HintPlace.ADDRESS -> Alignment.BottomCenter to PaddingValues(bottom = 132.dp)
        HintPlace.MARKER -> Alignment.Center to PaddingValues(0.dp)
        HintPlace.RAIL -> Alignment.BottomStart to PaddingValues(start = 12.dp, bottom = 96.dp)
    }
    Box(Modifier.align(align).systemBarsPadding().padding(pad).widthIn(max = 250.dp)) {
        AnimatedContent(step, transitionSpec = {
            (fadeIn(tween(ANIM_MS, delayMillis = 60)) togetherWith fadeOut(tween(120))).using(SizeTransform(clip = false) { _, _ -> tween(ANIM_MS, easing = AnimEasing) })
        }, label = "hint") { s ->
            val h = HINTS[s]
            Column(Modifier.glass(16).padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(h.text, fontSize = 12.sp, lineHeight = 16.sp)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    Text("Kihagyás", fontSize = 11.sp, color = Muted, modifier = Modifier.clickable(onClick = onSkip))
                    Text(if (s + 1 < HINTS.size) "Tovább ${s + 1}/${HINTS.size}" else "Értem", fontSize = 12.sp, color = Mint, modifier = Modifier.clickable(onClick = onNext))
                }
            }
        }
    }
}
