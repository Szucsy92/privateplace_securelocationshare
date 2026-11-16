package hu.privateplace.app.ui

import android.graphics.BlurMaskFilter
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.*
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** A térképablak belső árnyéka (iOS: InnerGlow; web: inset 0 0 28px 4px). */
fun Modifier.innerGlow(color: Color, radius: Dp = 28.dp, stroke: Dp = 32.dp, blur: Dp = 14.dp): Modifier = this.drawWithContent {
    drawContent()
    val r = radius.toPx()
    val path = Path().apply { addRoundRect(RoundRect(0f, 0f, size.width, size.height, CornerRadius(r))) }
    clipPath(path) {
        drawIntoCanvas { c ->
            val p = android.graphics.Paint().apply {
                isAntiAlias = true
                style = android.graphics.Paint.Style.STROKE
                strokeWidth = stroke.toPx()
                this.color = color.toArgb()
                maskFilter = BlurMaskFilter(blur.toPx(), BlurMaskFilter.Blur.NORMAL)
            }
            c.nativeCanvas.drawRoundRect(0f, 0f, size.width, size.height, r, r, p)
        }
    }
}

/** Fejléc-gomb (Szobák / Beállítások), jelvénnyel. iOS: HeaderButton. */
@Composable
fun HeaderButton(
    icon: String, on: Boolean, badge: Int, narrow: Boolean, onClick: () -> Unit,
    landscape: Boolean = false, modifier: Modifier = Modifier,
) {
    val base = if (landscape) modifier.height(44.dp).glass(shape = CircleShape).indicator(on)
    else modifier.indicator(on)
    Box(base.clip(CircleShape).clickable(onClick = onClick)
        .then(if (landscape) Modifier else Modifier.size(width = if (narrow) 30.dp else 36.dp, height = 36.dp)),
        contentAlignment = Alignment.Center) {
        LIcon(icon, size = 20.dp, tint = if (on) pal.primary else pal.foreground)
        if (badge > 0) Txt("$badge", Modifier.align(Alignment.TopEnd).offset(x = 2.dp, y = (-2).dp)
            .defaultMinSize(minWidth = 16.8.dp, minHeight = 16.8.dp).background(pal.primary, CircleShape).padding(horizontal = 4.dp),
            size = 10f, weight = 600, color = pal.primaryForeground, lineHeight = 12f, align = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

/** Fekvő módban függőleges személysáv, a szélein elhalványul. iOS: LandscapeRail. */
@Composable
fun LandscapeRail(content: LazyListScope.() -> Unit) {
    val fade = Brush.verticalGradient(0f to Color.Transparent, 0.12f to Color.Black, 0.88f to Color.Black, 1f to Color.Transparent)
    LazyColumn(
        Modifier.fillMaxWidth().heightIn(max = 196.dp)
            .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
            .drawWithContent { drawContent(); drawRect(fade, blendMode = BlendMode.DstIn) },
        contentPadding = PaddingValues(horizontal = 6.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        content = content,
    )
}
