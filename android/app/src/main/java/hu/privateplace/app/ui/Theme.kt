package hu.privateplace.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

val Navy = Color(0xFF0B1425)
val Mint = Color(0xFF14B8A6)
val Glass = Color(0xCC111B30)          // matt üveg: áttetsző, sötét felület
val GlassBorder = Color(0x22FFFFFF)
val Muted = Color(0xFF94A3B8)

fun parseColor(hex: String): Color = Color(android.graphics.Color.parseColor(hex))

@Composable
fun PrivatePlaceTheme(content: @Composable () -> Unit) = MaterialTheme(
    colorScheme = darkColorScheme(primary = Mint, background = Navy, surface = Color(0xFF111B30), onSurface = Color.White, onBackground = Color.White,
        secondary = Color(0xFF818CF8), surfaceVariant = Color(0xFF16233D), error = Color(0xFFFB7185)),
    content = content,
)

fun Modifier.glass(radius: Int = 24): Modifier =
    this.clip(RoundedCornerShape(radius.dp)).background(Glass).border(BorderStroke(1.dp, GlassBorder), RoundedCornerShape(radius.dp))
