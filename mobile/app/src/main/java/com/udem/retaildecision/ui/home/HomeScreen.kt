package com.udem.retaildecision.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Banda de color que dice si hay internet (requisito explícito: indicador de conectividad). */
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    viewModel: HomeViewModel,
    onOpenSection: (String) -> Unit,
    onLoggedOut: () -> Unit,
) {
    val online by viewModel.online.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(viewModel.nombre, style = MaterialTheme.typography.titleMedium)
                        Text(viewModel.rol ?: "", style = MaterialTheme.typography.bodySmall)
                    }
                },
                actions = {
                    TextButton(onClick = { viewModel.logout(onLoggedOut) }) {
                        Text("Cerrar sesión")
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            ConnectivityBanner(online)

            if (viewModel.secciones.isEmpty()) {
                Text(
                    text = "Tu perfil (${viewModel.rol ?: "desconocido"}) no tiene secciones disponibles en esta aplicación.",
                    modifier = Modifier.padding(16.dp),
                )
            } else {
                LazyColumn(
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(viewModel.secciones, key = { it.id }) { seccion ->
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onOpenSection(seccion.id) },
                        ) {
                            Column(modifier = Modifier.padding(16.dp)) {
                                Text(seccion.titulo, style = MaterialTheme.typography.titleMedium)
                                Text(seccion.descripcion, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    seccion.servicio,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}