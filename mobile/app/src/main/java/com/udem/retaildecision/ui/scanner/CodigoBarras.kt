package com.udem.retaildecision.ui.scanner

import com.udem.retaildecision.data.model.TipoCaptura
import com.udem.retaildecision.data.remote.dto.PresentacionDto
import com.udem.retaildecision.data.remote.dto.ProductDto

/**
 * Quita espacios y ceros a la izquierda: una lectora puede entregar un UPC-A de 12 dígitos
 * y la base guardarlo como EAN-13 de 13 (con un 0 delante), y deben considerarse el mismo.
 */
fun normalizarCodigo(codigo: String): String = codigo.trim().trimStart('0')

/** Se puede capturar precio o existencia de esta presentación: producto activo y presentación activa. */
fun esCapturable(producto: ProductDto, presentacion: PresentacionDto): Boolean =
    producto.estatus == "activo" && presentacion.activo

/**
 * Código de barras → producto y presentación. Se arma con la lista que haya (del servidor o la copia
 * guardada en el teléfono), así que funciona sin internet.
 *
 * @param soloCapturables deja fuera productos pendientes y presentaciones inactivas (para Capturas en tienda).
 */
class IndiceCodigos(productos: List<ProductDto>, soloCapturables: Boolean = false) {

    private val mapa: Map<String, Pair<ProductDto, PresentacionDto>> = buildMap {
        for (producto in productos) {
            for (presentacion in producto.presentaciones) {
                if (soloCapturables && !esCapturable(producto, presentacion)) continue
                val clave = normalizarCodigo(presentacion.codigoBarras ?: continue)
                if (clave.isNotEmpty()) put(clave, producto to presentacion)
            }
        }
    }

    fun buscar(codigo: String): Pair<ProductDto, PresentacionDto>? =
        normalizarCodigo(codigo).takeIf { it.isNotEmpty() }?.let { mapa[it] }
}

/**
 * Botones de captura que se ofrecen tras encontrar un código: solo los tipos que el rol puede enviar
 * (`TipoCaptura.permitidosPara`) y solo si la presentación se puede capturar.
 */
fun botonesCaptura(tiposDelRol: List<String>, producto: ProductDto?, presentacion: PresentacionDto?): List<String> =
    if (producto == null || presentacion == null || !esCapturable(producto, presentacion)) emptyList() else tiposDelRol

fun textoBotonCaptura(tipo: String): String = when (tipo) {
    TipoCaptura.PRECIO_OBSERVADO -> "Capturar precio"
    TipoCaptura.DISPONIBILIDAD -> "Capturar existencia"
    else -> "Capturar"
}
