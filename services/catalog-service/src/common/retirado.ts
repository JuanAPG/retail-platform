import { ConflictException } from '@nestjs/common';

/**
 * D-35: los segmentos de ingreso y la clasificación de zonas pasaron a
 * income-segmentation-service (3112), que guarda versiones. catalog ya no escribe
 * `segmentos_ingreso` ni `zona_clasificaciones` (cada servicio escribe solo sus tablas):
 * las rutas viejas de escritura responden 409 diciendo a dónde ir. Las lecturas siguen.
 * Se usa 409 porque el catálogo de códigos (services/snippets/error-codes.md) no tiene uno
 * para 410; el mensaje deja claro que no es un dato duplicado.
 */
export function escrituraMovidaASegmentation(ruta: string): ConflictException {
  return new ConflictException(
    `Esta escritura ya no está en catalog-service: usa ${ruta} de income-segmentation-service (puerto 3112, D-35), que guarda la versión del segmento.`,
  );
}
