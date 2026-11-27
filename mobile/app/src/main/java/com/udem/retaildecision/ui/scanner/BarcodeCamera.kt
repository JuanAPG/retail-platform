package com.udem.retaildecision.ui.scanner

import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "BarcodeCamera"

/** Se muestra sobre la vista previa si CameraX no pudo encender la cámara. */
private const val MENSAJE_SIN_CAMARA = "No se pudo abrir la cámara. Escribe el código a mano."

/**
 * Vista previa de la cámara trasera (CameraX) que lee códigos de barras con ML Kit.
 *
 * - Lee EAN-13, EAN-8, UPC-A, UPC-E y Code 128 (los de los productos de la tienda).
 * - Cada vez que lee uno llama a [onCodigo] en el hilo principal. Quien la use decide
 *   cuándo dejar de leer (por ejemplo, quitando este composable de la pantalla).
 * - Al salir de la pantalla suelta la cámara y cierra el lector.
 * - CameraX entrega el proveedor de cámara de forma asíncrona: si para entonces ya se salió de la
 *   pantalla (composición desechada o lifecycle DESTROYED), la cámara no se enciende. Si encenderla
 *   falla, no se tumba la app: se muestra un aviso y se puede escribir el código a mano.
 */
@Composable
fun BarcodeCamera(
    modifier: Modifier = Modifier,
    onCodigo: (String) -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val alLeer by rememberUpdatedState(onCodigo)
    var errorCamara by remember { mutableStateOf<String?>(null) }

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
    // Proveedor de cámara ya obtenido: lo usa la limpieza final para soltar la cámara antes de cerrar el hilo.
    val proveedorActual = remember { arrayOfNulls<ProcessCameraProvider>(1) }

    DisposableEffect(lifecycleOwner) {
        // El listener del future no se puede quitar: esta bandera lo "cancela" (si llega tarde, no hace nada).
        val desechado = AtomicBoolean(false)
        val futuro = ProcessCameraProvider.getInstance(context)
        futuro.addListener({
            if (desechado.get() || lifecycleOwner.lifecycle.currentState == Lifecycle.State.DESTROYED) return@addListener
            try {
                val p = futuro.get()
                proveedorActual[0] = p

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
                errorCamara = null
            } catch (e: Exception) {
                // Lifecycle destruido entre la revisión y el bind, cámara ocupada o sin cámara trasera.
                Log.w(TAG, "No se pudo encender la cámara", e)
                if (!desechado.get()) errorCamara = MENSAJE_SIN_CAMARA
            }
        }, ContextCompat.getMainExecutor(context))

        onDispose {
            desechado.set(true)
            soltarCamara(proveedorActual[0])
        }
    }

    // Al salir de la pantalla: primero se suelta la cámara (ya no llegan cuadros) y después se cierran
    // el hilo del análisis y el lector. Este efecto se desecha antes que el de arriba, por eso suelta aquí.
    DisposableEffect(Unit) {
        onDispose {
            soltarCamara(proveedorActual[0])
            proveedorActual[0] = null
            hiloAnalisis.shutdown()
            lector.close()
        }
    }

    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        AndroidView(factory = { previewView }, modifier = Modifier.matchParentSize())
        errorCamara?.let { mensaje ->
            Text(
                mensaje,
                modifier = Modifier
                    .padding(16.dp)
                    .background(MaterialTheme.colorScheme.surface, MaterialTheme.shapes.medium)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** Suelta la cámara sin tumbar la app si CameraX ya estaba cerrándose. */
private fun soltarCamara(proveedor: ProcessCameraProvider?) {
    try {
        proveedor?.unbindAll()
    } catch (e: Exception) {
        Log.w(TAG, "No se pudo soltar la cámara", e)
    }
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
