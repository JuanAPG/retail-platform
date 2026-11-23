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
import com.udem.retaildecision.data.remote.dto.PriceObservationDto
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
import java.util.Locale

private fun dinero(texto: String) = texto.toDoubleOrNull()?.let { "$" + String.format(Locale.US, "%.2f", it) } ?: texto

/** "2026-10-08T15:30:00.000Z" -> "2026-10-08 15:30 UTC" */
private fun fechaCorta(iso: String) = iso.replace("T", " ").take(16) + " UTC"

@Composable
fun PriceReviewScreen(
    viewModel: PriceReviewViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()

    state.rechazando?.let {
        MotivoRechazoDialog(
            titulo = "Rechazar precio de campo",
            onConfirmar = viewModel::confirmarRechazo,
            onCancelar = viewModel::cancelarRechazo,
        )
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Precios de campo",
                subtitle = "${state.pendientes.size} por revisar",
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
                        "Estos precios los levantaron en tienda. No cambian el precio vigente hasta que tú los apruebes."
                    } else {
                        "Solo lectura: únicamente el Responsable de precios aprueba o rechaza precios."
                    },
                )
                state.mensaje?.let { InfoBanner(it) }
                state.errorAccion?.let { ErrorBanner(it) }

                if (state.pendientes.isEmpty()) {
                    EmptyState(title = "Nada por revisar", message = "No hay precios de campo pendientes.")
                } else {
                    state.pendientes.forEach { item ->
                        ObservacionCard(
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
private fun ObservacionCard(
    item: PriceObservationDto,
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
                    Text(item.presentation?.producto?.nombre ?: "Producto", style = MaterialTheme.typography.titleMedium)
                    Text(
                        (item.presentation?.nombre ?: "Presentación") + " · " + (item.store?.nombre ?: "Tienda"),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(dinero(item.price), style = MaterialTheme.typography.titleLarge)
                    Pill(text = "Pendiente", background = WarningSoft, contentColor = Warning)
                }
            }
            Text(
                "Visto: ${fechaCorta(item.observedAt)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (item.lat != null && item.lng != null) {
                Text(
                    "Ubicación: ${item.lat}, ${item.lng}",
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