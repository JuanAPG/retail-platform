package com.udem.retaildecision.ui.scanner

import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Vista previa de la cámara trasera (CameraX) que lee códigos de barras con ML Kit.
 *
 * - Lee EAN-13, EAN-8, UPC-A, UPC-E y Code 128 (los de los productos de la tienda).
 * - Cada vez que lee uno llama a [onCodigo] en el hilo principal. Quien la use decide
 *   cuándo dejar de leer (por ejemplo, quitando este composable de la pantalla).
 * - Al salir de la pantalla suelta la cámara y cierra el lector.
 */
@Composable
fun BarcodeCamera(
    modifier: Modifier = Modifier,
    onCodigo: (String) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val alLeer by rememberUpdatedState(onCodigo)

    val previewView = remember {
        PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
    }
    val hiloAnalisis = remember { Executors.newSingleThreadExecutor() }
    val lector: BarcodeScanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(
                    Barcode.FORMAT_EAN_13,
                    Barcode.FORMAT_EAN_8,
                    Barcode.FORMAT_UPC_A,
                    Barcode.FORMAT_UPC_E,
                    Barcode.FORMAT_CODE_128,
                )
                .build(),
        )
    }
    // Evita avisar el mismo código muchas veces por segundo mientras sigue frente a la cámara.
    val yaAvisado = remember { AtomicBoolean(false) }

    DisposableEffect(lifecycleOwner) {
        val futuro = ProcessCameraProvider.getInstance(context)
        var proveedor: ProcessCameraProvider? = null
        futuro.addListener({
            val p = futuro.get()
            proveedor = p

            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val analisis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            analisis.setAnalyzer(hiloAnalisis) { imagen ->
                analizar(imagen, lector) { codigo ->
                    if (yaAvisado.compareAndSet(false, true)) {
                        ContextCompat.getMainExecutor(context).execute { alLeer(codigo) }
                    }
                }
            }

            p.unbindAll()
            p.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analisis)
        }, ContextCompat.getMainExecutor(context))

        onDispose { proveedor?.unbindAll() }
    }

    DisposableEffect(Unit) {
        onDispose {
            lector.close()
            hiloAnalisis.shutdown()
        }
    }

    AndroidView(factory = { previewView }, modifier = modifier)
}

@Suppress("UnsafeOptInUsageError")
private fun analizar(imagen: ImageProxy, lector: BarcodeScanner, alEncontrar: (String) -> Unit) {
    val media = imagen.image
    if (media == null) {
        imagen.close()
        return
    }
    val entrada = InputImage.fromMediaImage(media, imagen.imageInfo.rotationDegrees)
    lector.process(entrada)
        .addOnSuccessListener { codigos ->
            codigos.firstNotNullOfOrNull { it.rawValue }?.let(alEncontrar)
        }
        .addOnCompleteListener { imagen.close() }
}