package com.udem.retaildecision.ui.pricing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Sell
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import java.util.Locale

private fun dinero(valor: Double) = "$" + String.format(Locale.US, "%.2f", valor)

/** El servidor manda el precio como texto ("24.00"); se muestra con "$" delante. */
private fun dinero(texto: String) = texto.toDoubleOrNull()?.let { dinero(it) } ?: texto

@Composable
fun PricingScreen(
    viewModel: PricingViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    var menuAbierto by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Precios",
                subtitle = state.seleccionado?.nombre,
                onBack = onBack,
            )
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {

            // Selector de producto.
            Box(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
                OutlinedButton(
                    onClick = { menuAbierto = true },
                    enabled = state.productos.isNotEmpty(),
                    shape = MaterialTheme.shapes.medium,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) {
                    Text(
                        state.seleccionado?.nombre ?: "Elige un producto",
                        modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Icon(Icons.Rounded.ArrowDropDown, contentDescription = null)
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
                state.cargandoProductos || state.cargandoPrecios -> LoadingBox(label = "Cargando precios…")

                state.error != null -> Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    ErrorBanner(state.error ?: "")
                    Button(onClick = viewModel::reintentar, shape = MaterialTheme.shapes.medium) {
                        Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                        Text("Reintentar")
                    }
                }

                precios == null -> EmptyState(
                    icon = Icons.Rounded.Sell,
                    title = "Elige un producto",
                    message = "Selecciona un producto para ver su comparación por zonas y su historial de precios.",
                )

                precios.historial.isEmpty() && precios.zonas.isEmpty() -> EmptyState(
                    icon = Icons.Rounded.Sell,
                    title = "Sin precios",
                    message = "Este producto no tiene precios registrados.",
                )

                else -> LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item { SectionTitle("Comparación por zonas") }
                    if (precios.zonas.isEmpty()) {
                        item { InfoBanner("Sin datos por zona para este producto.") }
                    }
                    items(precios.zonas, key = { it.zoneId }) { ZonaPrecioCard(it) }

                    item { SectionTitle("Historial de precios", modifier = Modifier.padding(top = 8.dp)) }
                    items(precios.historial, key = { it.id }) { HistorialCard(it) }
                }
            }
        }
    }
}

@Composable
private fun ZonaPrecioCard(z: ZoneComparisonDto) {
    RetailCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(z.zoneName, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                Pill(text = "${z.storeCount} ${if (z.storeCount == 1) "tienda" else "tiendas"}")
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(24.dp),
                verticalAlignment = Alignment.Bottom,
            ) {
                Column {
                    Text("Promedio", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(
                        dinero(z.averagePrice),
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                LabeledValue(label = "Mínimo", value = dinero(z.minPrice))
                LabeledValue(label = "Máximo", value = dinero(z.maxPrice))
            }
        }
    }
}

@Composable
private fun HistorialCard(p: PriceHistoryDto) {
    RetailCard {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(p.presentation?.nombre ?: "Presentación", style = MaterialTheme.typography.titleMedium)
                val tienda = p.store?.nombre ?: "Tienda desconocida"
                val zona = p.store?.zona?.nombre
                Text(
                    if (zona != null) "$tienda ($zona)" else tienda,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    if (p.vigente) "Vigente desde ${p.effectiveDate}"
                    else "Del ${p.effectiveDate} al ${p.effectiveUntil ?: "—"}",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (p.vigente) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(dinero(p.price), style = MaterialTheme.typography.titleLarge)
                StatusPill(text = if (p.vigente) "Vigente" else "Histórico", positive = p.vigente)
            }
        }
    }
}