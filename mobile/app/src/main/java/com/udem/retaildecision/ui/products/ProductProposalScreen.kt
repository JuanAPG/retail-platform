package com.udem.retaildecision.ui.products

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AddBox
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.Refresh
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.udem.retaildecision.data.remote.dto.ProductDto
import com.udem.retaildecision.ui.components.AppTopBar
import com.udem.retaildecision.ui.components.EmptyState
import com.udem.retaildecision.ui.components.EtiquetaConAyuda
import com.udem.retaildecision.ui.components.ErrorBanner
import com.udem.retaildecision.ui.components.InfoBanner
import com.udem.retaildecision.ui.components.LoadingBox
import com.udem.retaildecision.ui.components.Pill
import com.udem.retaildecision.ui.components.RetailCard
import com.udem.retaildecision.ui.components.SectionTitle
import com.udem.retaildecision.ui.components.SelectorDesplegable
import com.udem.retaildecision.ui.components.StatusPill
import com.udem.retaildecision.ui.components.TextoDeApoyo
import com.udem.retaildecision.ui.theme.Warning
import com.udem.retaildecision.ui.theme.WarningSoft

// Ayuda de cada campo: texto de apoyo (una línea) y explicación con ejemplo (diálogo del ícono ⓘ).
private const val APOYO_SKU = "Tu código interno del producto. No es el código de barras."
private const val AYUDA_SKU = "El SKU es el código que tu empresa usa para identificar el producto. Máximo 40 caracteres, " +
    "sin repetir. Sugerencia: CATEGORÍA-PRODUCTO-NÚMERO. Ejemplo: ABA-ARR-001."
private const val APOYO_NOMBRE = "Cómo se llama el producto."
private const val AYUDA_NOMBRE = "El nombre comercial, sin el tamaño. Ejemplo: Arroz blanco."
private const val APOYO_DESCRIPCION = "Opcional."
private const val AYUDA_DESCRIPCION = "Un detalle que ayude a identificarlo. Ejemplo: Grano largo, calidad súper extra."
private const val APOYO_CATEGORIA = "El grupo al que pertenece."
private const val AYUDA_CATEGORIA = "Elige la categoría del catálogo. Ejemplo: Abarrotes."
private const val APOYO_PRESENTACION = "Cómo se vende, en texto. Ej.: Bolsa 1 kg."
private const val AYUDA_PRESENTACION = "Es el nombre del empaque tal como lo verá la gente. Va junto con Contenido y Unidad: " +
    "'Botella 600 ml' se captura con Contenido 600 y Unidad ml."
private const val APOYO_CONTENIDO = "Cuánto trae, solo el número."
private const val AYUDA_CONTENIDO = "El número de la cantidad del empaque, mayor a 0. Ejemplo: para 'Botella 600 ml' escribe 600."
private const val APOYO_UNIDAD = "En qué se mide el contenido."
private const val AYUDA_UNIDAD = "kg y g para peso, l y ml para líquidos, pza para piezas. Ejemplo: para 'Botella 600 ml' elige ml."

/**
 * "Se verá como: <Nombre> · <Presentación> (<Contenido> <Unidad>)" con lo que ya se haya escrito;
 * null si todavía no hay ningún dato.
 */
private fun vistaPrevia(nombre: String, presentacion: String, contenido: String, unidad: String?): String? {
    val medida = listOf(contenido.trim(), unidad.orEmpty().trim()).filter { it.isNotEmpty() }.joinToString(" ")
    val partes = listOf(nombre.trim(), presentacion.trim()).filter { it.isNotEmpty() }.joinToString(" · ")
    val texto = listOf(partes, if (medida.isNotEmpty()) "($medida)" else "").filter { it.isNotEmpty() }.joinToString(" ")
    return texto.ifEmpty { null }
}

/** Tarjeta "¿Cómo llenar esta propuesta?" con un ejemplo completo. */
@Composable
private fun ComoLlenar() {
    val ejemplo = listOf(
        "SKU" to "ABA-ARR-001",
        "Nombre" to "Arroz blanco",
        "Categoría" to "Abarrotes",
        "Presentación" to "Bolsa 1 kg",
        "Contenido" to "1",
        "Unidad" to "kg",
    )
    RetailCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.Lightbulb, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Text("¿Cómo llenar esta propuesta?", style = MaterialTheme.typography.titleSmall)
            }
            Text(
                buildAnnotatedString {
                    append("Ejemplo: ")
                    ejemplo.forEachIndexed { i, (campo, valor) ->
                        if (i > 0) append(" · ")
                        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(campo) }
                        append(" $valor")
                    }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                "Tu propuesta la revisa el Gerente de categoría antes de aparecer en el catálogo. " +
                    "Mientras tanto nadie más lo ve ni puede ponerle precio.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
fun ProductProposalScreen(
    viewModel: ProductProposalViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.state.collectAsState()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            AppTopBar(
                title = "Proponer un producto",
                subtitle = "${state.misProductos.size} productos tuyos",
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
                ComoLlenar()
                state.mensaje?.let { InfoBanner(it) }

                SectionTitle("Nuevo producto")
                Column {
                    EtiquetaConAyuda("SKU (código interno único)", tituloAyuda = "SKU", ayuda = AYUDA_SKU)
                    OutlinedTextField(
                        value = state.sku,
                        onValueChange = viewModel::cambiarSku,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("ABA-ARR-001") },
                        supportingText = { Text(APOYO_SKU) },
                        singleLine = true,
                        shape = MaterialTheme.shapes.medium,
                    )
                }
                Column {
                    EtiquetaConAyuda("Nombre del producto", tituloAyuda = "Nombre", ayuda = AYUDA_NOMBRE)
                    OutlinedTextField(
                        value = state.nombre,
                        onValueChange = viewModel::cambiarNombre,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Arroz blanco") },
                        supportingText = { Text(APOYO_NOMBRE) },
                        singleLine = true,
                        shape = MaterialTheme.shapes.medium,
                    )
                }
                Column {
                    EtiquetaConAyuda("Descripción (opcional)", tituloAyuda = "Descripción", ayuda = AYUDA_DESCRIPCION)
                    OutlinedTextField(
                        value = state.descripcion,
                        onValueChange = viewModel::cambiarDescripcion,
                        modifier = Modifier.fillMaxWidth(),
                        supportingText = { Text(APOYO_DESCRIPCION) },
                        shape = MaterialTheme.shapes.medium,
                    )
                }
                Column {
                    EtiquetaConAyuda("Categoría", tituloAyuda = "Categoría", ayuda = AYUDA_CATEGORIA)
                    SelectorDesplegable(
                        textoVacio = "Elige la categoría",
                        seleccion = state.categoria?.nombre,
                        opciones = state.categorias.map { it.nombre },
                        onElegir = { viewModel.elegirCategoria(state.categorias[it]) },
                    )
                    TextoDeApoyo(APOYO_CATEGORIA)
                }
                Column {
                    EtiquetaConAyuda("Presentación", tituloAyuda = "Presentación", ayuda = AYUDA_PRESENTACION)
                    OutlinedTextField(
                        value = state.presentacion,
                        onValueChange = viewModel::cambiarPresentacion,
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Por ejemplo: 1 kg") },
                        supportingText = { Text(APOYO_PRESENTACION) },
                        singleLine = true,
                        shape = MaterialTheme.shapes.medium,
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.weight(1f)) {
                        EtiquetaConAyuda("Contenido", tituloAyuda = "Contenido", ayuda = AYUDA_CONTENIDO)
                        OutlinedTextField(
                            value = state.contenidoTexto,
                            onValueChange = viewModel::cambiarContenido,
                            modifier = Modifier.fillMaxWidth(),
                            placeholder = { Text("600") },
                            supportingText = { Text(APOYO_CONTENIDO) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            shape = MaterialTheme.shapes.medium,
                        )
                    }
                    Column(Modifier.weight(1f)) {
                        EtiquetaConAyuda("Unidad", tituloAyuda = "Unidad", ayuda = AYUDA_UNIDAD)
                        SelectorDesplegable(
                            textoVacio = "Unidad",
                            seleccion = state.unidad?.clave,
                            opciones = state.unidades.map { "${it.clave} · ${it.nombre}" },
                            onElegir = { viewModel.elegirUnidad(state.unidades[it]) },
                        )
                        TextoDeApoyo(APOYO_UNIDAD)
                    }
                }
                vistaPrevia(state.nombre, state.presentacion, state.contenidoTexto, state.unidad?.clave)?.let { previa ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.medium)
                            .padding(12.dp),
                        verticalAlignment = Alignment.Top,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(
                            Icons.Rounded.Visibility,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(20.dp),
                        )
                        Text(
                            buildAnnotatedString {
                                append("Se verá como: ")
                                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(previa) }
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                    }
                }
                state.errorEnviar?.let { ErrorBanner(it) }
                Button(
                    onClick = viewModel::enviar,
                    enabled = state.puedeEnviar,
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = MaterialTheme.shapes.medium,
                ) {
                    Icon(Icons.Rounded.AddBox, contentDescription = null, modifier = Modifier.padding(end = 8.dp))
                    Text(if (state.enviando) "Enviando…" else "Enviar propuesta")
                }

                SectionTitle("Mis productos (${state.misProductos.size})")
                if (state.misProductos.isEmpty()) {
                    EmptyState(title = "Todavía no tienes productos", message = "Los que propongas aparecerán aquí con su estado.")
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        state.misProductos.forEach { ProductoPropioCard(it) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProductoPropioCard(p: ProductDto) {
    RetailCard {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(p.nombre, style = MaterialTheme.typography.titleMedium)
                Text(
                    "SKU ${p.sku}" + (p.presentaciones.firstOrNull()?.let { " · ${it.nombre}" } ?: ""),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (p.estatus == "rechazado") {
                    Text(
                        "Si fue rechazado, haz una propuesta nueva.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
            when (p.estatus) {
                "activo" -> StatusPill(text = "Activo", positive = true)
                "rechazado" -> StatusPill(text = "Rechazado", positive = false)
                "inactivo" -> StatusPill(text = "Inactivo", positive = false)
                else -> Pill(text = "Pendiente", background = WarningSoft, contentColor = Warning)
            }
        }
    }
}