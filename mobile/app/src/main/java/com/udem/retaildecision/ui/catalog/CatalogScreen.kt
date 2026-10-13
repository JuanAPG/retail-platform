package com.udem.retaildecision.ui.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.SearchOff
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.data.remote.dto.ZoneDto
import com.udem.retaildecision.ui.components.AppTopBar
import com.udem.retaildecision.ui.components.EmptyState
import com.udem.retaildecision.ui.components.ErrorBanner
import com.udem.retaildecision.ui.components.LabeledValue
import com.udem.retaildecision.ui.components.LoadingBox
import com.udem.retaildecision.ui.components.Pill
import com.udem.retaildecision.ui.components.RetailCard
import com.udem.retaildecision.ui.components.SearchField
import com.udem.retaildecision.ui.components.StatusPill
import com.udem.retaildecision.ui.theme.Warning
import com.udem.retaildecision.ui.theme.WarningSoft
import java.text.Normalizer

/** Minúsculas y sin acentos, para que "leche" encuentre "Léche". */
private fun normalizar(texto: String): String =
    Normalizer.normalize(texto.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")

@Composable
fun CatalogScreen(
    viewModel: CatalogViewModel,
    /** 0 = abre en Productos, 1 = abre en Zonas. */
    pestanaInicial: Int,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    var pestana by rememberSaveable { mutableStateOf(pestanaInicial) }
    var busqueda by rememberSaveable { mutableStateOf("") }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Catálogo",
                subtitle = if (pestana == 0) "${state.productos.size} productos" else "${state.zonas.size} zonas",
                onBack = onBack,
            )
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            TabRow(
                selectedTabIndex = pestana,
                containerColor = MaterialTheme.colorScheme.surface,
                contentColor = MaterialTheme.colorScheme.primary,
            ) {
                Tab(selected = pestana == 0, onClick = { pestana = 0 }, text = { Text("Productos (${state.productos.size})") })
                Tab(selected = pestana == 1, onClick = { pestana = 1 }, text = { Text("Zonas (${state.zonas.size})") })
            }

            SearchField(
                value = busqueda,
                onValueChange = { busqueda = it },
                placeholder = if (pestana == 0) "Buscar producto, SKU o categoría" else "Buscar zona o municipio",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
            )

            when {
                state.cargando -> LoadingBox(label = "Cargando catálogo…")

                state.error != null -> Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    ErrorBanner(state.error ?: "")
                    Button(onClick = viewModel::cargar, shape = MaterialTheme.shapes.medium) {
                        Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                        Text("Reintentar")
                    }
                }

                pestana == 0 -> {
                    val q = normalizar(busqueda.trim())
                    val visibles = remember(state.productos, q) {
                        state.productos.filter {
                            q.isEmpty() || normalizar("${it.nombre} ${it.sku} ${it.categoria?.nombre ?: ""}").contains(q)
                        }
                    }
                    ListaVacia(visibles.isEmpty(), "Sin resultados", "No hay productos que coincidan con tu búsqueda.") {
                        LazyColumn(
                            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) { items(visibles, key = { it.id }) { ProductoCard(it) } }
                    }
                }

                else -> {
                    val q = normalizar(busqueda.trim())
                    val visibles = remember(state.zonas, q) {
                        state.zonas.filter {
                            q.isEmpty() || normalizar("${it.nombre} ${it.municipio?.nombre ?: ""}").contains(q)
                        }
                    }
                    ListaVacia(visibles.isEmpty(), "Sin resultados", "No hay zonas que coincidan con tu búsqueda.") {
                        LazyColumn(
                            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) { items(visibles, key = { it.id }) { ZonaCard(it) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun ListaVacia(vacia: Boolean, titulo: String, mensaje: String, contenido: @Composable () -> Unit) {
    if (vacia) {
        EmptyState(title = titulo, message = mensaje, icon = Icons.Rounded.SearchOff)
    } else {
        contenido()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProductoCard(p: ProductDto) {
    RetailCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(p.nombre, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "SKU ${p.sku} · ${p.categoria?.nombre ?: "Sin categoría"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(Icons.Rounded.Inventory2, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }

            if (p.presentaciones.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    p.presentaciones.forEach { Pill(text = it.nombre) }
                }
            }

            p.proveedor?.let { LabeledValue(label = "Proveedor", value = it.razonSocial) }

            if (p.esCanastaBasica || p.estatus == "pendiente_aprobacion") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (p.esCanastaBasica) StatusPill(text = "Canasta básica", positive = true)
                    if (p.estatus == "pendiente_aprobacion") {
                        Pill(text = "Pendiente de aprobación", background = WarningSoft, contentColor = Warning)
                    }
                }
            }
        }
    }
}

@Composable
private fun ZonaCard(z: ZoneDto) {
    RetailCard {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(Icons.Rounded.Map, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(z.nombre, style = MaterialTheme.typography.titleMedium)
                Text(
                    z.municipio?.nombre ?: "Sin municipio",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                z.descripcion?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            }
            StatusPill(text = if (z.activo) "Activa" else "Inactiva", positive = z.activo)
        }
    }
}