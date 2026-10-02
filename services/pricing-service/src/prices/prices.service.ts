import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { Pagina } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { PriceHistory } from '../entities/price-history.entity';
import { CreatePriceDto } from './dto/create-price.dto';
import { PriceHistoryQueryDto } from './dto/price-queries.dto';

/** Un precio con el resumen de su presentación y su tienda (ver contrato). */
export interface PriceDto {
  id: string;
  presentationId: string;
  storeId: string;
  price: string;
  effectiveDate: string;
  effectiveUntil: string | null;
  vigente: boolean;
  origen: string;
  createdBy: string | null;
  createdAt: Date;
  presentation: { id: string; productoId: string; nombre: string; contenido: string; unidadMedida: string };
  store: { id: string; nombre: string; zonaId: string; zona: { id: string; nombre: string } };
}

export interface ZonePriceComparison {
  zoneId: string;
  zoneName: string;
  averagePrice: number;
  minPrice: number;
  maxPrice: number;
  storeCount: number;
}

export interface PriceComparisonResult {
  productId: string;
  zones: ZonePriceComparison[];
}

function codigoSql(err: unknown): string | undefined {
  return err instanceof QueryFailedError ? (err as unknown as { code?: string }).code : undefined;
}

// TODO(audit): reportar el insert de cada precio a auditoría cuando se acuerde
// con audit-service (pendiente en el contrato).
@Injectable()
export class PricesService {
  constructor(
    @InjectRepository(PriceHistory)
    private readonly pricesRepo: Repository<PriceHistory>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Registra un precio nuevo para presentación+tienda. El histórico
   * nunca se sobrescribe (RN-06): si ya hay un precio vigente para esa
   * pareja, se cierra (se le pone `effectiveUntil` un día antes de la
   * nueva vigencia) dentro de la misma transacción, porque el índice
   * único `uq_precios_vigente` no permite dos precios vigentes a la vez.
   */
  async create(dto: CreatePriceDto, solicitante: SesionUsuario): Promise<PriceDto> {
    // Presentaciones y tiendas son de catalog-service: solo se verifica que existan.
    await this.exigirExistencia('producto_presentaciones', dto.presentationId, 'La presentación indicada no existe.');
    await this.exigirExistencia('tiendas', dto.storeId, 'La tienda indicada no existe.');

    // Solo la fecha: un ISO con hora (2026-09-14T10:00:00Z) se normaliza a YYYY-MM-DD.
    const effectiveDate = (dto.effectiveDate ?? new Date().toISOString()).slice(0, 10);

    try {
      const id = await this.dataSource.transaction(async (manager) => {
        const vigente = await manager.findOne(PriceHistory, {
          where: { presentationId: dto.presentationId, storeId: dto.storeId, vigente: true },
        });
        if (vigente) {
          if (vigente.effectiveDate >= effectiveDate) {
            throw new ConflictException('Ya existe un precio vigente con fecha igual o posterior a la indicada.');
          }
          await manager.update(PriceHistory, { id: vigente.id }, { effectiveUntil: diaAnterior(effectiveDate) });
        }

        const nuevo = await manager.save(
          manager.create(PriceHistory, {
            presentationId: dto.presentationId,
            storeId: dto.storeId,
            price: String(dto.price),
            effectiveDate,
            origen: 'interno',
            createdBy: solicitante.id,
          }),
        );
        return nuevo.id;
      });

      const [creado] = await this.detallar([id]);
      return creado;
    } catch (err) {
      // 23505 = unique_violation: otra petición registró un precio vigente
      // para la misma pareja entre la lectura y la escritura.
      if (codigoSql(err) === '23505') {
        throw new ConflictException('Otro precio se registró al mismo tiempo para esta presentación y tienda. Reintenta.');
      }
      throw err;
    }
  }

  /**
   * Histórico de precios de un producto (todas sus presentaciones), o de
   * una presentación específica. Paginado; lo más reciente primero.
   */
  async findHistory(filtros: PriceHistoryQueryDto): Promise<Pagina<PriceDto>> {
    await this.exigirProducto(filtros.productId);

    const qb = this.pricesRepo
      .createQueryBuilder('p')
      .innerJoin('producto_presentaciones', 'pres', 'pres.id = p.presentacion_id')
      .where('pres.producto_id = :productId', { productId: filtros.productId })
      .orderBy('p.effectiveDate', 'DESC')
      .addOrderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'DESC');
    if (filtros.presentationId) {
      qb.andWhere('p.presentationId = :presentationId', { presentationId: filtros.presentationId });
    }

    const pagina = await paginar(qb, filtros);
    const detalle = await this.detallar(pagina.data.map((p) => p.id));
    return { ...pagina, data: detalle };
  }

  /**
   * Compara el precio VIGENTE de un producto entre las zonas donde se
   * vende. La zona no vive en `precios`: se deriva de `tiendas.zona_id`.
   */
  async compareAcrossZones(productId: string): Promise<PriceComparisonResult> {
    await this.exigirProducto(productId);

    const filas: Record<string, string>[] = await this.dataSource.query(
      `
      SELECT z.id AS "zoneId", z.nombre AS "zoneName",
             AVG(p.precio) AS "averagePrice", MIN(p.precio) AS "minPrice",
             MAX(p.precio) AS "maxPrice", COUNT(DISTINCT p.tienda_id) AS "storeCount"
      FROM precios p
      JOIN producto_presentaciones pres ON pres.id = p.presentacion_id
      JOIN tiendas t ON t.id = p.tienda_id
      JOIN zonas z ON z.id = t.zona_id
      WHERE pres.producto_id = $1 AND p.vigente
      GROUP BY z.id, z.nombre
      ORDER BY z.nombre ASC
      `,
      [productId],
    );
    return {
      productId,
      zones: filas.map((fila) => ({
        zoneId: fila.zoneId,
        zoneName: fila.zoneName,
        averagePrice: Number(fila.averagePrice),
        minPrice: Number(fila.minPrice),
        maxPrice: Number(fila.maxPrice),
        storeCount: Number(fila.storeCount),
      })),
    };
  }

  // -------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------

  /**
   * Arma la forma del contrato (precio + resumen de presentación y tienda)
   * para los ids dados, conservando su orden. Una sola consulta con joins a
   * las tablas de catalog-service, que aquí solo se leen.
   */
  private async detallar(ids: string[]): Promise<PriceDto[]> {
    if (ids.length === 0) return [];
    const filas: Record<string, unknown>[] = await this.dataSource.query(
      `
      SELECT p.id, p.presentacion_id, p.tienda_id, p.precio::text AS precio,
             to_char(p.fecha_vigencia_desde, 'YYYY-MM-DD') AS desde,
             to_char(p.fecha_vigencia_hasta, 'YYYY-MM-DD') AS hasta,
             p.vigente, p.origen::text AS origen, p.creado_por, p.created_at,
             pres.producto_id, pres.nombre AS pres_nombre, pres.contenido::text AS contenido,
             u.clave AS unidad,
             t.nombre AS tienda_nombre, t.zona_id, z.nombre AS zona_nombre
      FROM precios p
      JOIN producto_presentaciones pres ON pres.id = p.presentacion_id
      JOIN unidades_medida u ON u.id = pres.unidad_medida_id
      JOIN tiendas t ON t.id = p.tienda_id
      JOIN zonas z ON z.id = t.zona_id
      WHERE p.id = ANY($1::uuid[])
      `,
      [ids],
    );

    const porId = new Map<string, PriceDto>();
    for (const f of filas) {
      porId.set(f.id as string, {
        id: f.id as string,
        presentationId: f.presentacion_id as string,
        storeId: f.tienda_id as string,
        price: f.precio as string,
        effectiveDate: f.desde as string,
        effectiveUntil: (f.hasta as string | null) ?? null,
        vigente: f.vigente as boolean,
        origen: f.origen as string,
        createdBy: (f.creado_por as string | null) ?? null,
        createdAt: f.created_at as Date,
        presentation: {
          id: f.presentacion_id as string,
          productoId: f.producto_id as string,
          nombre: f.pres_nombre as string,
          contenido: f.contenido as string,
          unidadMedida: f.unidad as string,
        },
        store: {
          id: f.tienda_id as string,
          nombre: f.tienda_nombre as string,
          zonaId: f.zona_id as string,
          zona: { id: f.zona_id as string, nombre: f.zona_nombre as string },
        },
      });
    }
    return ids.map((id) => porId.get(id)).filter((p): p is PriceDto => p !== undefined);
  }

  private async exigirProducto(productId: string) {
    const [fila] = await this.dataSource.query('SELECT 1 FROM productos WHERE id = $1', [productId]);
    if (!fila) {
      throw new NotFoundException('El producto no existe.');
    }
  }

  private async exigirExistencia(tabla: 'producto_presentaciones' | 'tiendas', id: string, mensaje: string) {
    const [fila] = await this.dataSource.query(`SELECT 1 FROM ${tabla} WHERE id = $1`, [id]);
    if (!fila) {
      throw new BadRequestException(mensaje);
    }
  }
}

function diaAnterior(fechaIso: string): string {
  const fecha = new Date(`${fechaIso.slice(0, 10)}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - 1);
  return fecha.toISOString().slice(0, 10);
}
