package hu.privateplace.app.ui

import android.graphics.Bitmap
import android.graphics.Color as AColor
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.util.concurrent.Executors

fun qrBitmap(text: String, size: Int = 640): Bitmap {
    val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 1))
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    for (x in 0 until size) for (y in 0 until size) bmp.setPixel(x, y, if (m[x, y]) AColor.BLACK else AColor.WHITE)
    return bmp
}

@Composable
fun QrImage(text: String, modifier: Modifier = Modifier) {
    val bmp = remember(text) { qrBitmap(text) }
    Image(bmp.asImageBitmap(), "QR-kód", modifier)
}

@Composable
fun QrScanner(onCode: (String) -> Unit, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current; val owner = LocalLifecycleOwner.current
    val exec = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
    var done = remember { booleanArrayOf(false) }
    AndroidView(modifier = modifier, factory = { c ->
        val pv = PreviewView(c)
        val fut = ProcessCameraProvider.getInstance(c)
        fut.addListener({
            val provider = fut.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(pv.surfaceProvider) }
            val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
            analysis.setAnalyzer(exec) { proxy ->
                val img = proxy.image
                if (img == null || done[0]) { proxy.close(); return@setAnalyzer }
                scanner.process(InputImage.fromMediaImage(img, proxy.imageInfo.rotationDegrees))
                    .addOnSuccessListener { l -> l.firstOrNull()?.rawValue?.let { if (!done[0]) { done[0] = true; onCode(it) } } }
                    .addOnCompleteListener { proxy.close() }
            }
            provider.unbindAll()
            provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        }, ContextCompat.getMainExecutor(c))
        pv
    })
}
