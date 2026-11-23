package com.udem.retaildecision.ui.proposals

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
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.RequestQuote
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
import com.udem.retaildecision.data.remote.dto.PriceProposalDto
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
import java.util.Locale

private fun dinero(texto: String) = texto.toDoubleOrNull()?.let { "$" + String.format(Locale.US, "%.2f", it) } ?: texto

@Composable
fun ProposalsScreen(
    viewModel: ProposalsViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Mis propuestas de precio",
                subtitle = "${state.propuestas.size} enviadas",
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
                    "Propón el precio de venta de una presentación de tus productos. " +
                            "El Responsable de precios lo aprueba o lo rechaza con un motivo.",
                )
                state.mensaje?.let { InfoBanner(it) }

                SectionTitle("Nueva propuesta")
                if (state.productos.isEmpty()) {
                    InfoBanner("No tienes productos activos. Solo se puede proponer precio sobre productos ya aprobados.")
                } else {
                    SelectorDesplegable(
                        textoVacio = "Elige uno de tus productos",
                        seleccion = state.producto?.nombre,
                        opciones = state.productos.map { it.nombre },
                        onElegir = { viewModel.elegirProducto(state.productos[it]) },
                    )
                    state.producto?.let { producto ->
                        val activas = producto.presentaciones.filter { it.activo }
                        if (activas.isEmpty()) {
                            ErrorBanner("Este producto no tiene presentaciones activas.")
                        } else {
                            SelectorDesplegable(
                                textoVacio = "Elige la presentación",
                                seleccion = state.presentacion?.nombre,
                                opciones = activas.map { it.nombre },
                                onElegir = { viewModel.elegirPresentacion(activas[it]) },
                            )
                        }
                    }
                    OutlinedTextField(
                        value = state.precioTexto,
                        onValueChange = viewModel::cambiarPrecio,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Precio propuesto en pesos") },
                        prefix = { Text("$") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        shape = MaterialTheme.shapes.medium,
                    )
                    OutlinedTextField(
                        value = state.unidadCompra,
                        onValueChange = viewModel::cambiarUnidadCompra,
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Unidad de compra (opcional)") },
                        placeholder = { Text("Por ejemplo: caja 12 pzas") },
                        singleLine = true,
                        shape = MaterialTheme.shapes.medium,
                    )
                    state.errorEnviar?.let { ErrorBanner(it) }
                    Button(
                        onClick = viewModel::enviar,
                        enabled = state.puedeEnviar,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        shape = MaterialTheme.shapes.medium,
                    ) {
                        Icon(Icons.Rounded.RequestQuote, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                        Text(if (state.enviando) "Enviando…" else "Enviar propuesta")
                    }
                }

                SectionTitle("Mis propuestas (${state.propuestas.size})")
                if (state.propuestas.isEmpty()) {
                    EmptyState(title = "Todavía no hay propuestas", message = "Las propuestas que envíes aparecerán aquí con su estado.")
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        state.propuestas.forEach { PropuestaCard(it) }
                    }
                }
            }
        }
    }
}

@Composable
private fun PropuestaCard(p: PriceProposalDto) {
    RetailCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        p.presentation?.producto?.nombre ?: "Producto",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        (p.presentation?.nombre ?: "Presentación") + (p.purchaseUnit?.let { " · $it" } ?: ""),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(dinero(p.proposedPrice), style = MaterialTheme.typography.titleLarge)
                    when (p.status) {
                        "aprobado" -> StatusPill(text = "Aprobada", positive = true)
                        "rechazado" -> StatusPill(text = "Rechazada", positive = false)
                        else -> Pill(text = "Pendiente", background = WarningSoft, contentColor = Warning)
                    }
                }
            }
            if (p.status == "rechazado" && !p.rejectionReason.isNullOrBlank()) {
                Text(
                    "Motivo: ${p.rejectionReason}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}