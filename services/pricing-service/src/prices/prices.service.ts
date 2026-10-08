import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SesionUsuario } from '../common/auth/session.guard';
import { ROL } from '../common/roles';
import { CacheService } from '../common/cache/cache.service';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, Pagina } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { PriceHistory } from '../entities/price-history.entity';
import { CreatePriceDto } from './dto/create-price.dto';
import { PriceAlertsService } from '../price-alerts/price-alerts.service';
import { PriceCurrentQueryDto, PriceHistoryQueryDto, PriceSeriesQueryDto } from './dto/price-queries.dto';

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

/** Vista por presentación (D-06): una fila por zona Y presentación, nunca un promedio entre tamaños distintos. */
export interface ZonePriceComparison {
  zoneId: string;
  zoneName: string;
  presentationId: string;
  presentationName: string;
  averagePrice: number;
  minPrice: number;
  maxPrice: number;
  storeCount: number;
}

/** Vista normalizada (D-06): precio por unidad base (kg, l, pza) para que tamaños distintos sean comparables. */
export interface ZoneUnitPriceComparison {
  zoneId: string;
  zoneName: string;
  baseUnit: string;
  averagePricePerBaseUnit: number;
  minPricePerBaseUnit: number;
  maxPricePerBaseUnit: number;
  storeCount: number;
}

export interface PriceComparisonResult {
  productId: string;
  zones: ZonePriceComparison[];
  perUnit: ZoneUnitPriceComparison[];
}

/**
 * PRI-05 (D-05): "precio actual" se define POR FECHA, no por la columna `vigente` (que solo dice "sin fecha de
 * fin"). Un precio programado a futuro tiene `vigente = true` desde que se registra, pero no aplica hasta su
 * fecha; y el anterior, ya cerrado con `hasta = desde_nuevo - 1`, sigue siendo el actual hasta entonces.
 */
export const ES_ACTUAL = (alias: string) =>
  `(${alias}.fecha_vigencia_desde <= CURRENT_DATE AND (${alias}.fecha_vigencia_hasta IS NULL OR ${alias}.fecha_vigencia_hasta >= CURRENT_DATE))`;

function codigoSql(err: unknown): string | undefined {
  return err instanceof QueryFailedError ? (err as unknown as { code?: string }).code : undefined;
}

/**
 * Caché de lecturas (Redis, prefijo `pricing:`). Se cachean el historial y la
 * comparación por zonas de un producto. Todo lo cacheado de un producto cuelga
 * de UNA versión (`pricing:v:<productId>`): registrar un precio sube la versión
 * y las llaves viejas quedan huérfanas hasta que caducan.
 *
 * El TTL de 5 min acota lo que la versión no ve: cambios que hace
 * catalog-service (renombrar una tienda o zona, mover una tienda de zona,
 * borrar una presentación) y que alteran lo que se muestra de un precio.
 */
export const TTL_PRECIOS_SEGUNDOS = 300;
export const llaveVersionProducto = (productId: string) => `pricing:v:${productId}`;

/** Un precio a insertar; lo comparten el alta directa y la aprobación de una propuesta. */
export interface NuevoPrecio {
  presentationId: string;
  storeId: string;
  price: string;
  effectiveDate: string;
  origen: 'interno' | 'propuesta_proveedor_aprobada';
  createdBy: string;
}

@Injectable()
export class PricesService {
  constructor(
    @InjectRepository(PriceHistory)
    private readonly pricesRepo: Repository<PriceHistory>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditReporter,
    private readonly cache: CacheService,
    private readonly alertas: PriceAlertsService,
  ) {}

  /**
   * Inserta un precio dentro de la transacción de quien llama. El histórico
   * nunca se sobrescribe (RN-06): si ya hay un precio vigente para esa
   * pareja, se cierra (se le pone `effectiveUntil` un día antes de la nueva
   * vigencia), porque el índice único `uq_precios_vigente` no permite dos
   * precios vigentes a la vez.
   *
   * @throws ConflictException si el vigente tiene fecha igual o posterior.
   */
  async registrarPrecio(
    manager: EntityManager,
    datos: NuevoPrecio,
  ): Promise<{ id: string; precioPrevio: string | null }> {
    const vigente = await manager.findOne(PriceHistory, {
      where: { presentationId: datos.presentationId, storeId: datos.storeId, vigente: true },
    });
    if (vigente) {
      if (vigente.effectiveDate >= datos.effectiveDate) {
        throw new ConflictException('Ya existe un precio vigente con fecha igual o posterior a la indicada.');
      }
      await manager.update(PriceHistory, { id: vigente.id }, { effectiveUntil: diaAnterior(datos.effectiveDate) });
    }

    const nuevo = await manager.save(manager.create(PriceHistory, datos));
    return { id: nuevo.id, precioPrevio: vigente?.price ?? null };
  }

  /** Invalida lo cacheado de un producto (historial y comparación). Llamar DESPUÉS de confirmar la escritura. */
  invalidarProducto(productId: string): Promise<void> {
    return this.cache.invalidarGrupo(llaveVersionProducto(productId));
  }

  /**
   * Registra un precio nuevo para presentación+tienda. El histórico
   * nunca se sobrescribe (RN-06): si ya hay un precio vigente para esa
   * pareja, se cierra (se le pone `effectiveUntil` un día antes de la
   * nueva vigencia) dentro de la misma transacción, porque el índice
   * único `uq_precios_vigente` no permite dos precios vigentes a la vez.
   */
  async create(dto: CreatePriceDto, solicitante: SesionUsuario, ip?: string, token?: string): Promise<PriceDto> {
    // Presentaciones y tiendas son de catalog-service: solo se verifica que existan.
    await this.exigirExistencia('producto_presentaciones', dto.presentationId, 'La presentación indicada no existe.');
    await this.exigirExistencia('tiendas', dto.storeId, 'La tienda indicada no existe.');
    await this.exigirProductoActivo(dto.presentationId);

    // Solo la fecha: un ISO con hora (2026-09-14T10:00:00Z) se normaliza a YYYY-MM-DD.
    const effectiveDate = (dto.effectiveDate ?? new Date().toISOString()).slice(0, 10);

    try {
      const { id, precioPrevio } = await this.dataSource.transaction((manager) =>
        this.registrarPrecio(manager, {
          presentationId: dto.presentationId,
          storeId: dto.storeId,
          price: String(dto.price),
          effectiveDate,
          origen: 'interno',
          createdBy: solicitante.id,
        }),
      );

      // Después de confirmar la transacción: la auditoría nunca rompe ni
      // retrasa de forma notable el alta (el reporter traga sus propios errores).
      await this.audit.reportar({
        tabla: 'precios',
        registroId: id,
        accion: 'insert',
        descripcion: `Precio registrado (${dto.price}) para presentación ${dto.presentationId} en tienda ${dto.storeId}.`,
        // El precio anterior se cierra, no se sobrescribe: queda como previo.
        cambios: [
          { campo: 'precio_anterior', previo: precioPrevio, posterior: null },
          { campo: 'precio', previo: null, posterior: String(dto.price) },
        ],
        ip: ip ?? null,
      }, token);

      const [creado] = await this.detallar([id]);
      // El historial y la comparación cacheados de este producto ya no valen.
      await this.invalidarProducto(creado.presentation.productoId);
      // PRI-07: ¿el cambio acumulado en la ventana cruza el umbral? Avisa al Responsable de precios.
      await this.alertas.evaluar(
        { presentationId: dto.presentationId, storeId: dto.storeId, nuevoPrecio: dto.price, effectiveDate },
        token,
      );
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
    const page = filtros.page ?? PAGINA_DEFAULT;
    const limit = Math.min(filtros.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);
    const version = await this.cache.version(llaveVersionProducto(filtros.productId));
    const clave = `pricing:history:${filtros.productId}:v${version}:${filtros.presentationId ?? 'all'}:p${page}:l${limit}`;

    // La existencia del producto se verifica dentro de la carga: un 404 no se cachea.
    return this.cache.obtener(clave, TTL_PRECIOS_SEGUNDOS, () => this.consultarHistorial(filtros));
  }

  private async consultarHistorial(filtros: PriceHistoryQueryDto): Promise<Pagina<PriceDto>> {
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
  async compareAcrossZones(productId: string, solicitante: SesionUsuario): Promise<PriceComparisonResult> {
    // Un Proveedor solo compara lo suyo; el producto de otro es un 404, no un 403,
    // para no confirmar que existe. Va ANTES de la caché: la respuesta cacheada
    // es la misma para todos y no debe saltarse esta regla.
    if (solicitante.rol === ROL.PROVEEDOR) await this.exigirProductoDelProveedor(productId, solicitante);
    const version = await this.cache.version(llaveVersionProducto(productId));
    return this.cache.obtener(`pricing:compare:${productId}:v${version}`, TTL_PRECIOS_SEGUNDOS, () =>
      this.consultarComparacion(productId),
    );
  }

  private async consultarComparacion(productId: string): Promise<PriceComparisonResult> {
    await this.exigirProducto(productId);

    const filas: Record<string, string>[] = await this.dataSource.query(
      `
      SELECT z.id AS "zoneId", z.nombre AS "zoneName",
             pres.id AS "presentationId", pres.nombre AS "presentationName",
             AVG(p.precio) AS "averagePrice", MIN(p.precio) AS "minPrice",
             MAX(p.precio) AS "maxPrice", COUNT(DISTINCT p.tienda_id) AS "storeCount"
      FROM precios p
      JOIN producto_presentaciones pres ON pres.id = p.presentacion_id
      JOIN tiendas t ON t.id = p.tienda_id
      JOIN zonas z ON z.id = t.zona_id
      WHERE pres.producto_id = $1 AND ${ES_ACTUAL('p')}
      GROUP BY z.id, z.nombre, pres.id, pres.nombre
      ORDER BY z.nombre ASC, pres.nombre ASC
      `,
      [productId],
    );

    // Precio por unidad base = precio / (contenido x factor a la unidad base de su tipo).
    // Se agrupa también por tipo de unidad: kg y l no se mezclan.
    const porUnidad: Record<string, string>[] = await this.dataSource.query(
      `
      SELECT z.id AS "zoneId", z.nombre AS "zoneName",
             (SELECT b.clave FROM unidades_medida b WHERE b.tipo = u.tipo AND b.factor_base = 1 LIMIT 1) AS "baseUnit",
             AVG(p.precio / (pres.contenido * u.factor_base)) AS "averagePricePerBaseUnit",
             MIN(p.precio / (pres.contenido * u.factor_base)) AS "minPricePerBaseUnit",
             MAX(p.precio / (pres.contenido * u.factor_base)) AS "maxPricePerBaseUnit",
             COUNT(DISTINCT p.tienda_id) AS "storeCount"
      FROM precios p
      JOIN producto_presentaciones pres ON pres.id = p.presentacion_id
      JOIN unidades_medida u ON u.id = pres.unidad_medida_id
      JOIN tiendas t ON t.id = p.tienda_id
      JOIN zonas z ON z.id = t.zona_id
      WHERE pres.producto_id = $1 AND ${ES_ACTUAL('p')}
      GROUP BY z.id, z.nombre, u.tipo
      ORDER BY z.nombre ASC
      `,
      [productId],
    );

    return {
      productId,
      zones: filas.map((fila) => ({
        zoneId: fila.zoneId,
        zoneName: fila.zoneName,
        presentationId: fila.presentationId,
        presentationName: fila.presentationName,
        averagePrice: Number(fila.averagePrice),
        minPrice: Number(fila.minPrice),
        maxPrice: Number(fila.maxPrice),
        storeCount: Number(fila.storeCount),
      })),
      perUnit: porUnidad.map((fila) => ({
        zoneId: fila.zoneId,
        zoneName: fila.zoneName,
        baseUnit: fila.baseUnit,
        averagePricePerBaseUnit: redondear(Number(fila.averagePricePerBaseUnit)),
        minPricePerBaseUnit: redondear(Number(fila.minPricePerBaseUnit)),
        maxPricePerBaseUnit: redondear(Number(fila.maxPricePerBaseUnit)),
        storeCount: Number(fila.storeCount),
      })),
    };
  }

  /**
   * PRI-05 / PRI-11 — El precio ACTUAL (por fecha) de una presentación, uno por tienda. Lo usan
   * decision-service y algorithms-core en vez de leer `precios.vigente` por SQL (esa columna no mira fechas).
   */
  async findCurrent(filtros: PriceCurrentQueryDto): Promise<Pagina<PriceDto>> {
    await this.exigirExistencia('producto_presentaciones', filtros.presentationId, 'La presentación indicada no existe.');
    const page = filtros.page ?? PAGINA_DEFAULT;
    const limit = Math.min(filtros.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);

    const where = [`p.presentacion_id = $1`, ES_ACTUAL('p')];
    const params: unknown[] = [filtros.presentationId];
    if (filtros.storeId) { params.push(filtros.storeId); where.push(`p.tienda_id = $${params.length}`); }
    if (filtros.zoneId) { params.push(filtros.zoneId); where.push(`t.zona_id = $${params.length}`); }
    const desde = `FROM precios p JOIN tiendas t ON t.id = p.tienda_id WHERE ${where.join(' AND ')}`;

    const [{ n }] = await this.dataSource.query(`SELECT count(*)::int AS n ${desde}`, params);
    const filas: { id: string }[] = await this.dataSource.query(
      `SELECT p.id ${desde} ORDER BY t.nombre ASC, p.id ASC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data: await this.detallar(filas.map((f) => f.id)), total: n, page, limit };
  }

  /**
   * PRI-11 — Serie COMPLETA de precios de una presentación (todas las tiendas, con zona y rango de vigencia),
   * sin paginar: es lo que necesita la elasticidad para armar un periodo, y `history` topa en 100 por página.
   * Excepción declarada en `paginacion.md`. Orden: fecha de inicio, tienda.
   */
  async findSeries(filtros: PriceSeriesQueryDto): Promise<{ data: PriceDto[]; total: number }> {
    await this.exigirExistencia('producto_presentaciones', filtros.presentationId, 'La presentación indicada no existe.');
    if (filtros.dateFrom && filtros.dateTo && filtros.dateFrom > filtros.dateTo) {
      throw new BadRequestException('dateFrom no puede ser posterior a dateTo.');
    }
    const params: unknown[] = [filtros.presentationId];
    const where = ['p.presentacion_id = $1'];
    // Un precio entra si su vigencia se cruza con [dateFrom, dateTo].
    if (filtros.dateFrom) { params.push(filtros.dateFrom); where.push(`(p.fecha_vigencia_hasta IS NULL OR p.fecha_vigencia_hasta >= $${params.length}::date)`); }
    if (filtros.dateTo) { params.push(filtros.dateTo); where.push(`p.fecha_vigencia_desde <= $${params.length}::date`); }
    const filas: { id: string }[] = await this.dataSource.query(
      `SELECT p.id FROM precios p JOIN tiendas t ON t.id = p.tienda_id
       WHERE ${where.join(' AND ')} ORDER BY p.fecha_vigencia_desde ASC, t.nombre ASC, p.id ASC`,
      params,
    );
    const data = await this.detallar(filas.map((f) => f.id));
    return { data, total: data.length };
  }

  // -------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------

  /**
   * Arma la forma del contrato (precio + resumen de presentación y tienda)
   * para los ids dados, conservando su orden. Una sola consulta con joins a
   * las tablas de catalog-service, que aquí solo se leen. Es pública porque la
   * aprobación de propuestas de precio devuelve los precios que crea.
   */
  async detallar(ids: string[]): Promise<PriceDto[]> {
    if (ids.length === 0) return [];
    const filas: Record<string, unknown>[] = await this.dataSource.query(
      `
      SELECT p.id, p.presentacion_id, p.tienda_id, p.precio::text AS precio,
             to_char(p.fecha_vigencia_desde, 'YYYY-MM-DD') AS desde,
             to_char(p.fecha_vigencia_hasta, 'YYYY-MM-DD') AS hasta,
             ${ES_ACTUAL('p')} AS vigente, p.origen::text AS origen, p.creado_por, p.created_at,
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

  /** D-08: un producto pendiente o rechazado no existe para el resto hasta aprobarse. */
  async exigirProductoActivo(presentationId: string) {
    const [fila] = await this.dataSource.query(
      `SELECT prod.estatus::text AS estatus
       FROM producto_presentaciones pres JOIN productos prod ON prod.id = pres.producto_id
       WHERE pres.id = $1`,
      [presentationId],
    );
    if (fila && fila.estatus !== 'activo') {
      throw new ConflictException('El producto no está activo: no se le pueden registrar precios.');
    }
  }

  private async exigirProductoDelProveedor(productId: string, solicitante: SesionUsuario) {
    const [fila] = await this.dataSource.query(
      `SELECT 1 FROM productos prod JOIN proveedores pr ON pr.id = prod.proveedor_id
       WHERE prod.id = $1 AND pr.email = $2`,
      [productId, solicitante.email],
    );
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

/** Precio por unidad base a 2 decimales (centavos), para no devolver 396.0000001. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

function diaAnterior(fechaIso: string): string {
  const fecha = new Date(`${fechaIso.slice(0, 10)}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - 1);
  return fecha.toISOString().slice(0, 10);
}
