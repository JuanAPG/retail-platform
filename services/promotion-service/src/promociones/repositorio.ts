import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { TipoPromocion, TipoUnidad } from './calculo';

export type EstatusPromocion = 'pendiente' | 'aprobada' | 'rechazada';
export type EventoPromocion = 'propuesta' | 'aprobada' | 'rechazada';
export type EstadoEntrega = 'enviado' | 'fallido' | 'no_aplica';

/** Una fila de `promociones` ya con tipos de JS (los NUMERIC llegan como texto). */
export interface PromocionFila {
  id: string;
  nombre: string;
  tipo: TipoPromocion;
  productoId: string;
  presentacionId: string;
  tiendaId: string | null;
  zonaId: string | null;
  descuentoPct: number | null;
  paqueteCantidad: number | null;
  paquetePrecio: number | null;
  empaqueContenido: number | null;
  empaqueUnidad: string | null;
  empaqueFactor: number | null;
  empaquePrecio: number | null;
  presentacionContenido: number;
  presentacionUnidad: string;
  presentacionFactor: number;
  unidadTipo: TipoUnidad;
  /** `YYYY-MM-DD` (se lee con `to_char`: un DATE como `Date` de JS se movería de día por la zona horaria). */
  vigenteDesde: string;
  vigenteHasta: string;
  estatus: EstatusPromocion;
  propuestoPor: string;
  propuestoEn: Date;
  resueltoPor: string | null;
  resueltoEn: Date | null;
  motivoRechazo: string | null;
}

export type PromocionNueva = Omit<PromocionFila, 'id' | 'estatus' | 'propuestoEn' | 'resueltoPor' | 'resueltoEn' | 'motivoRechazo'>;

export interface FiltroPromociones {
  status?: EstatusPromocion;
  type?: TipoPromocion;
  productId?: string;
  presentationId?: string;
  storeId?: string;
  zoneId?: string;
  activeOn?: string;
}

const COLUMNAS = `
  id, nombre, tipo, producto_id, presentacion_id, tienda_id, zona_id,
  descuento_pct::text, paquete_cantidad, paquete_precio::text,
  empaque_contenido::text, empaque_unidad, empaque_factor::text, empaque_precio::text,
  presentacion_contenido::text, presentacion_unidad, presentacion_factor::text, unidad_tipo,
  to_char(vigente_desde, 'YYYY-MM-DD') AS vigente_desde, to_char(vigente_hasta, 'YYYY-MM-DD') AS vigente_hasta,
  estatus, propuesto_por, propuesto_en, resuelto_por, resuelto_en, motivo_rechazo`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function aPromocion(f: Fila): PromocionFila {
  return {
    id: f.id,
    nombre: f.nombre,
    tipo: f.tipo,
    productoId: f.producto_id,
    presentacionId: f.presentacion_id,
    tiendaId: f.tienda_id,
    zonaId: f.zona_id,
    descuentoPct: num(f.descuento_pct),
    paqueteCantidad: num(f.paquete_cantidad),
    paquetePrecio: num(f.paquete_precio),
    empaqueContenido: num(f.empaque_contenido),
    empaqueUnidad: f.empaque_unidad,
    empaqueFactor: num(f.empaque_factor),
    empaquePrecio: num(f.empaque_precio),
    presentacionContenido: Number(f.presentacion_contenido),
    presentacionUnidad: f.presentacion_unidad,
    presentacionFactor: Number(f.presentacion_factor),
    unidadTipo: f.unidad_tipo,
    vigenteDesde: f.vigente_desde,
    vigenteHasta: f.vigente_hasta,
    estatus: f.estatus,
    propuestoPor: f.propuesto_por,
    propuestoEn: new Date(f.propuesto_en),
    resueltoPor: f.resuelto_por,
    resueltoEn: f.resuelto_en ? new Date(f.resuelto_en) : null,
    motivoRechazo: f.motivo_rechazo,
  };
}

/**
 * Errores de CONEXIÓN con PostgreSQL (no de datos): con ellos la operación
 * responde 503 (D-25), no 500. Clase SQLSTATE 08 (connection exception),
 * 57P0x (el servidor se apagó) o errores de red del driver.
 */
export function esCaidaDePostgres(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string; message?: string }; message?: string };
  const codigo = e?.driverError?.code ?? e?.code ?? '';
  const mensaje = `${e?.driverError?.message ?? ''} ${e?.message ?? ''}`;
  return (
    /^08/.test(codigo) ||
    /^57P0/.test(codigo) ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH'].includes(codigo) ||
    /Connection terminated|timeout exceeded when trying to connect|connect ECONNREFUSED|Connection lost/i.test(mensaje)
  );
}

/** Solo sus dos tablas: `promociones` y `promocion_eventos` (contrato §13). */
@Injectable()
export class RepositorioPromociones {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private async enBase<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (esCaidaDePostgres(error)) throw new ServiceUnavailableException('PostgreSQL no responde. Reintenta más tarde.');
      throw error;
    }
  }

  /** Inserta la promoción y su evento `propuesta` en una sola transacción. Devuelve la promoción y el id del evento. */
  crear(p: PromocionNueva, correlationId: string | null): Promise<{ promocion: PromocionFila; eventoId: string }> {
    return this.enBase(() =>
      this.db.transaction(async (m) => {
        const [fila] = await m.query(
          `INSERT INTO promociones (
             nombre, tipo, producto_id, presentacion_id, tienda_id, zona_id,
             descuento_pct, paquete_cantidad, paquete_precio,
             empaque_contenido, empaque_unidad, empaque_factor, empaque_precio,
             presentacion_contenido, presentacion_unidad, presentacion_factor, unidad_tipo,
             vigente_desde, vigente_hasta, propuesto_por, correlation_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::date,$19::date,$20,$21)
           RETURNING ${COLUMNAS}`,
          [
            p.nombre, p.tipo, p.productoId, p.presentacionId, p.tiendaId, p.zonaId,
            p.descuentoPct, p.paqueteCantidad, p.paquetePrecio,
            p.empaqueContenido, p.empaqueUnidad, p.empaqueFactor, p.empaquePrecio,
            p.presentacionContenido, p.presentacionUnidad, p.presentacionFactor, p.unidadTipo,
            p.vigenteDesde, p.vigenteHasta, p.propuestoPor, correlationId,
          ],
        );
        const eventoId = await this.evento(m, fila.id, 'propuesta', p.propuestoPor, correlationId);
        return { promocion: aPromocion(fila), eventoId };
      }),
    );
  }

  buscar(id: string): Promise<PromocionFila | null> {
    return this.enBase(async () => {
      const [fila] = await this.db.query(`SELECT ${COLUMNAS} FROM promociones WHERE id = $1`, [id]);
      return fila ? aPromocion(fila) : null;
    });
  }

  buscarVarias(ids: string[]): Promise<PromocionFila[]> {
    return this.enBase(async () => {
      const filas: Fila[] = await this.db.query(`SELECT ${COLUMNAS} FROM promociones WHERE id = ANY($1::uuid[])`, [ids]);
      return filas.map(aPromocion);
    });
  }

  listar(f: FiltroPromociones, page: number, limit: number): Promise<{ filas: PromocionFila[]; total: number }> {
    return this.enBase(async () => {
      const donde: string[] = [];
      const valores: unknown[] = [];
      const agregar = (sql: string, valor: unknown) => {
        valores.push(valor);
        donde.push(sql.replace('?', `$${valores.length}`));
      };
      if (f.status) agregar('estatus = ?', f.status);
      if (f.type) agregar('tipo = ?', f.type);
      if (f.productId) agregar('producto_id = ?', f.productId);
      if (f.presentationId) agregar('presentacion_id = ?', f.presentationId);
      if (f.storeId) agregar('tienda_id = ?', f.storeId);
      if (f.zoneId) agregar('zona_id = ?', f.zoneId);
      if (f.activeOn) {
        // §7: aprobadas vigentes ese día (días locales inclusivos).
        donde.push(`estatus = 'aprobada'`);
        agregar('vigente_desde <= ?::date', f.activeOn);
        agregar('vigente_hasta >= ?::date', f.activeOn);
      }
      const where = donde.length ? `WHERE ${donde.join(' AND ')}` : '';
      // §7: lo más reciente primero; con status=pendiente es una cola (lo más antiguo primero).
      const orden = f.status === 'pendiente' ? 'propuesto_en ASC, id ASC' : 'propuesto_en DESC, id ASC';
      const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM promociones ${where}`, valores);
      const filas: Fila[] = await this.db.query(
        `SELECT ${COLUMNAS} FROM promociones ${where} ORDER BY ${orden} LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        valores,
      );
      return { filas: filas.map(aPromocion), total };
    });
  }

  /**
   * Transición ATÓMICA (§5): solo pasa si sigue `pendiente` (y, al aprobar, si
   * no venció). Dos resoluciones a la vez: una pasa, la otra recibe `null`.
   */
  resolver(
    id: string,
    a: 'aprobada' | 'rechazada',
    actor: string,
    hoy: string,
    motivo: string | null,
    correlationId: string | null,
  ): Promise<{ promocion: PromocionFila; eventoId: string } | null> {
    return this.enBase(() =>
      this.db.transaction(async (m) => {
        const condicionVigencia = a === 'aprobada' ? 'AND vigente_hasta >= $4::date' : '';
        const valores: unknown[] = [id, actor, a === 'rechazada' ? motivo : null];
        if (a === 'aprobada') valores.push(hoy);
        const [fila] = await m.query(
          `UPDATE promociones
              SET estatus = '${a}', resuelto_por = $2, resuelto_en = now(), motivo_rechazo = $3
            WHERE id = $1 AND estatus = 'pendiente' ${condicionVigencia}
          RETURNING ${COLUMNAS}`,
          valores,
        );
        // Con UPDATE … RETURNING, TypeORM (pg) devuelve [filas, conteo].
        const actualizada = Array.isArray(fila) ? fila[0] : fila;
        if (!actualizada) return null;
        const eventoId = await this.evento(m, id, a, actor, correlationId);
        return { promocion: aPromocion(actualizada), eventoId };
      }),
    );
  }

  /** Lo que se sabe del evento después del intento de entrega (§14). Nunca lanza. */
  async marcarEntrega(
    eventoId: string,
    auditoria: { estado: EstadoEntrega; error: string | null },
    aviso: { estado: EstadoEntrega; error: string | null },
  ): Promise<void> {
    await this.db.query(
      `UPDATE promocion_eventos
          SET auditoria_estado = $2, auditoria_error = $3, aviso_estado = $4, aviso_error = $5
        WHERE id = $1`,
      [eventoId, auditoria.estado, auditoria.error, aviso.estado, aviso.error],
    );
  }

  private async evento(m: EntityManager, promocionId: string, evento: EventoPromocion, actor: string, correlationId: string | null): Promise<string> {
    const [fila] = await m.query(
      `INSERT INTO promocion_eventos (promocion_id, evento, actor_id, correlation_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [promocionId, evento, actor, correlationId],
    );
    return fila.id;
  }

  /** Para `GET /v1/health`. */
  ping(): Promise<unknown> {
    return this.db.query('SELECT 1');
  }
}
