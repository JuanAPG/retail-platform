package com.udem.retaildecision.ui.observations

import com.udem.retaildecision.ui.scanner.IndiceCodigos

/*
 * Relleno del formulario de Capturas en tienda: lo que llega elegido desde el escáner o desde el
 * Detalle de zona, y lo que se elige al leer un código con el botón "Escanear". Son funciones puras
 * (estado → estado) para probarlas en la JVM.
 */

const val CODIGO_NO_ENCONTRADO = "Código no encontrado en el catálogo"
const val ESCANEADO_NO_CAPTURABLE = "El producto escaneado no está activo, así que no se puede capturar. Elige otro."

/** Lo que llega elegido al abrir Capturas en tienda. Todo es opcional. */
data class Preseleccion(
    /** Desde el Detalle de zona ("Capturar aquí"). */
    val tiendaId: String? = null,
    /** Desde el escáner: presentación encontrada, tipo elegido y código leído. */
    val presentacionId: String? = null,
    val tipo: String? = null,
    val codigo: String? = null,
) {
    val desdeEscaner: Boolean get() = presentacionId != null
}

/**
 * Aplica la preselección cuando el catálogo ya está cargado (del servidor o de la copia).
 *
 * - Tienda: la que se pidió; si no se pidió ninguna y se viene del escáner, la última tienda que ESTE
 *   usuario usó. Nunca reemplaza una tienda que el usuario ya eligió.
 * - Producto y presentación: la presentación escaneada, si sigue activa. Si no, se deja vacío con aviso.
 * - Tipo: el elegido en el escáner, solo si el rol lo puede enviar.
 */
fun aplicarPreseleccion(s: ObservationsUiState, pre: Preseleccion, ultimaTiendaId: String?): ObservationsUiState {
    val porId = { id: String? -> id?.let { buscado -> s.tiendas.firstOrNull { it.id == buscado } } }
    val tienda = s.tienda ?: porId(pre.tiendaId) ?: if (pre.desdeEscaner) porId(ultimaTiendaId) else null
    var r = s.copy(tienda = tienda)

    if (pre.tipo != null && pre.tipo in r.tipos && r.valorTexto.isEmpty()) r = r.copy(tipo = pre.tipo)

    if (pre.presentacionId != null && r.producto == null) {
        val hallado = r.productos.firstNotNullOfOrNull { p ->
            p.presentaciones.firstOrNull { it.id == pre.presentacionId && it.activo }?.let { p to it }
        }
        r = if (hallado != null) {
            val (producto, presentacion) = hallado
            r.copy(
                producto = producto,
                presentacion = presentacion,
                busqueda = producto.nombre,
                codigoEscaneado = pre.codigo?.trim()?.takeIf { it.isNotEmpty() } ?: presentacion.codigoBarras,
                avisoEscaneo = null,
            )
        } else {
            r.copy(avisoEscaneo = ESCANEADO_NO_CAPTURABLE)
        }
    }
    return r
}

/**
 * La cámara de Capturas en tienda leyó un código. Se busca en los productos cargados (sin internet,
 * los de la copia del teléfono). Si no está, solo se avisa: el formulario queda igual.
 */
fun aplicarCodigoLeido(s: ObservationsUiState, codigo: String): ObservationsUiState {
    val hallado = IndiceCodigos(s.productos, soloCapturables = true).buscar(codigo)
        ?: return s.copy(escaneando = false, avisoEscaneo = CODIGO_NO_ENCONTRADO)
    val (producto, presentacion) = hallado
    return s.copy(
        escaneando = false,
        avisoEscaneo = null,
        producto = producto,
        presentacion = presentacion,
        busqueda = producto.nombre,
        codigoEscaneado = codigo.trim(),
        mensaje = null,
        errorGuardar = null,
    )
}
