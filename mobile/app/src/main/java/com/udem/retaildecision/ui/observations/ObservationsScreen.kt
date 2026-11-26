package com.udem.retaildecision.ui.observations

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.MyLocation
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.data.repository.EstadoCaptura
import com.udem.retaildecision.data.repository.ObservacionGuardada
import com.udem.retaildecision.ui.components.AppTopBar
import com.udem.retaildecision.ui.components.EmptyState
import com.udem.retaildecision.ui.components.ErrorBanner
import com.udem.retaildecision.ui.components.InfoBanner
import com.udem.retaildecision.ui.components.LabeledValue
import com.udem.retaildecision.ui.components.LoadingBox
import com.udem.retaildecision.ui.components.Pill
import com.udem.retaildecision.ui.components.RetailCard
import com.udem.retaildecision.ui.components.SectionTitle
import com.udem.retaildecision.ui.components.SelectorDesplegable
import com.udem.retaildecision.ui.components.StatusPill
import com.udem.retaildecision.ui.home.ConnectivityBanner
import com.udem.retaildecision.ui.theme.Warning
import com.udem.retaildecision.ui.theme.WarningSoft
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun coordenada(valor: Double) = String.format(Locale.US, "%.6f", valor)

private fun dinero(valor: Double) = "$" + String.format(Locale.US, "%.2f", valor)

private fun cantidad(valor: Double): String =
    if (valor % 1.0 == 0.0) valor.toLong().toString() else String.format(Locale.US, "%.2f", valor)

private fun nombreTipo(tipo: String): String = when (tipo) {
    TipoCaptura.PRECIO_OBSERVADO -> "Precio"
    TipoCaptura.DISPONIBILIDAD -> "Existencia"
    else -> tipo
}

private fun fecha(millis: Long): String =
    SimpleDateFormat("dd/MM/yyyy HH:mm", Locale("es", "MX")).format(Date(millis))

private fun direccionTexto(t: StoreDto): String {
    val d = t.direccion ?: return "Sin dirección registrada"
    val calle = listOfNotNull(d.calle, d.numeroExterior).joinToString(" ")
    return listOf(calle, d.colonia.orEmpty(), d.codigoPostal.orEmpty()).filter { it.isNotBlank() }
        .joinToString(", ").ifBlank { "Sin dirección registrada" }
}

@Composable
fun ObservationsScreen(
    viewModel: ObservationsViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val context = LocalContext.current

    val pedirPermiso = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { resultado ->
        // Basta con el permiso preciso o con el aproximado.
        if (resultado.values.any { it }) viewModel.obtenerUbicacion() else viewModel.permisoDenegado()
    }

    fun alObtenerUbicacion() {
        val fino = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val aproximado = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (fino || aproximado) {
            viewModel.obtenerUbicacion()
        } else {
            pedirPermiso.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
    }

    val pendientes = state.capturas.count { it.estado == EstadoCaptura.PENDIENTE || it.estado == EstadoCaptura.REINTENTO }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Column {
                AppTopBar(
                    title = "Capturas en tienda",
                    subtitle = if (pendientes == 0) "Todo enviado" else "$pendientes pendientes de enviar",
                    onBack = onBack,
                )
                // Siempre visible: dice si lo que se guarde se envía ya o se queda en el teléfono.
                ConnectivityBanner(online = state.enLinea)
            }
        },
    ) { padding ->
        when {
            state.cargandoCatalogo -> LoadingBox(modifier = Modifier.padding(padding), label = "Cargando tiendas y productos…")

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
                InfoBanner(
                    "Cada captura se guarda en el teléfono con su folio y se envía sola cuando hay internet. " +
                            "Un precio aceptado queda pendiente de aprobación del Responsable de precios.",
                )
                if (state.usandoCopiaLocal) {
                    InfoBanner("Sin conexión: se usan las tiendas y productos guardados la última vez.")
                }
                state.mensaje?.let { InfoBanner(it) }

                // ---------- 1. Tienda ----------
                SectionTitle("1. Elige la tienda")
                SelectorDesplegable(
                    textoVacio = if (state.tiendas.isEmpty()) "No hay tiendas activas" else "Elige una tienda",
                    seleccion = state.tienda?.nombre,
                    opciones = state.tiendas.map { "${it.nombre} · ${it.zona?.nombre ?: "Sin zona"}" },
                    onElegir = { viewModel.elegirTienda(state.tiendas[it]) },
                )
                state.tienda?.let { tienda ->
                    RetailCard {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(tienda.nombre, style = MaterialTheme.typography.titleMedium)
                            Text(
                                direccionTexto(tienda),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            tienda.zona?.let { LabeledValue(label = "Zona", value = it.nombre) }
                        }
                    }
                }

                // ---------- Tipo de captura (solo los que el rol puede enviar) ----------
                if (state.tipos.size > 1) {
                    SectionTitle("Qué vas a capturar")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        state.tipos.forEach { tipo ->
                            val texto = if (tipo == TipoCaptura.PRECIO_OBSERVADO) "Precio en anaquel" else "Existencia"
                            if (tipo == state.tipo) {
                                Button(
                                    onClick = {},
                                    modifier = Modifier.weight(1f),
                                    shape = MaterialTheme.shapes.medium,
                                ) { Text(texto) }
                            } else {
                                OutlinedButton(
                                    onClick = { viewModel.elegirTipo(tipo) },
                                    modifier = Modifier.weight(1f),
                                    shape = MaterialTheme.shapes.medium,
                                ) { Text(texto) }
                            }
                        }
                    }
                }

                // ---------- 2. Producto ----------
                SectionTitle("2. Producto y presentación")
                OutlinedTextField(
                    value = state.busqueda,
                    onValueChange = viewModel::cambiarBusqueda,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Buscar por nombre o SKU") },
                    singleLine = true,
                    shape = MaterialTheme.shapes.medium,
                )
                val sugerencias = state.sugerencias
                if (sugerencias.isNotEmpty()) {
                    RetailCard {
                        Column(Modifier.fillMaxWidth()) {
                            sugerencias.forEach { producto ->
                                TextButton(
                                    onClick = { viewModel.elegirProducto(producto) },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text(
                                        "${producto.nombre} · ${producto.sku}",
                                        modifier = Modifier.weight(1f),
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                }
                            }
                        }
                    }
                } else if (state.producto == null && state.busqueda.trim().length >= 2) {
                    Text(
                        "No hay productos que coincidan con la búsqueda.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                state.producto?.let { producto ->
                    val activas = producto.presentaciones.filter { it.activo }
                    if (activas.isEmpty()) {
                        ErrorBanner("Este producto no tiene presentaciones activas.")
                    } else {
                        SelectorDesplegable(
                            textoVacio = "Elige la presentación",
                            seleccion = state.presentacion?.let { p ->
                                p.nombre + (p.unidadMedida?.clave?.let { " ($it)" } ?: "")
                            },
                            opciones = activas.map { it.nombre },
                            onElegir = { viewModel.elegirPresentacion(activas[it]) },
                        )
                    }
                }

                // ---------- 3. Precio o existencia ----------
                if (state.esPrecio) {
                    SectionTitle("3. Precio que ves en el anaquel")
                    OutlinedTextField(
                        value = state.valorTexto,
                        onValueChange = viewModel::cambiarValor,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Precio en pesos") },
                        prefix = { Text("$") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        shape = MaterialTheme.shapes.medium,
                    )
                } else {
                    SectionTitle("3. Existencia en anaquel")
                    OutlinedTextField(
                        value = state.valorTexto,
                        onValueChange = viewModel::cambiarValor,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Unidades de esta presentación (0 = agotado)") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        shape = MaterialTheme.shapes.medium,
                    )
                }

                // ---------- 4. Ubicación ----------
                SectionTitle("4. Tu ubicación")
                RetailCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        val u = state.ubicacion
                        if (u != null) {
                            LabeledValue(label = "Latitud", value = coordenada(u.latitud))
                            LabeledValue(label = "Longitud", value = coordenada(u.longitud))
                            u.precisionMetros?.let { LabeledValue(label = "Precisión", value = "±${it.toInt()} m") }
                            val distancia = distanciaATienda(state.tienda, u)
                            when {
                                state.tienda == null -> Unit
                                distancia != null -> LabeledValue(label = "Distancia a la tienda", value = "$distancia m")
                                else -> Text(
                                    "La tienda no tiene coordenadas registradas, así que no se puede calcular la distancia.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        } else {
                            Text(
                                "Aún no se ha tomado tu ubicación.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }

                        state.errorUbicacion?.let { ErrorBanner(it) }

                        OutlinedButton(
                            onClick = ::alObtenerUbicacion,
                            enabled = !state.obteniendoUbicacion,
                            modifier = Modifier.fillMaxWidth(),
                            shape = MaterialTheme.shapes.medium,
                        ) {
                            if (state.obteniendoUbicacion) {
                                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                                Text("  Buscando señal…")
                            } else {
                                Icon(Icons.Rounded.MyLocation, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                                Text(if (u == null) "Obtener mi ubicación" else "Actualizar ubicación")
                            }
                        }
                    }
                }

                state.errorGuardar?.let { ErrorBanner(it) }

                Button(
                    onClick = viewModel::guardar,
                    enabled = state.puedeGuardar,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Icon(Icons.Rounded.Save, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                    Text(if (state.guardando) "Guardando…" else "Guardar captura")
                }
                if (!state.puedeGuardar && !state.guardando) {
                    Text(
                        if (state.esPrecio) {
                            "Para guardar hace falta: tienda, producto con presentación, un precio mayor que cero y tu ubicación."
                        } else {
                            "Para guardar hace falta: tienda, producto con presentación, la existencia (0 o más) y tu ubicación."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                // ---------- Capturas guardadas ----------
                SectionTitle("Capturas en este teléfono (${state.capturas.size})")
                if (pendientes > 0) {
                    OutlinedButton(
                        onClick = viewModel::enviarAhora,
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.medium,
                    ) {
                        Icon(Icons.Rounded.CloudUpload, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                        Text("Enviar ahora ($pendientes)")
                    }
                }
                if (state.puedeConsultarDecisiones && state.capturas.any { it.estado == EstadoCaptura.ENVIADA && it.tipo == TipoCaptura.PRECIO_OBSERVADO }) {
                    OutlinedButton(
                        onClick = { viewModel.refrescarEstados() },
                        enabled = !state.actualizandoEstados,
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.medium,
                    ) {
                        Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                        Text(if (state.actualizandoEstados) "Consultando…" else "Actualizar estados")
                    }
                }
                if (state.capturas.isEmpty()) {
                    EmptyState(title = "Todavía no hay capturas", message = "Lo que guardes aparecerá aquí con su estado.")
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        state.capturas.forEach { CapturaCard(it) }
                    }
                }
            }
        }
    }
}

@Composable
private fun CapturaCard(c: ObservacionGuardada) {
    val esPrecio = c.tipo == TipoCaptura.PRECIO_OBSERVADO
    RetailCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        c.productoNombre + (c.presentacionNombre?.let { " · $it" } ?: ""),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        "${nombreTipo(c.tipo)} · ${c.tiendaNombre} · ${fecha(c.creadaEn)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val valor = if (esPrecio) {
                        c.precio?.let(::dinero) ?: "—"
                    } else {
                        c.existencia?.let { if (it == 0.0) "Agotado" else "${cantidad(it)} u." } ?: "—"
                    }
                    Text(valor, style = MaterialTheme.typography.titleLarge)
                    when (c.estado) {
                        EstadoCaptura.PENDIENTE -> Pill(text = "Pendiente de enviar", background = WarningSoft, contentColor = Warning)
                        EstadoCaptura.REINTENTO -> Pill(text = "Se reintentará", background = WarningSoft, contentColor = Warning)
                        EstadoCaptura.ENVIADA -> if (esPrecio) {
                            Pill(text = "Enviada · en revisión", background = WarningSoft, contentColor = Warning)
                        } else {
                            StatusPill(text = "Enviada", positive = true)
                        }
                        EstadoCaptura.CONFLICTO -> StatusPill(text = "Conflicto", positive = false)
                        EstadoCaptura.NO_ACEPTADA -> StatusPill(text = "Rechazada", positive = false)
                        EstadoCaptura.APROBADA -> StatusPill(text = "Aprobada", positive = true)
                        EstadoCaptura.RECHAZADA -> StatusPill(text = "Precio no aprobado", positive = false)
                    }
                }
            }
            Text(
                "${coordenada(c.latitud)}, ${coordenada(c.longitud)}" +
                        (c.precisionMetros?.let { " · ±${it.toInt()} m" } ?: "") +
                        (c.distanciaATiendaMetros?.let { " · a $it m de la tienda" } ?: ""),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val explicacion = when (c.estado) {
                EstadoCaptura.PENDIENTE -> "Guardada en el teléfono. Se envía sola cuando haya internet."
                EstadoCaptura.REINTENTO -> "El servidor no pudo entregarla todavía; se vuelve a enviar sola con el mismo folio."
                EstadoCaptura.ENVIADA -> if (esPrecio) {
                    "Recibida por el servidor. Espera la decisión del Responsable de precios."
                } else {
                    "Recibida por el servidor."
                }
                EstadoCaptura.CONFLICTO -> "El servidor ya tenía un dato más reciente de esta tienda y presentación. No se sobrescribió y no se reintenta; la captura quedó guardada."
                EstadoCaptura.NO_ACEPTADA -> "El servidor no la aceptó y reintentar no cambia nada."
                EstadoCaptura.APROBADA -> "Aprobada por el Responsable de precios. Ya forma parte del historial de precios."
                EstadoCaptura.RECHAZADA -> "El Responsable de precios no la aprobó."
            }
            Text(explicacion, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            c.motivo?.let {
                val color = if (c.estado == EstadoCaptura.REINTENTO) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error
                Text("Motivo: $it", style = MaterialTheme.typography.bodySmall, color = color)
            }
            Text(
                "Folio ${c.captureId}",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
