package com.udem.retaildecision.ui.catalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import java.text.Normalizer

/** Minúsculas y sin acentos, para que "leche" encuentre "Léche". */
private fun normalizar(texto: String): String =
    Normalizer.normalize(texto.lowercase(), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")

@OptIn(ExperimentalMaterial3Api::class)
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
        topBar = {
            TopAppBar(
                title = { Text("Catálogo") },
                navigationIcon = { TextButton(onClick = onBack) { Text("Volver") } },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = pestana) {
                Tab(selected = pestana == 0, onClick = { pestana = 0 }, text = { Text("Productos (${state.productos.size})") })
                Tab(selected = pestana == 1, onClick = { pestana = 1 }, text = { Text("Zonas (${state.zonas.size})") })
            }

            OutlinedTextField(
                value = busqueda,
                onValueChange = { busqueda = it },
                label = { Text(if (pestana == 0) "Buscar producto, SKU o categoría" else "Buscar zona o municipio") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
            )

            when {
                state.cargando -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }

                state.error != null -> Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(state.error ?: "", color = MaterialTheme.colorScheme.error)
                    Button(onClick = viewModel::cargar) { Text("Reintentar") }
                }

                pestana == 0 -> {
                    val q = normalizar(busqueda.trim())
                    val visibles = remember(state.productos, q) {
                        state.productos.filter {
                            q.isEmpty() || normalizar("${it.nombre} ${it.sku} ${it.categoria?.nombre ?: ""}").contains(q)
                        }
                    }
                    ListaVacia(visibles.isEmpty(), "No hay productos que coincidan.") {
                        LazyColumn(
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
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
                    ListaVacia(visibles.isEmpty(), "No hay zonas que coincidan.") {
                        LazyColumn(
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) { items(visibles, key = { it.id }) { ZonaCard(it) } }
                    }
                }
            }
        }
    }
}

@Composable
private fun ListaVacia(vacia: Boolean, mensaje: String, contenido: @Composable () -> Unit) {
    if (vacia) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text(mensaje) }
    } else {
        contenido()
    }
}

@Composable
private fun ProductoCard(p: ProductDto) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(p.nombre, style = MaterialTheme.typography.titleMedium)
            Text("SKU ${p.sku} · ${p.categoria?.nombre ?: "Sin categoría"}", style = MaterialTheme.typography.bodySmall)
            if (p.presentaciones.isNotEmpty()) {
                Text("Presentaciones: " + p.presentaciones.joinToString(", ") { it.nombre }, style = MaterialTheme.typography.bodyMedium)
            }
            p.proveedor?.let { Text("Proveedor: ${it.razonSocial}", style = MaterialTheme.typography.bodySmall) }
            val etiquetas = buildList {
                if (p.esCanastaBasica) add("Canasta básica")
                if (p.estatus == "pendiente_aprobacion") add("Pendiente de aprobación")
            }
            if (etiquetas.isNotEmpty()) {
                Text(etiquetas.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

@Composable
private fun ZonaCard(z: ZoneDto) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(z.nombre, style = MaterialTheme.typography.titleMedium)
            Text(z.municipio?.nombre ?: "Sin municipio", style = MaterialTheme.typography.bodySmall)
            z.descripcion?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
            if (!z.activo) Text("Inactiva", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error)
        }
    }
}