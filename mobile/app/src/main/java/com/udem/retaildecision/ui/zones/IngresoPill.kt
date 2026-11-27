package com.udem.retaildecision.ui.zones

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.udem.retaildecision.ui.components.Pill
import com.udem.retaildecision.ui.theme.Teal
import com.udem.retaildecision.ui.theme.TealSoft
import com.udem.retaildecision.ui.theme.Warning
import com.udem.retaildecision.ui.theme.WarningSoft
import com.udem.retaildecision.ui.theme.Azul
import com.udem.retaildecision.ui.theme.AzulSoft

/** Insignia del nivel de ingreso de la zona. Los colores solo distinguen niveles; ninguno es "bueno" o "malo". */
@Composable
fun IngresoPill(nivel: NivelIngreso, modifier: Modifier = Modifier) {
    val colores = MaterialTheme.colorScheme
    val (fondo, texto) = when (nivel.tono) {
        TonoIngreso.BAJO -> WarningSoft to Warning
        TonoIngreso.MEDIO -> AzulSoft to Azul
        TonoIngreso.ALTO -> TealSoft to Teal
        TonoIngreso.NEUTRO -> colores.surfaceVariant to colores.onSurfaceVariant
    }
    Pill(text = nivel.etiqueta, modifier = modifier, background = fondo, contentColor = texto)
}
