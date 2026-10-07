package com.udem.retaildecision.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.Map
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.RequestQuote
import androidx.compose.material.icons.rounded.Sell
import androidx.compose.material.icons.rounded.Storefront
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.udem.retaildecision.ui.components.ConnectivityPill
import com.udem.retaildecision.ui.components.EmptyState
import com.udem.retaildecision.ui.components.Pill
import com.udem.retaildecision.ui.components.RetailCard
import com.udem.retaildecision.ui.theme.Brand
import com.udem.retaildecision.ui.theme.BrandLight

/**
 * Se conserva con el mismo nombre y parámetro por si otra pantalla ya lo usa.
 * Banda de color que dice si hay internet.
 */
@Composable
fun ConnectivityBanner(online: Boolean) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (online) Color(0xFF2E7D32) else Color(0xFFB3261E))
            .padding(vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (online) "En línea" else "Sin conexión: se guardará en el teléfono",
            color = Color.White,
            style = MaterialTheme.typography.labelLarge,
        )
    }
}

/** Icono de cada sección según su id (si aparece una sección nueva sin icono, usa uno genérico). */
private fun iconoDeSeccion(id: String): ImageVector = when (id) {
    "catalogo" -> Icons.Rounded.Inventory2
    "escaner" -> Icons.Rounded.QrCodeScanner
    "zonas" -> Icons.Rounded.Map
    "precios" -> Icons.Rounded.Sell
    "propuestas" -> Icons.Rounded.RequestQuote
    "visitas" -> Icons.Rounded.Storefront
    else -> Icons.Rounded.Apps
}

@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onOpenSection: (String) -> Unit,
    onLoggedOut: () -> Unit,
) {
    val online by viewModel.online.collectAsState()

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            HomeHeader(
                nombre = viewModel.nombre,
                rol = viewModel.rol,
                online = online,
                onLogout = { viewModel.logout(onLoggedOut) },
            )

            if (viewModel.secciones.isEmpty()) {
                // Un rol sin secciones (rol desconocido) no debe ver una pantalla vacía sin explicación.
                EmptyState(
                    title = "Sin secciones disponibles",
                    message = "Tu perfil (${viewModel.rol ?: "desconocido"}) no tiene secciones en esta aplicación.",
                )
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 20.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        Text(
                            "Tus secciones",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    items(viewModel.secciones, key = { it.id }) { seccion ->
                        SeccionCard(seccion = seccion, onClick = { onOpenSection(seccion.id) })
                    }
                }
            }
        }
    }
}

/** Encabezado con degradado de marca: saludo, rol, estado de conexión y cerrar sesión. */
@Composable
private fun HomeHeader(nombre: String, rol: String?, online: Boolean, onLogout: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                Brush.linearGradient(listOf(Brand, BrandLight)),
                RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp),
            ),
    ) {
        Column(modifier = Modifier.padding(start = 20.dp, end = 8.dp, top = 12.dp, bottom = 24.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                ConnectivityPill(online)
                IconButton(onClick = onLogout) {
                    Icon(Icons.AutoMirrored.Rounded.Logout, contentDescription = "Cerrar sesión", tint = Color.White)
                }
            }
            Spacer(Modifier.height(8.dp))
            Text("Hola,", style = MaterialTheme.typography.bodyLarge, color = Color.White.copy(alpha = 0.8f))
            Text(nombre, style = MaterialTheme.typography.headlineSmall, color = Color.White)
            Spacer(Modifier.height(10.dp))
            if (rol != null) {
                Pill(text = rol, background = Color.White.copy(alpha = 0.2f), contentColor = Color.White)
            }
            if (!online) {
                Spacer(Modifier.height(10.dp))
                Text(
                    "Sin conexión: lo que captures se guardará en el teléfono.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color.White.copy(alpha = 0.9f),
                )
            }
        }
    }
}

@Composable
private fun SeccionCard(seccion: SeccionMovil, onClick: () -> Unit) {
    RetailCard(onClick = onClick) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(48.dp)
                    .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    iconoDeSeccion(seccion.id),
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(26.dp),
                )
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(seccion.titulo, style = MaterialTheme.typography.titleMedium)
                Text(
                    seccion.descripcion,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    seccion.servicio,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Icon(
                Icons.AutoMirrored.Rounded.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}