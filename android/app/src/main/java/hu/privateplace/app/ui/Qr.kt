package hu.privateplace.app.ui

import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

/** QR-beolvasó (.qr-scanner): négyzetes, 1.5rem lekerekítés, középen világító keret. */
@Composable
fun QrScanner(onCode: (String) -> Unit, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current; val owner = LocalLifecycleOwner.current
    val exec = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()) }
    val done = remember { booleanArrayOf(false) }
    val shape = RoundedCornerShape(24.dp)
    Box(modifier.fillMaxWidth().aspectRatio(1f).clip(shape).background(Color(0xFF0C1018)).border(1.dp, pal.glassEdge, shape)) {
        AndroidView(modifier = Modifier.fillMaxSize(), factory = { c ->
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
        Box(Modifier.align(Alignment.Center).fillMaxSize(0.64f).border(2.dp, pal.primary, RoundedCornerShape(20.dp)))
    }
}
