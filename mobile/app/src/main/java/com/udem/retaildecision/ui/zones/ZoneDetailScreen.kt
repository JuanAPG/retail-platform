package com.udem.retaildecision.ui.zones

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AddLocationAlt
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.Payments
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.ShoppingBasket
import androidx.compose.material.icons.rounded.Store
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.udem.retaildecision.data.remote.dto.StoreDto
import com.udem.retaildecision.ui.components.AppTopBar
import com.udem.retaildecision.ui.components.EmptyState
import com.udem.retaildecision.ui.components.ErrorBanner
import com.udem.retaildecision.ui.components.InfoBanner
import com.udem.retaildecision.ui.components.RetailCard
import com.udem.retaildecision.ui.components.SectionTitle
import com.udem.retaildecision.ui.components.StatusPill

@Composable
fun ZoneDetailScreen(
    viewModel: ZoneDetailViewModel,
    /** Abre Capturas en tienda con esa tienda ya elegida. */
    onCapturarEn: (tiendaId: String) -> Unit,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val zona = state.zona

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(title = zona?.nombre ?: "Detalle de zona", subtitle = "Detalle de zona", onBack = onBack)
        },
    ) { padding ->
        if (zona == null) {
            EmptyState(
                title = "Zona no encontrada",
                message = "Vuelve a la lista de zonas y ábrela de nuevo.",
                modifier = Modifier.padding(padding),
                icon = Icons.Rounded.Map,
            )
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                RetailCard {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Icon(Icons.Rounded.Map, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text(zona.nombre, style = MaterialTheme.typography.titleLarge)
                                Text(
                                    zona.municipio?.nombre ?: "Sin municipio",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            StatusPill(text = if (zona.activo) "Activa" else "Inactiva", positive = zona.activo)
                        }
                        zona.descripcion?.takeIf { it.isNotBlank() }?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }

            // Solo los 6 perfiles internos. Al Investigador de mercado no se le pide ni se le pinta (D-28).
            if (state.veIndicadores) {
                item { IndicadoresCard(state) }
            }

            item {
                SectionTitle(
                    if (state.cargandoTiendas) "Tiendas de esta zona" else "Tiendas de esta zona (${state.tiendas.size})",
                )
            }

            if (state.tiendasDesdeCopia) {
                item { InfoBanner("Sin conexión: se muestran las tiendas de la última copia guardada en el teléfono.") }
            }

            when {
                state.cargandoTiendas -> item {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(24.dp),
                        horizontalArrangement = Arrangement.Center,
                    ) { CircularProgressIndicator(strokeWidth = 3.dp) }
                }

                state.errorTiendas != null -> item {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        ErrorBanner(state.errorTiendas ?: "")
                        Button(onClick = viewModel::cargar, shape = MaterialTheme.shapes.medium) {
                            Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                            Text("Reintentar")
                        }
                    }
                }

                state.tiendas.isEmpty() -> item {
                    EmptyState(
                        title = "Sin tiendas",
                        message = "Esta zona no tiene tiendas activas registradas.",
                        icon = Icons.Rounded.Store,
                    )
                }

                else -> items(state.tiendas, key = { it.id }) { tienda ->
                    TiendaCard(
                        tienda = tienda,
                        puedeCapturar = state.permisos.puedeCapturar,
                        onCapturar = { onCapturarEn(tienda.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun IndicadoresCard(state: ZoneDetailUiState) {
    RetailCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.permisos.veIngreso) {
                FilaIndicador(icono = Icons.Rounded.Payments, titulo = "Nivel de ingreso") {
                    when (val i = state.ingreso) {
                        is Indicador.Listo -> IngresoPill(i.valor)
                        else -> TextoIndicador(i)
                    }
                }
            }
            if (state.permisos.veCobertura) {
                FilaIndicador(icono = Icons.Rounded.ShoppingBasket, titulo = "Disponibilidad") {
                    when (val c = state.cobertura) {
                        is Indicador.Listo -> Text("Cobertura de básicos: ${c.valor}", style = MaterialTheme.typography.bodyMedium)
                        else -> TextoIndicador(c)
                    }
                }
            }
            Text(
                "Datos de la zona en conjunto, no de personas ni de hogares.",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun FilaIndicador(icono: ImageVector, titulo: String, contenido: @Composable () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icono, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(titulo, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            contenido()
        }
    }
}

/** Cargando o aviso, en texto discreto: nunca un error rojo ni un 0. */
@Composable
private fun TextoIndicador(i: Indicador<*>) {
    val texto = when (i) {
        is Indicador.Aviso -> i.texto
        Indicador.Cargando -> "Consultando…"
        else -> return
    }
    Text(texto, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TiendaCard(tienda: StoreDto, puedeCapturar: Boolean, onCapturar: () -> Unit) {
    val context = LocalContext.current
    val mapa = uriMapa(tienda)
    val detalle = listOfNotNull(
        formatoLegible(tienda.formato),
        tienda.numeroSucursal?.takeIf { it.isNotBlank() }?.let { "Sucursal $it" },
    ).joinToString(" · ")

    RetailCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                Icon(Icons.Rounded.Store, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(tienda.nombre, style = MaterialTheme.typography.titleMedium)
                    if (detalle.isNotEmpty()) {
                        Text(detalle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
                Icon(
                    Icons.Rounded.Place,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
                Text(direccionLegible(tienda.direccion), style = MaterialTheme.typography.bodyMedium)
            }

            if (puedeCapturar || mapa != null) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (puedeCapturar) {
                        Button(onClick = onCapturar, shape = MaterialTheme.shapes.medium) {
                            Icon(Icons.Rounded.AddLocationAlt, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                            Text("Capturar aquí")
                        }
                    }
                    if (mapa != null) {
                        OutlinedButton(
                            onClick = {
                                try {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(mapa)))
                                } catch (e: ActivityNotFoundException) {
                                    Toast.makeText(context, "No hay una app de mapas instalada.", Toast.LENGTH_SHORT).show()
                                }
                            },
                            shape = MaterialTheme.shapes.medium,
                        ) {
                            Icon(Icons.Rounded.Map, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                            Text("Ver en mapa")
                        }
                    }
                }
            }
        }
    }
}
