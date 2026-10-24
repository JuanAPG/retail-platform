package com.udem.retaildecision.ui.scanner

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.SearchOff
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.udem.retaildecision.data.remote.dto.PriceHistoryDto
import com.udem.retaildecision.ui.components.AppTopBar
import com.udem.retaildecision.ui.components.EmptyState
import com.udem.retaildecision.ui.components.ErrorBanner
import com.udem.retaildecision.ui.components.InfoBanner
import com.udem.retaildecision.ui.components.LabeledValue
import com.udem.retaildecision.ui.components.LoadingBox
import com.udem.retaildecision.ui.components.Pill
import com.udem.retaildecision.ui.components.RetailCard
import com.udem.retaildecision.ui.components.SectionTitle
import com.udem.retaildecision.ui.components.StatusPill
import com.udem.retaildecision.ui.theme.Warning
import com.udem.retaildecision.ui.theme.WarningSoft
import java.util.Locale

private fun dinero(texto: String): String =
    texto.toDoubleOrNull()?.let { "$" + String.format(Locale.US, "%.2f", it) } ?: texto

@Composable
fun ScannerScreen(
    viewModel: ScannerViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    fun tienePermiso() =
        ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    var permiso by remember { mutableStateOf(tienePermiso()) }
    val pedirPermiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { permiso = it }

    // Se pide el permiso al abrir la pantalla, y se vuelve a revisar al regresar de Ajustes.
    LaunchedEffect(Unit) { if (!permiso) pedirPermiso.launch(Manifest.permission.CAMERA) }
    DisposableEffect(lifecycleOwner) {
        val observador = LifecycleEventObserver { _, evento ->
            if (evento == Lifecycle.Event.ON_RESUME) permiso = tienePermiso()
        }
        lifecycleOwner.lifecycle.addObserver(observador)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observador) }
    }

    var manual by rememberSaveable { mutableStateOf("") }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { AppTopBar(title = "Escanear código", subtitle = "Identifica un producto con la cámara", onBack = onBack) },
    ) { padding ->
        when {
            state.cargandoCatalogo -> LoadingBox(modifier = Modifier.padding(padding), label = "Cargando catálogo…")

            state.errorCatalogo != null -> Column(
                modifier = Modifier.padding(padding).fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ErrorBanner(state.errorCatalogo ?: "")
                Button(onClick = viewModel::cargarCatalogo, shape = MaterialTheme.shapes.medium) {
                    Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                    Text("Reintentar")
                }
            }

            else -> Column(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (state.escaneando) {
                    if (permiso) {
                        InfoBanner("Apunta la cámara al código de barras de la presentación.")
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(280.dp)
                                .clip(MaterialTheme.shapes.large)
                                .border(BorderStroke(2.dp, MaterialTheme.colorScheme.primary), MaterialTheme.shapes.large),
                        ) {
                            BarcodeCamera(modifier = Modifier.fillMaxSize(), onCodigo = viewModel::buscarCodigo)
                        }
                    } else {
                        RetailCard {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                EmptyState(
                                    icon = Icons.Rounded.CameraAlt,
                                    title = "Falta el permiso de la cámara",
                                    message = "Sin la cámara no se puede escanear. Puedes dar el permiso o escribir el código a mano aquí abajo.",
                                )
                                Button(
                                    onClick = { pedirPermiso.launch(Manifest.permission.CAMERA) },
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = MaterialTheme.shapes.medium,
                                ) { Text("Dar permiso") }
                                OutlinedButton(
                                    onClick = {
                                        context.startActivity(
                                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
                                        )
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = MaterialTheme.shapes.medium,
                                ) { Text("Abrir ajustes") }
                            }
                        }
                    }

                    // Escribir el código a mano: sirve si la cámara no está disponible o el código está dañado.
                    SectionTitle("¿Prefieres escribirlo?")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = manual,
                            onValueChange = { nuevo -> manual = nuevo.filter { it.isDigit() }.take(20) },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("Código de barras") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            shape = MaterialTheme.shapes.medium,
                        )
                        Button(
                            onClick = { viewModel.buscarCodigo(manual) },
                            enabled = manual.isNotBlank(),
                            shape = MaterialTheme.shapes.medium,
                        ) { Text("Buscar") }
                    }
                } else {
                    Resultado(state = state)
                    Button(
                        onClick = {
                            manual = ""
                            viewModel.escanearOtro()
                        },
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.medium,
                    ) {
                        Icon(Icons.Rounded.QrCodeScanner, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                        Text("Escanear otro")
                    }
                }
            }
        }
    }
}

@Composable
private fun Resultado(state: ScannerUiState) {
    val producto = state.producto
    val presentacion = state.presentacion

    if (state.noEncontrado || producto == null || presentacion == null) {
        EmptyState(
            icon = Icons.Rounded.SearchOff,
            title = "No encontramos ese código",
            message = "El código ${state.codigo ?: ""} no está en el catálogo. Revisa que lo leyó completo o prueba con otro producto.",
        )
        return
    }

    RetailCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(producto.nombre, style = MaterialTheme.typography.titleLarge)
            Text(
                "SKU ${producto.sku} · ${producto.categoria?.nombre ?: "Sin categoría"}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            val contenido = presentacion.contenido.toDoubleOrNull()
                ?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }
                ?: presentacion.contenido
            Pill(text = "${presentacion.nombre} · $contenido ${presentacion.unidadMedida?.clave ?: ""}".trim())

            LabeledValue(label = "Código de barras", value = state.codigo ?: presentacion.codigoBarras ?: "—")
            producto.proveedor?.let { LabeledValue(label = "Proveedor", value = it.razonSocial) }

            if (producto.esCanastaBasica || producto.estatus == "pendiente_aprobacion") {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (producto.esCanastaBasica) StatusPill(text = "Canasta básica", positive = true)
                    if (producto.estatus == "pendiente_aprobacion") {
                        Pill(text = "Pendiente de aprobación", background = WarningSoft, contentColor = Warning)
                    }
                }
            }
        }
    }

    SectionTitle("Precios vigentes de esta presentación")
    when {
        state.cargandoPrecios -> LoadingBox(modifier = Modifier.height(96.dp), label = "Buscando precios…")
        state.errorPrecios != null -> ErrorBanner(state.errorPrecios)
        state.precios.isEmpty() -> EmptyState(
            title = "Sin precios vigentes",
            message = "Esta presentación no tiene un precio vigente en ninguna tienda.",
        )
        else -> {
            val minimo = state.precios.first().price
            val maximo = state.precios.last().price
            if (state.precios.size > 1) {
                InfoBanner("Desde ${dinero(minimo)} hasta ${dinero(maximo)} en ${state.precios.size} tiendas.")
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                state.precios.forEach { PrecioTienda(it) }
            }
        }
    }
}

@Composable
private fun PrecioTienda(p: PriceHistoryDto) {
    RetailCard {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(p.store?.nombre ?: "Tienda desconocida", style = MaterialTheme.typography.titleMedium)
                Text(
                    "${p.store?.zona?.nombre ?: "Sin zona"} · desde ${p.effectiveDate}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(dinero(p.price), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
        }
    }
}