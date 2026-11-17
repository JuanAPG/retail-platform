import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ServiciosExternos } from '../common/http/servicios-externos.service';
import {
  Basico,
  coberturaDeTienda,
  coberturaDeZona,
  diasDeVigencia,
  Existencia,
  Faltante,
  faltantes,
  StoreCoverage,
  ZoneCoverage,
} from './cobertura';
import { ShortageQueryDto } from './dto/availability.dto';

interface ProductoCatalogo {
  id: string;
  nombre: string;
  esCanastaBasica: boolean;
  estatus: string;
  presentaciones?: Array<{ id: string; activo: boolean }>;
}

interface TiendaCatalogo {
  id: string;
  zonaId: string;
  activo: boolean;
}

/** Lista de faltantes. Trae `storeId` O `zoneId`, según el filtro (orden del XSD). */
export interface ShortageList {
  storeId?: string;
  zoneId?: string;
  validDays: number;
  data: Faltante[];
}

/**
 * Cobertura de básicos y faltantes (D-38). La canasta básica, las tiendas y
 * las zonas son de catalog-service: se piden por HTTP con el token de quien
 * consulta, nunca leyendo sus tablas. De Postgres solo se lee `inventario`,
 * que es de este servicio.
 */
@Injectable()
export class CoverageService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly externos: ServiciosExternos,
  ) {}

  async storeCoverage(storeId: string, token: string | undefined): Promise<StoreCoverage> {
    await this.exigir('tienda', `/v1/stores/${storeId}`, token);
    const basicos = await this.basicos(token);
    const existencias = await this.existencias([storeId], basicos);
    return coberturaDeTienda(storeId, basicos, existencias, new Date(), diasDeVigencia());
  }

  async zoneCoverage(zoneId: string, token: string | undefined): Promise<ZoneCoverage> {
    return (await this.zona(zoneId, token)).cobertura;
  }

  async shortages(query: ShortageQueryDto, token: string | undefined): Promise<ShortageList> {
    if (Boolean(query.storeId) === Boolean(query.zoneId)) {
      throw new BadRequestException('Manda exactamente uno: storeId o zoneId.');
    }
    const validDays = diasDeVigencia();
    if (query.storeId) {
      const tienda = await this.storeCoverage(query.storeId, token);
      return { storeId: query.storeId, validDays, data: faltantes([tienda]) };
    }
    const { porTienda } = await this.zona(query.zoneId!, token);
    return { zoneId: query.zoneId, validDays, data: faltantes(porTienda) };
  }

  private async zona(zoneId: string, token: string | undefined) {
    await this.exigir('zona', `/v1/zones/${zoneId}`, token);
    const tiendas = await this.externos.todasLasPaginas<TiendaCatalogo>('catalog-service', `${this.catalog()}/v1/stores`, token);
    const storeIds = tiendas.filter((t) => t.zonaId === zoneId && t.activo !== false).map((t) => t.id);
    const basicos = await this.basicos(token);
    const existencias = await this.existencias(storeIds, basicos);
    return coberturaDeZona(zoneId, storeIds, basicos, existencias, new Date(), diasDeVigencia());
  }

  /** Productos activos marcados como canasta básica (D-03), con sus presentaciones activas. */
  private async basicos(token: string | undefined): Promise<Basico[]> {
    const productos = await this.externos.todasLasPaginas<ProductoCatalogo>('catalog-service', `${this.catalog()}/v1/products`, token);
    return productos
      .filter((p) => p.esCanastaBasica === true && p.estatus === 'activo')
      .map((p) => ({
        productId: p.id,
        productName: p.nombre,
        presentationIds: (p.presentaciones ?? []).filter((pres) => pres.activo !== false).map((pres) => pres.id),
      }));
  }

  private async existencias(storeIds: string[], basicos: Basico[]): Promise<Existencia[]> {
    const presentaciones = basicos.flatMap((b) => b.presentationIds);
    if (storeIds.length === 0 || presentaciones.length === 0) return [];
    const filas: Array<Record<string, any>> = await this.dataSource.query( // eslint-disable-line @typescript-eslint/no-explicit-any
      `SELECT tienda_id, presentacion_id, stock_disponible, actualizado_en
         FROM inventario
        WHERE tienda_id = ANY($1::uuid[]) AND presentacion_id = ANY($2::uuid[])`,
      [storeIds, presentaciones],
    );
    return filas.map((f) => ({
      storeId: f.tienda_id,
      presentationId: f.presentacion_id,
      stock: Number(f.stock_disponible),
      capturedAt: f.actualizado_en,
    }));
  }

  /** 404 en catalog → 404 aquí; cualquier otra cosa que no sea 200 → 503. */
  private async exigir(que: 'tienda' | 'zona', ruta: string, token: string | undefined): Promise<void> {
    const { status } = await this.externos.obtener('catalog-service', `${this.catalog()}${ruta}`, token);
    if (status === 404) throw new NotFoundException(`No existe la ${que}.`);
    if (status !== 200) {
      throw new ServiceUnavailableException(`catalog-service no confirmó la ${que} (estado ${status}).`);
    }
  }

  private catalog(): string {
    return process.env.CATALOG_SERVICE_URL ?? 'http://catalog-service:3102';
  }
}
