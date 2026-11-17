import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ClassificationsService } from '../classifications/classifications.service';
import { ServiciosExternos } from '../common/http/servicios-externos.service';
import { PublicationQueryDto } from './dto/publication.dto';
import { evaluarPublicacion, ReglaPublicacion, umbralesDelEntorno } from './publicacion';

/** Una combinación zona-segmento. El orden de los campos es el del XSD. */
export interface ZoneSegmentPublication {
  zoneId: string;
  segmentId: number;
  segmentCode: string;
  segmentVersion: number;
  transactions: number;
  stores: number;
  disponible: boolean;
  motivo: string | null;
  /** Solo cuando `disponible`: si no, `null` (nunca un número, D-36). */
  averageTicket: number | null;
}

export interface PublicationResponse {
  minTransactions: number;
  minStores: number;
  rule: ReglaPublicacion;
  data: ZoneSegmentPublication[];
}

interface TiendaCatalogo {
  id: string;
  zonaId: string;
}

/**
 * D-36: para cada zona con clasificación vigente dice si su combinación
 * zona-segmento tiene datos suficientes para publicar un agregado, y publica
 * el ticket promedio solo cuando sí.
 *
 * Las transacciones son de core-process y las tiendas de catalog: se piden
 * por HTTP (nunca leyendo sus tablas), con el token de quien consulta. Solo
 * se manejan conteos por zona: nada de una persona ni de una compra.
 */
@Injectable()
export class PublicationService {
  constructor(
    private readonly classifications: ClassificationsService,
    private readonly externos: ServiciosExternos,
  ) {}

  async zoneSegments(query: PublicationQueryDto, token: string | undefined): Promise<PublicationResponse> {
    if (query.dateFrom && query.dateTo && query.dateFrom > query.dateTo) {
      throw new BadRequestException('dateFrom no puede ser posterior a dateTo.');
    }
    const umbrales = umbralesDelEntorno();
    const vigentes = await this.classifications.vigentes(query.zoneId);
    const respuesta: PublicationResponse = {
      minTransactions: umbrales.minTransacciones,
      minStores: umbrales.minTiendas,
      rule: umbrales.regla,
      data: [],
    };
    if (vigentes.length === 0) return respuesta;

    const catalog = process.env.CATALOG_SERVICE_URL ?? 'http://catalog-service:3102';
    const tiendas = await this.externos.todasLasPaginas<TiendaCatalogo>('catalog-service', `${catalog}/v1/stores`, token);
    const periodo = new URLSearchParams();
    if (query.dateFrom) periodo.set('dateFrom', query.dateFrom);
    if (query.dateTo) periodo.set('dateTo', query.dateTo);

    respuesta.data = await Promise.all(
      vigentes.map(async (clasificacion) => {
        const deLaZona = tiendas.filter((tienda) => tienda.zonaId === clasificacion.zoneId);
        const [transactions, conVentas] = await Promise.all([
          this.contarTransacciones({ zoneId: clasificacion.zoneId }, periodo, token),
          Promise.all(deLaZona.map((tienda) => this.contarTransacciones({ storeId: tienda.id }, periodo, token))),
        ]);
        const stores = conVentas.filter((total) => total > 0).length;
        const { disponible, motivo } = evaluarPublicacion(transactions, stores, umbrales);
        return {
          zoneId: clasificacion.zoneId,
          segmentId: clasificacion.segmentId,
          segmentCode: clasificacion.segmentCode,
          segmentVersion: clasificacion.segmentVersion,
          transactions,
          stores,
          disponible,
          motivo,
          // El agregado solo se pide (y solo sale) si se puede publicar.
          averageTicket: disponible ? await this.ticketPromedio(clasificacion.zoneId, periodo, token) : null,
        };
      }),
    );
    return respuesta;
  }

  /** `total` del listado paginado de core-process: no se traen las transacciones, solo cuántas son. */
  private async contarTransacciones(
    filtro: { zoneId?: string; storeId?: string },
    periodo: URLSearchParams,
    token: string | undefined,
  ): Promise<number> {
    const parametros = new URLSearchParams(periodo);
    Object.entries(filtro).forEach(([clave, valor]) => parametros.set(clave, valor));
    parametros.set('limit', '1');
    const { status, cuerpo } = await this.externos.obtener<{ total: number }>(
      'core-process-service',
      `${this.coreProcess()}/v1/transactions?${parametros.toString()}`,
      token,
    );
    if (status !== 200 || typeof cuerpo?.total !== 'number') {
      throw new ServiceUnavailableException(`core-process-service no devolvió el conteo de transacciones (estado ${status}).`);
    }
    return cuerpo.total;
  }

  private async ticketPromedio(zoneId: string, periodo: URLSearchParams, token: string | undefined): Promise<number> {
    const parametros = new URLSearchParams(periodo);
    parametros.set('zoneId', zoneId);
    const { status, cuerpo } = await this.externos.obtener<number>(
      'core-process-service',
      `${this.coreProcess()}/v1/analytics/average-ticket?${parametros.toString()}`,
      token,
    );
    if (status !== 200 || typeof cuerpo !== 'number' || !Number.isFinite(cuerpo)) {
      throw new ServiceUnavailableException(`core-process-service no devolvió el ticket promedio (estado ${status}).`);
    }
    return cuerpo;
  }

  private coreProcess(): string {
    return process.env.CORE_PROCESS_SERVICE_URL ?? 'http://core-process-service:3104';
  }
}
