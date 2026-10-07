package com.udem.retaildecision.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Pantalla provisional de una sección que todavía no está construida. */
@Composable
fun SectionPlaceholderScreen(seccionId: String?, onBack: () -> Unit) {
    val seccion = SECCIONES.firstOrNull { it.id == seccionId }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(seccion?.titulo ?: "Sección", style = MaterialTheme.typography.headlineSmall)
        Text("Esta pantalla se construye en el siguiente paso.")
        if (seccion != null) Text("Consumirá: ${seccion.servicio}", style = MaterialTheme.typography.bodySmall)
        Button(onClick = onBack) { Text("Volver") }
    }
}