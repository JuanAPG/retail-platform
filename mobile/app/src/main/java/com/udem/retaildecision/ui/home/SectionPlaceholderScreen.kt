package com.udem.retaildecision.ui.home

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Construction
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.udem.retaildecision.ui.components.AppTopBar
import com.udem.retaildecision.ui.components.EmptyState

/** Pantalla provisional de una sección que todavía no está construida. */
@Composable
fun SectionPlaceholderScreen(seccionId: String?, onBack: () -> Unit) {
    val seccion = SECCIONES.firstOrNull { it.id == seccionId }
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { AppTopBar(title = seccion?.titulo ?: "Sección", onBack = onBack) },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(48.dp))
            EmptyState(
                icon = Icons.Rounded.Construction,
                title = "Próximamente",
                message = if (seccion != null) "Esta sección se construye en el siguiente paso y consumirá ${seccion.servicio}." else "Esta sección se construye en el siguiente paso.",
            )
            Spacer(Modifier.height(16.dp))
            Button(onClick = onBack, modifier = Modifier.fillMaxWidth(), shape = MaterialTheme.shapes.medium) {
                Text("Volver")
            }
        }
    }
}