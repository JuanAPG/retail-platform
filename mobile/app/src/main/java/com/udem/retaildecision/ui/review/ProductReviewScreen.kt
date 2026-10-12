package com.udem.retaildecision.ui.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.ui.components.AppTopBar
import com.udem.retaildecision.ui.components.EmptyState
import com.udem.retaildecision.ui.components.ErrorBanner
import com.udem.retaildecision.ui.components.InfoBanner
import com.udem.retaildecision.ui.components.LoadingBox
import com.udem.retaildecision.ui.components.MotivoRechazoDialog
import com.udem.retaildecision.ui.components.Pill
import com.udem.retaildecision.ui.components.RetailCard
import com.udem.retaildecision.ui.theme.Warning
import com.udem.retaildecision.ui.theme.WarningSoft

@Composable
fun ProductReviewScreen(
    viewModel: ProductReviewViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()

    state.rechazando?.let {
        MotivoRechazoDialog(
            titulo = "Rechazar producto",
            onConfirmar = viewModel::confirmarRechazo,
            onCancelar = viewModel::cancelarRechazo,
        )
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Productos por aprobar",
                subtitle = "${state.pendientes.size} pendientes",
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
                    if (viewModel.puedeResolver) {
                        "Productos propuestos por Proveedores. Hasta que los apruebes nadie más los ve ni puede ponerles precio."
                    } else {
                        "Solo lectura: únicamente el Gerente de categoría aprueba o rechaza productos."
                    },
                )
                state.mensaje?.let { InfoBanner(it) }
                state.errorAccion?.let { ErrorBanner(it) }

                if (state.pendientes.isEmpty()) {
                    EmptyState(title = "Nada por revisar", message = "No hay productos pendientes de aprobación.")
                } else {
                    state.pendientes.forEach { item ->
                        ProductoCard(
                            item = item,
                            puedeResolver = viewModel.puedeResolver,
                            ocupado = state.procesandoId == item.id,
                            onAprobar = { viewModel.aprobar(item) },
                            onRechazar = { viewModel.pedirRechazo(item) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductoCard(
    item: ProductDto,
    puedeResolver: Boolean,
    ocupado: Boolean,
    onAprobar: () -> Unit,
    onRechazar: () -> Unit,
) {
    RetailCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(item.nombre, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "SKU ${item.sku}" + (item.categoria?.nombre?.let { " · $it" } ?: ""),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Pill(text = "Pendiente", background = WarningSoft, contentColor = Warning)
            }
            item.proveedor?.razonSocial?.let {
                Text("Proveedor: $it", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (item.presentaciones.isNotEmpty()) {
                Text(
                    "Presentaciones: " + item.presentaciones.joinToString(", ") { it.nombre },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (puedeResolver) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    OutlinedButton(
                        onClick = onRechazar,
                        enabled = !ocupado,
                        modifier = Modifier.weight(1f),
                        shape = MaterialTheme.shapes.medium,
                    ) { Text("Rechazar") }
                    Button(
                        onClick = onAprobar,
                        enabled = !ocupado,
                        modifier = Modifier.weight(1f),
                        shape = MaterialTheme.shapes.medium,
                    ) { Text(if (ocupado) "Procesando…" else "Aprobar") }
                }
            }
        }
    }
}