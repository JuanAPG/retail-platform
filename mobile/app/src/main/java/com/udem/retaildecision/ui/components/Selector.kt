package com.udem.retaildecision.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Botón que abre una lista para elegir una opción. `onElegir` recibe la POSICIÓN de la opción
 * elegida dentro de `opciones`.
 */
@Composable
fun SelectorDesplegable(
    textoVacio: String,
    seleccion: String?,
    opciones: List<String>,
    onElegir: (Int) -> Unit,
    modifier: Modifier = Modifier,
    habilitado: Boolean = true,
) {
    var abierto by remember { mutableStateOf(false) }
    Box(modifier = modifier.fillMaxWidth()) {
        OutlinedButton(
            onClick = { abierto = true },
            enabled = habilitado && opciones.isNotEmpty(),
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(
                seleccion ?: textoVacio,
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge,
            )
            Icon(Icons.Rounded.ArrowDropDown, contentDescription = null, modifier = Modifier.padding(start = 8.dp))
        }
        DropdownMenu(expanded = abierto, onDismissRequest = { abierto = false }) {
            opciones.forEachIndexed { posicion, texto ->
                DropdownMenuItem(
                    text = { Text(texto) },
                    onClick = {
                        abierto = false
                        onElegir(posicion)
                    },
                )
            }
        }
    }
}