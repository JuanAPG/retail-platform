package com.udem.retaildecision.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/** Pide el motivo de un rechazo. El servidor exige mínimo 10 caracteres. */
@Composable
fun MotivoRechazoDialog(
    titulo: String,
    onConfirmar: (String) -> Unit,
    onCancelar: () -> Unit,
    minimo: Int = 10,
) {
    var motivo by remember { mutableStateOf("") }
    val valido = motivo.trim().length >= minimo
    AlertDialog(
        onDismissRequest = onCancelar,
        title = { Text(titulo) },
        text = {
            Column {
                OutlinedTextField(
                    value = motivo,
                    onValueChange = { motivo = it.take(300) },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Motivo del rechazo") },
                    supportingText = { Text("Mínimo $minimo caracteres (${motivo.trim().length})") },
                    shape = MaterialTheme.shapes.medium,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirmar(motivo.trim()) }, enabled = valido) { Text("Rechazar") }
        },
        dismissButton = { TextButton(onClick = onCancelar) { Text("Cancelar") } },
    )
}