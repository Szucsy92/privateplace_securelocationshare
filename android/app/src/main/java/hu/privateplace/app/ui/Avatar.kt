package hu.privateplace.app.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A kiválasztott profilképet 128×128-as JPEG data URL-lé alakítja. */
fun avatarFromUri(ctx: android.content.Context, uri: Uri): String? = runCatching {
    val src = ctx.contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it) } ?: return null
    val side = minOf(src.width, src.height)
    val square = Bitmap.createBitmap(src, (src.width - side) / 2, (src.height - side) / 2, side, side)
    val scaled = Bitmap.createScaledBitmap(square, 128, 128, true)
    val output = java.io.ByteArrayOutputStream()
    scaled.compress(Bitmap.CompressFormat.JPEG, 82, output)
    "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
}.getOrNull()?.takeIf { it.length <= 80_000 }

@Composable
fun Avatar(name: String, color: String, avatar: String?, size: Int = 40) {
    val bitmap = remember(avatar) { decodeDataUrl(avatar) }
    Box(
        Modifier.size(size.dp).clip(CircleShape)
            .background(parseColor(color))
            .border(2.dp, Color.White.copy(alpha = .8f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(bitmap.asImageBitmap(), null, Modifier.size(size.dp), contentScale = ContentScale.Crop)
        } else {
            androidx.compose.material3.Text(
                name.take(1).uppercase(),
                color = Color(0xFF0B1425),
                fontWeight = FontWeight.Bold,
                fontSize = (size / 2.4).sp,
            )
        }
    }
}
