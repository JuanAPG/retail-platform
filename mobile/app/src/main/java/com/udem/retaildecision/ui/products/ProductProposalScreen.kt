package com.udem.retaildecision.ui.products

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.rounded.AddBox
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.ui.components.AppTopBar
import com.udem.retaildecision.ui.components.EmptyState
import com.udem.retaildecision.ui.components.ErrorBanner
import com.udem.retaildecision.ui.components.InfoBanner
import com.udem.retaildecision.ui.components.LoadingBox
import com.udem.retaildecision.ui.components.Pill
import com.udem.retaildecision.ui.components.RetailCard
import com.udem.retaildecision.ui.components.SectionTitle
import com.udem.retaildecision.ui.components.SelectorDesplegable
import com.udem.retaildecision.ui.components.StatusPill
import com.udem.retaildecision.ui.theme.Warning
import com.udem.retaildecision.ui.theme.WarningSoft

@Composable
fun ProductProposalScreen(
    viewModel: ProductProposalViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Proponer un producto",
                subtitle = "${state.misProductos.size} productos tuyos",
                onBack = onBack,
            )
        },
    ) { padding ->
        when {
            state.cargando -> LoadingBox(modifier = Modifier.padding(padding), label = "Cargando…")

            state.error != null -> Column(
                modifier = Modifier.padding(padding).fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ErrorBanner(state.error ?: "")
                Button(onClick = viewModel::cargar, shape = MaterialTheme.shapes.medium) {
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
                    "Tu producto queda pendiente hasta que el Gerente de categoría lo apruebe. " +
                            "Mientras tanto nadie más lo ve ni puede ponerle precio.",
                )
                state.mensaje?.let { InfoBanner(it) }

                SectionTitle("Nuevo producto")
                OutlinedTextField(
                    value = state.sku,
                    onValueChange = viewModel::cambiarSku,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("SKU (código interno único)") },
                    singleLine = true,
                    shape = MaterialTheme.shapes.medium,
                )
                OutlinedTextField(
                    value = state.nombre,
                    onValueChange = viewModel::cambiarNombre,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Nombre del producto") },
                    singleLine = true,
                    shape = MaterialTheme.shapes.medium,
                )
                OutlinedTextField(
                    value = state.descripcion,
                    onValueChange = viewModel::cambiarDescripcion,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Descripción (opcional)") },
                    shape = MaterialTheme.shapes.medium,
                )
                SelectorDesplegable(
                    textoVacio = "Elige la categoría",
                    seleccion = state.categoria?.nombre,
                    opciones = state.categorias.map { it.nombre },
                    onElegir = { viewModel.elegirCategoria(state.categorias[it]) },
                )
                OutlinedTextField(
                    value = state.presentacion,
                    onValueChange = viewModel::cambiarPresentacion,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Presentación") },
                    placeholder = { Text("Por ejemplo: 1 kg") },
                    singleLine = true,
                    shape = MaterialTheme.shapes.medium,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = state.contenidoTexto,
                        onValueChange = viewModel::cambiarContenido,
                        modifier = Modifier.weight(1f),
                        label = { Text("Contenido") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        shape = MaterialTheme.shapes.medium,
                    )
                    SelectorDesplegable(
                        textoVacio = "Unidad",
                        seleccion = state.unidad?.clave,
                        opciones = state.unidades.map { "${it.clave} · ${it.nombre}" },
                        onElegir = { viewModel.elegirUnidad(state.unidades[it]) },
                        modifier = Modifier.weight(1f),
                    )
                }
                state.errorEnviar?.let { ErrorBanner(it) }
                Button(
                    onClick = viewModel::enviar,
                    enabled = state.puedeEnviar,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Icon(Icons.Rounded.AddBox, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                    Text(if (state.enviando) "Enviando…" else "Enviar propuesta")
                }

                SectionTitle("Mis productos (${state.misProductos.size})")
                if (state.misProductos.isEmpty()) {
                    EmptyState(title = "Todavía no tienes productos", message = "Los que propongas aparecerán aquí con su estado.")
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        state.misProductos.forEach { ProductoPropioCard(it) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductoPropioCard(p: ProductDto) {
    RetailCard {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(p.nombre, style = MaterialTheme.typography.titleMedium)
                Text(
                    "SKU ${p.sku}" + (p.presentaciones.firstOrNull()?.let { " · ${it.nombre}" } ?: ""),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (p.estatus == "rechazado") {
                    Text(
                        "Si fue rechazado, haz una propuesta nueva.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
            when (p.estatus) {
                "activo" -> StatusPill(text = "Activo", positive = true)
                "rechazado" -> StatusPill(text = "Rechazado", positive = false)
                "inactivo" -> StatusPill(text = "Inactivo", positive = false)
                else -> Pill(text = "Pendiente", background = WarningSoft, contentColor = Warning)
            }
        }
    }
}