import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Estado, EVENTO, Metrica, Unidad } from './reglas';

export type EstadoEntrega = 'enviado' | 'fallido' | 'no_aplica';

/** Una fila de `recomendacion_seguimientos` con tipos de JS. */
export interface SeguimientoFila {
  id: string;
  recomendacionId: string;
  estado: Estado;
  asignadoA: string;
  asignadoPor: string;
  asignadoEn: Date;
  /** `YYYY-MM-DD` (se lee con `to_char`: un DATE como `Date` de JS se movería de día). */
  fechaCompromiso: string | null;
  notaAsignacion: string | null;
  iniciadoEn: Date | null;
  implementadoEl: string | null;
  implementadoEn: Date | null;
  notaImplementacion: string | null;
  evaluadoPor: string | null;
  evaluadoEn: Date | null;
  evaluacion: {
    metrica: Metrica;
    unidad: Unidad;
    zonaId: string | null;
    tiendaId: string | null;
    presentacionId: string | null;
    antes: { desde: string; hasta: string; valor: number };
    despues: { desde: string; hasta: string; valor: number };
    variacionPct: number;
    fuente: string;
    comentario: string | null;
  } | null;
}

export interface EventoFila {
  evento: 'asignada' | 'iniciada' | 'implementada' | 'evaluada';
  estadoPrevio: Estado | null;
  estadoNuevo: Estado;
  actorId: string;
  ocurridoEn: Date;
  correlationId: string | null;
  auditoria: 'enviado' | 'fallido' | 'pendiente' | 'no_aplica';
  aviso: 'enviado' | 'fallido' | 'pendiente' | 'no_aplica';
}

const COLUMNAS = `
  id, recomendacion_id, estado, asignado_a, asignado_por, asignado_en,
  to_char(fecha_compromiso, 'YYYY-MM-DD') AS fecha_compromiso, nota_asignacion, iniciado_en,
  to_char(implementado_el, 'YYYY-MM-DD') AS implementado_el, implementado_en, nota_implementacion,
  evaluado_por, evaluado_en, metrica, unidad, alcance_zona_id, alcance_tienda_id, alcance_presentacion_id,
  to_char(antes_desde, 'YYYY-MM-DD') AS antes_desde, to_char(antes_hasta, 'YYYY-MM-DD') AS antes_hasta, antes_valor::text,
  to_char(despues_desde, 'YYYY-MM-DD') AS despues_desde, to_char(despues_hasta, 'YYYY-MM-DD') AS despues_hasta, despues_valor::text,
  variacion_pct::text, fuente, comentario`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fila = Record<string, any>;

const fecha = (v: unknown): Date | null => (v ? new Date(v as string) : null);

function aSeguimiento(f: Fila): SeguimientoFila {
  return {
    id: f.id,
    recomendacionId: f.recomendacion_id,
    estado: f.estado,
    asignadoA: f.asignado_a,
    asignadoPor: f.asignado_por,
    asignadoEn: new Date(f.asignado_en),
    fechaCompromiso: f.fecha_compromiso,
    notaAsignacion: f.nota_asignacion,
    iniciadoEn: fecha(f.iniciado_en),
    implementadoEl: f.implementado_el,
    implementadoEn: fecha(f.implementado_en),
    notaImplementacion: f.nota_implementacion,
    evaluadoPor: f.evaluado_por,
    evaluadoEn: fecha(f.evaluado_en),
    evaluacion: f.metrica
      ? {
          metrica: f.metrica,
          unidad: f.unidad,
          zonaId: f.alcance_zona_id,
          tiendaId: f.alcance_tienda_id,
          presentacionId: f.alcance_presentacion_id,
          antes: { desde: f.antes_desde, hasta: f.antes_hasta, valor: Number(f.antes_valor) },
          despues: { desde: f.despues_desde, hasta: f.despues_hasta, valor: Number(f.despues_valor) },
          variacionPct: Number(f.variacion_pct),
          fuente: f.fuente,
          comentario: f.comentario,
        }
      : null,
  };
}

/** Errores de CONEXIÓN con PostgreSQL (no de datos): con ellos se responde 503 (D-25). */
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

/** Marca para "el instante del servidor" (`now()` de Postgres) en una transición. */
export const AHORA = Symbol('now()');

/** Columnas que fija cada transición (más `estado`), con sus valores. */
export type Cambios = Record<string, unknown>;

/** Solo sus dos tablas (contrato §11). */
@Injectable()
export class RepositorioSeguimientos {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private async enBase<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (esCaidaDePostgres(error)) throw new ServiceUnavailableException('PostgreSQL no responde. Reintenta más tarde.');
      throw error;
    }
  }

  /**
   * Crea el seguimiento si la recomendación no tiene uno (llave única
   * `recomendacion_id`, §5). Si ya existe —también si otra asignación
   * simultánea ganó— devuelve el existente con `creado: false`.
   */
  asignar(
    d: { recomendacionId: string; asignadoA: string; asignadoPor: string; fechaCompromiso: string | null; nota: string | null },
    correlationId: string | null,
  ): Promise<{ creado: true; seguimiento: SeguimientoFila; eventoId: string } | { creado: false; seguimiento: SeguimientoFila }> {
    return this.enBase(() =>
      this.db.transaction(async (m) => {
        const [fila] = await m.query(
          `INSERT INTO recomendacion_seguimientos
             (recomendacion_id, asignado_a, asignado_por, fecha_compromiso, nota_asignacion, correlation_id)
           VALUES ($1, $2, $3, $4::date, $5, $6)
           ON CONFLICT (recomendacion_id) DO NOTHING
           RETURNING ${COLUMNAS}`,
          [d.recomendacionId, d.asignadoA, d.asignadoPor, d.fechaCompromiso, d.nota, correlationId],
        );
        if (!fila) {
          // La otra asignación ya terminó (la llave única esperó su COMMIT): se lee la suya.
          const [existente] = await m.query(`SELECT ${COLUMNAS} FROM recomendacion_seguimientos WHERE recomendacion_id = $1`, [d.recomendacionId]);
          return { creado: false as const, seguimiento: aSeguimiento(existente) };
        }
        const eventoId = await this.evento(m, fila.id, null, 'asignada', d.asignadoPor, correlationId);
        return { creado: true as const, seguimiento: aSeguimiento(fila), eventoId };
      }),
    );
  }

  buscar(id: string): Promise<SeguimientoFila | null> {
    return this.enBase(async () => {
      const [fila] = await this.db.query(`SELECT ${COLUMNAS} FROM recomendacion_seguimientos WHERE id = $1`, [id]);
      return fila ? aSeguimiento(fila) : null;
    });
  }

  listar(
    f: { estado?: Estado; asignadoA?: string; recomendacionId?: string },
    page: number,
    limit: number,
  ): Promise<{ filas: SeguimientoFila[]; total: number }> {
    return this.enBase(async () => {
      const donde: string[] = [];
      const valores: unknown[] = [];
      const agregar = (columna: string, valor: unknown) => {
        valores.push(valor);
        donde.push(`${columna} = $${valores.length}`);
      };
      if (f.estado) agregar('estado', f.estado);
      if (f.asignadoA) agregar('asignado_a', f.asignadoA);
      if (f.recomendacionId) agregar('recomendacion_id', f.recomendacionId);
      const where = donde.length ? `WHERE ${donde.join(' AND ')}` : '';
      const [{ total }] = await this.db.query(`SELECT count(*)::int AS total FROM recomendacion_seguimientos ${where}`, valores);
      const filas: Fila[] = await this.db.query(
        `SELECT ${COLUMNAS} FROM recomendacion_seguimientos ${where}
          ORDER BY asignado_en DESC, id ASC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        valores,
      );
      return { filas: filas.map(aSeguimiento), total };
    });
  }

  /**
   * Transición ATÓMICA (§4): `UPDATE … WHERE id = $1 AND estado = '<desde>'`
   * (y, para start/implement, que el actor siga siendo el asignado). Si otra
   * transición llegó antes, devuelve `null` y quien llama responde 409.
   * Los valores de `cambios` van como parámetros; los nombres de columna son
   * fijos del servicio, nunca del cliente.
   */
  transicion(
    id: string,
    desde: Estado,
    hacia: Estado,
    actor: string,
    cambios: Cambios,
    correlationId: string | null,
    soloAsignado: boolean,
  ): Promise<{ seguimiento: SeguimientoFila; eventoId: string } | null> {
    return this.enBase(() =>
      this.db.transaction(async (m) => {
        const valores: unknown[] = [id, desde, hacia];
        const sets = Object.entries(cambios).map(([columna, valor]) => {
          if (valor === AHORA) return `${columna} = now()`;
          valores.push(valor);
          return `${columna} = $${valores.length}`;
        });
        let condicion = 'id = $1 AND estado = $2';
        if (soloAsignado) {
          valores.push(actor);
          condicion += ` AND asignado_a = $${valores.length}`;
        }
        const [resultado] = await m.query(
          `UPDATE recomendacion_seguimientos SET estado = $3${sets.length ? `, ${sets.join(', ')}` : ''}
            WHERE ${condicion} RETURNING ${COLUMNAS}`,
          valores,
        );
        // Con UPDATE … RETURNING, TypeORM (pg) devuelve [filas, conteo].
        const fila = Array.isArray(resultado) ? resultado[0] : resultado;
        if (!fila) return null;
        const eventoId = await this.evento(m, id, desde, hacia, actor, correlationId);
        return { seguimiento: aSeguimiento(fila), eventoId };
      }),
    );
  }

  historial(id: string): Promise<EventoFila[]> {
    return this.enBase(async () => {
      const filas: Fila[] = await this.db.query(
        `SELECT evento, estado_previo, estado_nuevo, actor_id, ocurrido_en, correlation_id, auditoria_estado, aviso_estado
           FROM seguimiento_eventos WHERE seguimiento_id = $1
          ORDER BY ocurrido_en ASC,
                   array_position(ARRAY['asignada','iniciada','implementada','evaluada']::varchar[], evento) ASC`,
        [id],
      );
      return filas.map((f) => ({
        evento: f.evento,
        estadoPrevio: f.estado_previo,
        estadoNuevo: f.estado_nuevo,
        actorId: f.actor_id,
        ocurridoEn: new Date(f.ocurrido_en),
        correlationId: f.correlation_id,
        auditoria: f.auditoria_estado,
        aviso: f.aviso_estado,
      }));
    });
  }

  /** Cómo terminó la entrega de la auditoría y del aviso del evento (§10). */
  async marcarEntrega(
    eventoId: string,
    auditoria: { estado: EstadoEntrega; error: string | null },
    aviso: { estado: EstadoEntrega; error: string | null },
  ): Promise<void> {
    await this.db.query(
      `UPDATE seguimiento_eventos SET auditoria_estado = $2, auditoria_error = $3, aviso_estado = $4, aviso_error = $5 WHERE id = $1`,
      [eventoId, auditoria.estado, auditoria.error, aviso.estado, aviso.error],
    );
  }

  private async evento(m: EntityManager, seguimientoId: string, previo: Estado | null, nuevo: Estado, actor: string, correlationId: string | null): Promise<string> {
    const [fila] = await m.query(
      `INSERT INTO seguimiento_eventos (seguimiento_id, evento, estado_previo, estado_nuevo, actor_id, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [seguimientoId, EVENTO[nuevo], previo, nuevo, actor, correlationId],
    );
    return fila.id;
  }
}
