package hu.privateplace.app.ui

import androidx.compose.animation.*
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

const val ANIM_MS = 240      // minden harmonika/fül ugyanazzal az ütemmel mozog (mint a webes useSmoothHeight: 240 ms)
val AnimEasing = FastOutSlowInEasing

/** Dinamikusan illeszkedő harmónika: a fejléc koppintásra a tartalom a saját magasságához igazodva nyílik/záródik, a szülő ablak vele együtt nő/zsugorodik. */
@Composable
fun Accordion(
    title: String, expanded: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier,
    subtitle: String? = null, leading: (@Composable () -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth().animateContentSize(tween(ANIM_MS, easing = AnimEasing)).glass(20)) {
        Row(Modifier.fillMaxWidth().clickable(onClick = onToggle).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            leading?.let { it(); Spacer(Modifier.width(10.dp)) }
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                if (subtitle != null) Text(subtitle, fontSize = 11.sp, color = Muted, maxLines = 1)
            }
            val rot by animateFloatAsState(if (expanded) 180f else 0f, tween(ANIM_MS, easing = AnimEasing), label = "chevron")
            Icon(Icons.Default.ExpandMore, null, Modifier.rotate(rot), tint = Muted)
        }
        AnimatedVisibility(expanded, enter = expandVertically(tween(ANIM_MS, easing = AnimEasing)) + fadeIn(tween(ANIM_MS)),
            exit = shrinkVertically(tween(ANIM_MS, easing = AnimEasing)) + fadeOut(tween(160))) {
            Column(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
        }
    }
}

/** Egyszerre egy szakasz nyitott (a többi automatikusan összecsukódik). */
@Composable
fun rememberOpenSection(initial: String? = null) = remember { mutableStateOf(initial) }

/** Ablak (alsó lap) keret: a tartalom méretváltozását (harmónika, fülváltás) a lap magassága lágyan követi. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SheetFrame(title: String? = null, onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismissRequest = onClose, containerColor = androidx.compose.ui.graphics.Color(0xFF0F1A2E), sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().animateContentSize(tween(ANIM_MS, easing = AnimEasing)).verticalScroll(rememberScrollState())
            .padding(horizontal = 16.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (title != null) Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            content()
        }
    }
}

/** Fülváltás: az új fül tartalma átúszik, a magasság lágyan igazodik. */
@Composable
fun <T> TabContent(state: T, content: @Composable (T) -> Unit) {
    AnimatedContent(state, transitionSpec = {
        (fadeIn(tween(ANIM_MS, delayMillis = 60)) togetherWith fadeOut(tween(120))).using(SizeTransform(clip = false) { _, _ -> tween(ANIM_MS, easing = AnimEasing) })
    }, label = "tab") { content(it) }
}
