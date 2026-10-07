import { SetMetadata } from '@nestjs/common';

export const XML_ROOT_KEY = 'xmlRoot';

export interface XmlRootOpciones {
  /**
   * Elementos que deben salir SIEMPRE, incluso cuando su valor es nulo.
   *
   * Por defecto un nulo se omite, porque los XSD del repo declaran los
   * campos opcionales con `minOccurs="0"` y un elemento vacío no es un
   * `xs:decimal` ni un `xs:dateTime` válido.
   *
   * La excepción es `algorithms-core`: sus XSD usan uniones `*OrEmpty`
   * (`xs:decimal | empty`) en campos OBLIGATORIOS —`lift`,
   * `transactionCount`, `rSquared`…—, así que ahí omitir el elemento da
   * "Missing child element" y hay que emitirlo vacío. Se declara por
   * endpoint para no inventar una regla global que rompa a los demás.
   *
   * Aplica por nombre de elemento, a cualquier profundidad.
   */
  siemprePresentes?: string[];
}

/**
 * Nombre del elemento raíz del XML de este handler — ES PARTE DEL CONTRATO.
 *
 * Los XSD de `docs/contratos/` declaran raíces con nombre
 * (`zoneListResponse`, `priceListResponse`, `runListResponse`,
 * `indiceAccesibilidad`…) dentro de un `targetNamespace`. Sin este
 * decorador el interceptor emite `<response>` sin namespace, que no valida
 * contra ninguno de ellos.
 *
 * Se mantiene `<response>` como default a propósito: así un endpoint sin
 * decorar sigue respondiendo igual que antes y nada se rompe mientras cada
 * dueño va declarando sus raíces.
 *
 * Uso:
 * ```ts
 * @Get()
 * @XmlRoot('zoneListResponse')
 * findAll() { … }
 *
 * // Con campos que su XSD exige presentes aunque sean nulos:
 * @XmlRoot('aprioriRunResponse', { siemprePresentes: ['lift', 'transactionCount'] })
 * ```
 */
export const XmlRoot = (elemento: string, opciones: XmlRootOpciones = {}) =>
  SetMetadata(XML_ROOT_KEY, { elemento, ...opciones });
