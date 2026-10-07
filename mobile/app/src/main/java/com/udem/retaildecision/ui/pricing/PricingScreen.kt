package com.udem.retaildecision.ui.pricing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.udem.retaildecision.data.remote.dto.PriceHistoryDto
import com.udem.retaildecision.data.remote.dto.ZoneComparisonDto
import java.util.Locale

private fun dinero(valor: Double) = "$" + String.format(Locale.US, "%.2f", valor)

/** El servidor manda el precio como texto ("24.00"); se muestra con "$" delante. */
private fun dinero(texto: String) = texto.toDoubleOrNull()?.let { dinero(it) } ?: texto

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PricingScreen(
    viewModel: PricingViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    var menuAbierto by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Precios") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Volver") } },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {

            // Selector de producto.
            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                OutlinedButton(
                    onClick = { menuAbierto = true },
                    enabled = state.productos.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(state.seleccionado?.nombre ?: "Elige un producto")
                }
                DropdownMenu(expanded = menuAbierto, onDismissRequest = { menuAbierto = false }) {
                    state.productos.forEach { producto ->
                        DropdownMenuItem(
                            text = { Text(producto.nombre) },
                            onClick = {
                                menuAbierto = false
                                viewModel.seleccionar(producto)
                            },
                        )
                    }
                }
            }

            val precios = state.precios
            when {
                state.cargandoProductos || state.cargandoPrecios ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }

                state.error != null -> Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(state.error ?: "", color = MaterialTheme.colorScheme.error)
                    Button(onClick = viewModel::reintentar) { Text("Reintentar") }
                }

                precios == null ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Elige un producto.") }

                precios.historial.isEmpty() && precios.zonas.isEmpty() ->
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Este producto no tiene precios registrados.")
                    }

                else -> LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    item { Text("Comparación por zonas", style = MaterialTheme.typography.titleMedium) }
                    if (precios.zonas.isEmpty()) {
                        item { Text("Sin datos por zona.", style = MaterialTheme.typography.bodySmall) }
                    }
                    items(precios.zonas, key = { it.zoneId }) { ZonaPrecioCard(it) }

                    item {
                        Text(
                            "Historial de precios",
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                    items(precios.historial, key = { it.id }) { HistorialCard(it) }
                }
            }
        }
    }
}

@Composable
private fun ZonaPrecioCard(z: ZoneComparisonDto) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(z.zoneName, style = MaterialTheme.typography.titleMedium)
            Text("Promedio ${dinero(z.averagePrice)}", style = MaterialTheme.typography.bodyLarge)
            Text(
                "Mínimo ${dinero(z.minPrice)} · Máximo ${dinero(z.maxPrice)} · " +
                        "${z.storeCount} ${if (z.storeCount == 1) "tienda" else "tiendas"}",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun HistorialCard(p: PriceHistoryDto) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                "${p.presentation?.nombre ?: "Presentación"} · ${dinero(p.price)}",
                style = MaterialTheme.typography.titleMedium,
            )
            val tienda = p.store?.nombre ?: "Tienda desconocida"
            val zona = p.store?.zona?.nombre
            Text(if (zona != null) "$tienda ($zona)" else tienda, style = MaterialTheme.typography.bodyMedium)
            Text(
                if (p.vigente) "Vigente desde ${p.effectiveDate}"
                else "Del ${p.effectiveDate} al ${p.effectiveUntil ?: "—"}",
                style = MaterialTheme.typography.bodySmall,
                color = if (p.vigente) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}