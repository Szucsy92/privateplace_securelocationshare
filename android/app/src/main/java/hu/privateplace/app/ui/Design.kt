package hu.privateplace.app.ui

import android.content.Context
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider

// ───────── Téma ─────────
val LocalPalette = staticCompositionLocalOf { DarkPalette }
class Fonts(val body: FontFamily, val display: FontFamily)
val LocalFonts = staticCompositionLocalOf { Fonts(FontFamily.Default, FontFamily.Default) }
val pal: Palette @Composable get() = LocalPalette.current

const val ANIM_MS = 240   // minden harmónika/ablak/fül ugyanazzal az ütemmel mozog (a webes useSmoothHeight: 240 ms)
val AnimEasing = FastOutSlowInEasing
fun <T> harmonika() = tween<T>(ANIM_MS, easing = AnimEasing)

/** DM Sans (törzs) és Space Grotesk (cím) – a CI tölti le az assets/fonts mappába; hiányuk esetén rendszerbetű. */
fun loadFonts(ctx: Context): Fonts {
    fun family(file: String, weights: List<Int>): FontFamily = runCatching {
        ctx.assets.open("fonts/$file").close()
        FontFamily(weights.map { w -> Font("fonts/$file", ctx.assets, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w))) })
    }.getOrDefault(FontFamily.Default)
    return Fonts(family("DMSans.ttf", listOf(400, 500, 600, 700)), family("SpaceGrotesk.ttf", listOf(500, 700)))
}

@Composable
fun Txt(text: String, modifier: Modifier = Modifier, size: Float = 14f, weight: Int = 400, color: Color = pal.foreground, display: Boolean = false,
        maxLines: Int = Int.MAX_VALUE, align: TextAlign? = null, lineHeight: Float? = null, letterSpacing: Float? = null, underline: Boolean = false) {
    val f = LocalFonts.current
    Text(text, modifier, color = color, fontSize = size.sp, fontWeight = FontWeight(weight), fontFamily = if (display) f.display else f.body, maxLines = maxLines,
        overflow = TextOverflow.Ellipsis, textAlign = align, lineHeight = (lineHeight ?: (size * 1.43f)).sp,
        letterSpacing = (letterSpacing ?: 0f).sp, textDecoration = if (underline) androidx.compose.ui.text.style.TextDecoration.Underline else null)
}

/** Lucide ikon (a CI generálja az eredeti lucide-react készletből); hiányzó ikon helyén üres hely marad. */
@Composable
fun LIcon(name: String, modifier: Modifier = Modifier, size: Dp = 16.dp, tint: Color = pal.foreground) {
    val ctx = LocalContext.current
    val id = remember(name) { ctx.resources.getIdentifier("ic_" + name.replace('-', '_'), "drawable", ctx.packageName) }
    if (id == 0) Spacer(modifier.size(size)) else androidx.compose.material3.Icon(painterResource(id), null, modifier.size(size), tint)
}

// ───────── Üveg-felületek ─────────
val Radius = 14.4.dp
val RadiusXl = 18.4.dp
val Radius2xl = 22.4.dp

/** Matt üveg (.glass): áttetsző felület, vékony él, lágy árnyék. */
@Composable
fun Modifier.glass(radius: Dp = 20.dp, bg: Color = pal.glassBg, shape: Shape = RoundedCornerShape(radius)): Modifier =
    this.shadow(10.dp, shape, ambientColor = pal.shade.copy(alpha = .45f), spotColor = pal.shade.copy(alpha = .45f)).clip(shape).background(bg, shape).border(1.dp, pal.glassEdge, shape)

/** .glass-inset: halvány, besüllyesztett kártya. */
@Composable
fun Modifier.glassInset(radius: Dp = Radius2xl): Modifier {
    val s = RoundedCornerShape(radius)
    return this.clip(s).background(pal.glassInset, s).border(1.dp, pal.tint.copy(alpha = .07f), s)
}

@Composable
fun StatusDot(state: String, modifier: Modifier = Modifier) {
    val color = when (state) { "on" -> pal.live; "wait" -> pal.warn; "warn" -> pal.destructive; else -> pal.mutedForeground.copy(alpha = .6f) }
    val pulse = state in listOf("on", "wait", "warn")
    val t = rememberInfiniteTransition(label = "dot")
    val k by t.animateFloat(1f, 2.2f, infiniteRepeatable(tween(1600, easing = LinearOutSlowInEasing)), label = "k")
    Box(modifier.padding(horizontal = 2.dp).size(8.dp)) {
        if (pulse) Box(Modifier.fillMaxSize().scale(k).alpha((0.7f * (1 - (k - 1f) / 1.2f)).coerceIn(0f, .7f)).background(color, CircleShape))
        Box(Modifier.fillMaxSize().background(color, CircleShape))
    }
}

/** Jelző: aktív = zöld derengés. */
@Composable
fun Modifier.indicator(on: Boolean, shape: Shape = CircleShape, base: Color = Color.Transparent): Modifier =
    if (on) this.shadow(8.dp, shape, ambientColor = pal.signal.copy(alpha = .5f), spotColor = pal.signal.copy(alpha = .5f))
        .background(pal.signal.copy(alpha = .16f), shape).border(1.dp, pal.signal.copy(alpha = .55f), shape)
    else this.alpha(.72f).background(base, shape)

// ───────── Gombok (shadcn) ─────────
enum class Variant { Default, Outline, Ghost, Destructive }

@Composable
fun PPButton(onClick: () -> Unit, modifier: Modifier = Modifier, variant: Variant = Variant.Default, small: Boolean = false, enabled: Boolean = true,
             height: Dp? = null, content: @Composable RowScope.(Color) -> Unit) {
    val shape = CircleShape
    val h = height ?: if (small) 32.dp else 36.dp
    val fg = when (variant) { Variant.Default -> pal.primaryForeground; Variant.Destructive -> Color(0xFFFCFCFE); else -> pal.foreground }
    val bg = when (variant) { Variant.Default -> pal.primary; Variant.Destructive -> pal.destructive
        Variant.Outline -> pal.tint.copy(alpha = .05f); Variant.Ghost -> Color.Transparent }
    val mod = modifier.heightIn(min = h).alpha(if (enabled) 1f else .5f).clip(shape).background(bg, shape)
        .let { if (variant == Variant.Outline) it.border(1.dp, pal.tint.copy(alpha = .12f), shape) else it }
        .clickable(enabled = enabled, onClick = onClick).padding(horizontal = if (small) 12.dp else 16.dp)
    Row(mod, horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) { content(fg) }
}

@Composable
fun BtnText(text: String, color: Color, small: Boolean = false) = Txt(text, size = if (small) 12f else 14f, weight = 500, color = color, maxLines = 1)

@Composable
fun TextBtn(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, variant: Variant = Variant.Default, small: Boolean = false, enabled: Boolean = true, icon: String? = null) =
    PPButton(onClick, modifier, variant, small, enabled) { c ->
        if (icon != null) { LIcon(icon, size = if (small) 14.dp else 16.dp, tint = c); Spacer(Modifier.width(6.dp)) }
        BtnText(text, c, small)
    }

@Composable
fun IconBtn(icon: String, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, size: Dp = 36.dp, iconSize: Dp = 16.dp, tint: Color = pal.foreground) {
    Box(modifier.size(size).clip(CircleShape).clickable(onClick = onClick), contentAlignment = Alignment.Center) { LIcon(icon, size = iconSize, tint = tint) }
}

// ───────── Beviteli elemek ─────────
@Composable
fun PillInput(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier, max: Int = 80, height: Dp = 44.dp, glass: Boolean = true,
              keyboardOptions: KeyboardOptions = KeyboardOptions.Default, onDone: (() -> Unit)? = null) {
    val f = LocalFonts.current
    val shape = RoundedCornerShape(50)
    BasicTextField(value, { onChange(it.take(max)) }, singleLine = true, keyboardOptions = keyboardOptions,
        textStyle = TextStyle(color = pal.foreground, fontSize = 16.sp, fontFamily = f.body), cursorBrush = SolidColor(pal.primary),
        modifier = modifier.fillMaxWidth().height(height).clip(shape).background(if (glass) pal.fieldBg else Color.Transparent, shape)
            .border(1.dp, pal.tint.copy(alpha = .12f), shape).padding(horizontal = 16.dp),
        decorationBox = { inner -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Txt(placeholder, size = 16f, color = pal.mutedForeground, maxLines = 1); inner() } })
}

@Composable
fun PPCheckbox(checked: Boolean, onChange: (Boolean) -> Unit) {
    val shape = RoundedCornerShape(4.dp)
    Box(Modifier.size(16.dp).clip(shape).background(if (checked) pal.primary else Color.Transparent, shape).border(1.dp, pal.primary, shape)
        .clickable { onChange(!checked) }, contentAlignment = Alignment.Center) { if (checked) LIcon("check", size = 12.dp, tint = pal.primaryForeground) }
}

@Composable
fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier, size: Float = 14f, weight: Int = 400) =
    Row(modifier.clickable { onChange(!checked) }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        PPCheckbox(checked, onChange); Txt(label, size = size, weight = weight, modifier = Modifier.weight(1f, false))
    }

@Composable
fun PPSlider(value: Float, onChange: (Float) -> Unit, range: ClosedFloatingPointRange<Float>) =
    Slider(value, onChange, valueRange = range, colors = SliderDefaults.colors(thumbColor = pal.primary, activeTrackColor = pal.primary, inactiveTrackColor = pal.muted))

// ───────── Rugalmas görgetés (puha szélekkel) ─────────
@Composable
fun ElasticScroll(modifier: Modifier = Modifier, maxHeight: Dp = Dp.Unspecified, content: @Composable ColumnScope.() -> Unit) {
    val scroll = rememberScrollState()
    Column(modifier.then(if (maxHeight != Dp.Unspecified) Modifier.heightIn(max = maxHeight) else Modifier)
        .graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }
        .drawWithMask().verticalScroll(scroll), content = content)
}

private fun Modifier.drawWithMask(): Modifier = this.drawWithContent {
    drawContent()
    val h = 12.dp.toPx()
    drawRect(Brush.verticalGradient(listOf(Color.Transparent, Color.Black), 0f, h), size = androidx.compose.ui.geometry.Size(size.width, h), blendMode = BlendMode.DstIn)
    drawRect(Brush.verticalGradient(listOf(Color.Black, Color.Transparent), size.height - h, size.height), topLeft = androidx.compose.ui.geometry.Offset(0f, size.height - h),
        size = androidx.compose.ui.geometry.Size(size.width, h), blendMode = BlendMode.DstIn)
}

// ───────── Ablak (Dialog): matt üveg, középen, a tartalom magasságához lágyan igazodik ─────────
@Composable
fun GlassDialog(onDismiss: () -> Unit, dismissable: Boolean = true, maxWidth: Dp = 390.dp, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = { if (dismissable) onDismiss() }, properties = DialogProperties(dismissOnClickOutside = false, dismissOnBackPress = dismissable, usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        (LocalView.current.parent as? DialogWindowProvider)?.window?.setDimAmount(0f)
        var shown by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { shown = true }
        val shape = RoundedCornerShape(28.dp)
        Box(Modifier.fillMaxSize().background(pal.dialogBackdrop).pointerInput(dismissable) { detectTapGestures { if (dismissable) onDismiss() } }.safeDrawingPadding().imePadding(),
            contentAlignment = Alignment.Center) {
            AnimatedVisibility(shown, enter = fadeIn(tween(200)) + scaleIn(tween(200), 0.95f), exit = fadeOut(tween(150))) {
                Box(Modifier.padding(horizontal = 12.dp).widthIn(max = maxWidth).fillMaxWidth().pointerInput(Unit) { detectTapGestures { } }) {
                    Column(Modifier.fillMaxWidth().animateContentSize(harmonika()).clip(shape).background(pal.glassStrong, shape).border(1.dp, pal.glassEdge, shape)
                        .heightIn(max = (LocalContext.current.resources.displayMetrics.run { heightPixels / density } * 0.94f).dp)) { content() }
                    if (dismissable) Box(Modifier.align(Alignment.TopEnd).padding(top = 14.dp, end = 14.dp).size(28.dp).clip(CircleShape).clickable(onClick = onDismiss), contentAlignment = Alignment.Center) {
                        LIcon("x", size = 16.dp, tint = pal.foreground.copy(alpha = .7f)) }
                }
            }
        }
    }
}

@Composable
fun PanelHeader(title: String, description: String? = null, compact: Boolean = false) =
    Column(Modifier.fillMaxWidth().padding(start = if (compact) 16.dp else 20.dp, top = if (compact) 16.dp else 20.dp, end = 48.dp, bottom = if (compact) 8.dp else 16.dp),
        verticalArrangement = Arrangement.spacedBy(if (compact) 2.dp else 6.dp)) {
        Txt(title, size = if (compact) 16f else 18f, weight = 700, display = true, lineHeight = if (compact) 24f else 20f)
        if (description != null) Txt(description, size = if (compact) 12f else 14f, color = pal.mutedForeground)
    }

/** Fejléc vissza-gombbal (Beállítások almenük, Szobám). */
@Composable
fun BackHeader(title: String, onBack: () -> Unit) =
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 12.dp, end = 48.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        IconBtn("chevron-left", "Vissza", onBack, size = 32.dp, iconSize = 20.dp)
        Txt(title, size = 16f, weight = 700, display = true, maxLines = 1)
    }

/** A harmónika: gördülő szakasz (grid-rows 0fr → 1fr, 240 ms) – a szoba-beállításnál látott mozgás. */
@Composable
fun Expansion(open: Boolean, content: @Composable ColumnScope.() -> Unit) =
    AnimatedVisibility(open, enter = expandVertically(harmonika()) + fadeIn(tween(ANIM_MS)), exit = shrinkVertically(harmonika()) + fadeOut(tween(160))) { Column(content = content) }

/** Fülváltás / nézetváltás: az új nézet átúszik, a magasság lágyan igazodik. */
@Composable
fun <T> ViewSwitch(state: T, content: @Composable (T) -> Unit) =
    AnimatedContent(state, transitionSpec = {
        (fadeIn(tween(ANIM_MS, delayMillis = 60)) togetherWith fadeOut(tween(120))).using(SizeTransform(clip = false) { _, _ -> harmonika() })
    }, label = "view") { content(it) }

@Composable
fun Divider(modifier: Modifier = Modifier) = Box(modifier.fillMaxWidth().height(1.dp).background(pal.border))
