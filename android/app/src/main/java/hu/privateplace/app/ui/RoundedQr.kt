package hu.privateplace.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.encoder.Encoder

/** A webes RoundedQRCode portja: lekerekített adatmodulok, lekerekített sarokszemek (even-odd gyűrű + közép). Hibajavítás: M. */
@Composable
fun RoundedQr(value: String, color: Color, modifier: Modifier = Modifier) {
    val cells = remember(value) {
        val m = Encoder.encode(value, ErrorCorrectionLevel.M, mapOf(EncodeHintType.CHARACTER_SET to "UTF-8")).matrix
        Array(m.height) { y -> BooleanArray(m.width) { x -> m.get(x, y).toInt() == 1 } }
    }
    val n = cells.size
    Canvas(modifier.aspectRatio(1f)) {
        val u = size.width / n
        fun inFinder(x: Int, y: Int) = (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7)
        for (y in 0 until n) for (x in 0 until n) if (cells[y][x] && !inFinder(x, y)) {
            val p = Path().apply { addRoundRect(RoundRect((x + 0.04f) * u, (y + 0.04f) * u, (x + 0.96f) * u, (y + 0.96f) * u, CornerRadius(0.32f * u))) }
            drawPath(p, color)
        }
        val finders = Path().apply { fillType = PathFillType.EvenOdd }
        for ((fx, fy) in listOf(0 to 0, n - 7 to 0, 0 to n - 7)) {
            fun rr(x: Float, y: Float, w: Float, h: Float, r: Float) = finders.addRoundRect(RoundRect(x * u, y * u, (x + w) * u, (y + h) * u, CornerRadius(r * u)))
            rr(fx.toFloat(), fy.toFloat(), 7f, 7f, 2f); rr(fx + 1f, fy + 1f, 5f, 5f, 1.2f); rr(fx + 2f, fy + 2f, 3f, 3f, 0.9f)
        }
        drawPath(finders, color)
    }
}
