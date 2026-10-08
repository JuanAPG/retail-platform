import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SesionUsuario } from '../common/auth/session.guard';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, Pagina } from '../common/dto/pagination.dto';
import { ROL } from '../common/roles';
import { PriceAlertsService } from '../price-alerts/price-alerts.service';
import { PricesService } from '../prices/prices.service';
import {
  ApprovePriceObservationDto,
  CreatePriceObservationDto,
  PriceObservationQueryDto,
  RejectPriceObservationDto,
} from './dto/price-observation.dto';

export interface PriceObservationDto {
  id: string;
  presentationId: string;
  storeId: string;
  price: string;
  observedAt: Date;
  lat: number | null;
  lng: number | null;
  status: string;
  /** Siempre `observado_en_campo`: así lo distinguen la bitácora y quien lo lee. */
  origin: 'observado_en_campo';
  rejectionReason: string | null;
  capturedBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  /** Precio que se creó al aprobar; `null` mientras está pendiente o si se rechazó. */
  priceId: string | null;
  createdAt: Date;
  presentation: { id: string; productoId: string; nombre: string; producto: { sku: string; nombre: string } };
  store: { id: string; nombre: string; zonaId: string };
}

/** Marca de origen que va en la bitácora (D-16: "que se audite como observado en campo"). */
const ORIGEN = 'observado_en_campo';

/**
 * PRI-09 / D-16 — Precios observados en tienda con la app móvil.
 *
 * Flujo: se capturan `pendiente` (no tocan el precio actual) → el Responsable de precios los aprueba, y entran al
 * historial como un precio normal (`origen = interno`, sin diferencia en el sistema), o los rechaza con motivo. La
 * bitácora sí los distingue: cada evento lleva `origen: observado_en_campo`, quién lo capturó y quién lo resolvió.
 */
@Injectable()
export class PriceObservationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditReporter,
    private readonly prices: PricesService,
    private readonly alertas: PriceAlertsService,
  ) {}

  async create(dto: CreatePriceObservationDto, solicitante: SesionUsuario, ip?: string, token?: string): Promise<PriceObservationDto> {
    const [fila] = await this.dataSource.query(
      `SELECT prod.estatus::text AS estatus FROM producto_presentaciones pres
       JOIN productos prod ON prod.id = pres.producto_id WHERE pres.id = $1`,
      [dto.presentationId],
    );
    if (!fila) throw new BadRequestException('La presentación indicada no existe.');
    const [tienda] = await this.dataSource.query('SELECT 1 FROM tiendas WHERE id = $1', [dto.storeId]);
    if (!tienda) throw new BadRequestException('La tienda indicada no existe.');
    // D-08: un producto pendiente o rechazado no existe para el resto hasta aprobarse.
    if (fila.estatus !== 'activo') throw new ConflictException('El producto no está activo: no se le pueden levantar precios.');

    const observadoEn = dto.observedAt ? new Date(dto.observedAt) : new Date();
    // Un margen de 5 minutos por relojes de teléfono desfasados; más allá, es una fecha futura.
    if (observadoEn.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException('observedAt no puede ser una fecha futura.');
    }
    if ((dto.lat === undefined) !== (dto.lng === undefined)) {
      throw new BadRequestException('lat y lng van juntas: manda las dos o ninguna.');
    }

    const [creada] = await this.dataSource.query(
      `INSERT INTO precios_observados (presentacion_id, tienda_id, precio, observado_en, latitud, longitud, capturado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [dto.presentationId, dto.storeId, dto.price, observadoEn, dto.lat ?? null, dto.lng ?? null, solicitante.id],
    );
    await this.audit.reportar(
      {
        tabla: 'precios_observados',
        registroId: creada.id,
        accion: 'insert',
        descripcion: `Precio observado en campo (${dto.price}) para la presentación ${dto.presentationId} en la tienda ${dto.storeId}.`,
        cambios: [
          { campo: 'origen', previo: null, posterior: ORIGEN },
          { campo: 'precio', previo: null, posterior: String(dto.price) },
          { campo: 'estatus', previo: null, posterior: 'pendiente' },
          { campo: 'capturado_por', previo: null, posterior: solicitante.id },
        ],
        ip: ip ?? null,
      },
      token,
    );
    return (await this.detallar([creada.id]))[0];
  }

  /** Un perfil con permiso ve todas; el Analista, solo las que capturó. Cola de trabajo: la más antigua primero. */
  async findAll(solicitante: SesionUsuario, filtros: PriceObservationQueryDto): Promise<Pagina<PriceObservationDto>> {
    const page = filtros.page ?? PAGINA_DEFAULT;
    const limit = Math.min(filtros.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filtros.status) { params.push(filtros.status); where.push(`po.estatus = $${params.length}`); }
    if (solicitante.rol === ROL.ANALISTA) { params.push(solicitante.id); where.push(`po.capturado_por = $${params.length}`); }
    const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [{ n }] = await this.dataSource.query(`SELECT count(*)::int AS n FROM precios_observados po ${cond}`, params);
    const orden = filtros.status === 'pendiente' ? 'ASC' : 'DESC';
    const ids: { id: string }[] = await this.dataSource.query(
      `SELECT po.id FROM precios_observados po ${cond} ORDER BY po.created_at ${orden}, po.id ASC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data: await this.detallar(ids.map((i) => i.id)), total: n, page, limit };
  }

  /**
   * Aprueba: el precio observado entra al historial como un precio normal (cierra el vigente de la misma
   * presentación y tienda, igual que `POST /prices`) y la observación queda `aprobado`. TODO en una transacción.
   */
  async approve(id: string, dto: ApprovePriceObservationDto, solicitante: SesionUsuario, ip?: string, token?: string): Promise<PriceObservationDto> {
    const obs = await this.buscarPendiente(id);
    const effectiveDate = (dto.effectiveDate ?? new Date().toISOString()).slice(0, 10);

    const { precio } = await this.dataSource.transaction(async (manager) => {
      // Atómico: solo cambia si SIGUE pendiente (otro revisor pudo ganar en medio).
      const [, afectadas] = await manager.query(
        `UPDATE precios_observados SET estatus = 'aprobado', revisado_por = $2, revisado_en = now()
         WHERE id = $1 AND estatus = 'pendiente'`,
        [id, solicitante.id],
      );
      if (!afectadas) throw new ConflictException('Esta observación ya fue resuelta por otro revisor.');

      const creado = await this.prices.registrarPrecio(manager, {
        presentationId: obs.presentacion_id,
        storeId: obs.tienda_id,
        price: String(obs.precio),
        effectiveDate,
        origen: 'interno', // D-16: "sin diferencia en el sistema"
        createdBy: solicitante.id,
      });
      await manager.query('UPDATE precios_observados SET precio_id = $2 WHERE id = $1', [id, creado.id]);
      return { precio: creado };
    });

    await this.audit.reportar(
      {
        tabla: 'precios_observados',
        registroId: id,
        accion: 'aprobar',
        descripcion: `Precio observado en campo aprobado (${obs.precio}).`,
        cambios: [
          { campo: 'origen', previo: null, posterior: ORIGEN },
          { campo: 'estatus', previo: 'pendiente', posterior: 'aprobado' },
          { campo: 'capturado_por', previo: null, posterior: obs.capturado_por },
          { campo: 'aprobado_por', previo: null, posterior: solicitante.id },
        ],
        ip: ip ?? null,
      },
      token,
    );
    await this.audit.reportar(
      {
        tabla: 'precios',
        registroId: precio.id,
        accion: 'insert',
        descripcion: `Precio registrado (${obs.precio}) por aprobación del precio observado ${id}.`,
        cambios: [
          { campo: 'origen', previo: null, posterior: ORIGEN },
          { campo: 'precio_anterior', previo: precio.precioPrevio, posterior: null },
          { campo: 'precio', previo: null, posterior: String(obs.precio) },
        ],
        ip: ip ?? null,
      },
      token,
    );

    const [aprobada] = await this.detallar([id]);
    await this.prices.invalidarProducto(aprobada.presentation.productoId);
    await this.alertas.evaluar(
      { presentationId: obs.presentacion_id, storeId: obs.tienda_id, nuevoPrecio: Number(obs.precio), effectiveDate },
      token,
    );
    return aprobada;
  }

  async reject(id: string, dto: RejectPriceObservationDto, solicitante: SesionUsuario, ip?: string, token?: string): Promise<PriceObservationDto> {
    const obs = await this.buscarPendiente(id);
    const [, afectadas] = await this.dataSource.query(
      `UPDATE precios_observados SET estatus = 'rechazado', motivo_rechazo = $2, revisado_por = $3, revisado_en = now()
       WHERE id = $1 AND estatus = 'pendiente'`,
      [id, dto.rejectionReason, solicitante.id],
    );
    if (!afectadas) throw new ConflictException('Esta observación ya fue resuelta por otro revisor.');

    await this.audit.reportar(
      {
        tabla: 'precios_observados',
        registroId: id,
        accion: 'rechazar',
        descripcion: `Precio observado en campo rechazado: ${dto.rejectionReason}`,
        cambios: [
          { campo: 'origen', previo: null, posterior: ORIGEN },
          { campo: 'estatus', previo: 'pendiente', posterior: 'rechazado' },
          { campo: 'motivo_rechazo', previo: null, posterior: dto.rejectionReason },
          { campo: 'capturado_por', previo: null, posterior: obs.capturado_por },
          { campo: 'rechazado_por', previo: null, posterior: solicitante.id },
        ],
        ip: ip ?? null,
      },
      token,
    );
    return (await this.detallar([id]))[0];
  }

  private async buscarPendiente(id: string) {
    const [obs] = await this.dataSource.query(
      'SELECT id, presentacion_id, tienda_id, precio::text AS precio, capturado_por, estatus::text AS estatus FROM precios_observados WHERE id = $1',
      [id],
    );
    if (!obs) throw new NotFoundException('El precio observado no existe.');
    if (obs.estatus !== 'pendiente') {
      throw new ConflictException(`Esta observación ya fue resuelta (estatus actual: ${obs.estatus}).`);
    }
    return obs as { id: string; presentacion_id: string; tienda_id: string; precio: string; capturado_por: string };
  }

  private async detallar(ids: string[]): Promise<PriceObservationDto[]> {
    if (ids.length === 0) return [];
    const filas: Record<string, any>[] = await this.dataSource.query(
      `SELECT po.id, po.presentacion_id, po.tienda_id, po.precio::text AS precio, po.observado_en,
              po.latitud::float AS lat, po.longitud::float AS lng, po.estatus::text AS estatus, po.motivo_rechazo,
              po.capturado_por, po.revisado_por, po.revisado_en, po.precio_id, po.created_at,
              pres.producto_id, pres.nombre AS pres_nombre, prod.sku, prod.nombre AS prod_nombre,
              t.nombre AS tienda_nombre, t.zona_id
       FROM precios_observados po
       JOIN producto_presentaciones pres ON pres.id = po.presentacion_id
       JOIN productos prod ON prod.id = pres.producto_id
       JOIN tiendas t ON t.id = po.tienda_id
       WHERE po.id = ANY($1::uuid[])`,
      [ids],
    );
    const porId = new Map<string, PriceObservationDto>();
    for (const f of filas) {
      porId.set(f.id, {
        id: f.id,
        presentationId: f.presentacion_id,
        storeId: f.tienda_id,
        price: f.precio,
        observedAt: f.observado_en,
        lat: f.lat ?? null,
        lng: f.lng ?? null,
        status: f.estatus,
        origin: ORIGEN,
        rejectionReason: f.motivo_rechazo ?? null,
        capturedBy: f.capturado_por,
        reviewedBy: f.revisado_por ?? null,
        reviewedAt: f.revisado_en ?? null,
        priceId: f.precio_id ?? null,
        createdAt: f.created_at,
        presentation: { id: f.presentacion_id, productoId: f.producto_id, nombre: f.pres_nombre, producto: { sku: f.sku, nombre: f.prod_nombre } },
        store: { id: f.tienda_id, nombre: f.tienda_nombre, zonaId: f.zona_id },
      });
    }
    return ids.map((id) => porId.get(id)).filter((o): o is PriceObservationDto => o !== undefined);
  }
}
