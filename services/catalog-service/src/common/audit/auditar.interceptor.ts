import { CallHandler, ExecutionContext, Injectable, NestInterceptor, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { AuditReporter } from './audit-reporter.service';

/** Tablas que este servicio audita. Es una lista cerrada: el nombre se interpola en SQL. */
export type TablaAuditada = 'productos' | 'producto_presentaciones' | 'tiendas' | 'zonas' | 'segmentos_ingreso';
export type AccionAudit = 'insert' | 'update' | 'delete' | 'aprobar' | 'rechazar';

export const AUDITAR_KEY = 'auditar';

/**
 * Reporta a audit-service cada escritura del handler (CAT-08), con los valores ANTES y DESPUÉS.
 * Va como decorador del handler: `@Auditar('productos', 'aprobar')`.
 *
 * - El id sale del parámetro de ruta `id` (editar, borrar, aprobar) o de la respuesta (alta).
 * - Se lee la fila antes y después de la operación y se reportan las columnas que cambiaron.
 * - Un DELETE que dejó la fila inactiva (D-07) se reporta como `desactivar`, no como `delete`.
 * - Solo se reporta si la operación tuvo éxito (un 4xx no deja evento).
 * - Un fallo de audit-service nunca rompe la operación (lo traga el `AuditReporter`).
 */
export const Auditar = (tabla: TablaAuditada, accion: AccionAudit, idDe: 'ruta' | 'respuesta' = 'ruta') =>
  SetMetadata(AUDITAR_KEY, { tabla, accion, idDe });

const IGNORADAS = new Set(['updated_at', 'created_at']);

type Fila = Record<string, unknown> | null;

@Injectable()
export class AuditarInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
    private readonly audit: AuditReporter,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<{ tabla: TablaAuditada; accion: AccionAudit; idDe: 'ruta' | 'respuesta' } | undefined>(AUDITAR_KEY, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<{
      params: Record<string, string>;
      body?: Record<string, unknown>;
      headers: Record<string, string | undefined>;
      ip?: string;
    }>();
    // `:id` de la ruta es la fila auditada salvo en las altas anidadas (p. ej. POST /products/:id/presentations).
    const idRuta = meta.idDe === 'ruta' ? req.params?.id : undefined;

    return from(this.fila(meta.tabla, idRuta)).pipe(
      mergeMap((antes) =>
        next.handle().pipe(
          mergeMap((respuesta) =>
            from(this.reportar(meta, idRuta, req, antes, respuesta).then(() => respuesta)),
          ),
        ),
      ),
    );
  }

  private async reportar(
    meta: { tabla: TablaAuditada; accion: AccionAudit },
    idRuta: string | undefined,
    req: { params: Record<string, string>; body?: Record<string, unknown>; headers: Record<string, string | undefined>; ip?: string },
    antes: Fila,
    respuesta: unknown,
  ) {
    try {
      const resp = respuesta as { id?: string | number; entidad?: { id?: string | number } } | undefined;
      // segmentos_ingreso.id es SMALLINT: en el alta el id sale de la respuesta y es numérico, y audit-service exige texto.
      const crudo = idRuta ?? resp?.id ?? resp?.entidad?.id;
      const id = crudo === undefined || crudo === null ? undefined : String(crudo);
      const despues = await this.fila(meta.tabla, id);

      let accion: string = meta.accion;
      // D-07: el DELETE que solo desactivó (la fila sigue, con activo=false o estatus=inactivo).
      if (meta.accion === 'delete' && despues) accion = 'desactivar';

      const cambios = this.diferencias(antes, despues);
      const motivo = typeof req.body?.motivoRechazo === 'string' ? ` Motivo: ${req.body.motivoRechazo}` : '';
      await this.audit.reportar(
        {
          tabla: meta.tabla,
          registroId: id ?? null,
          accion: accion as never,
          descripcion: `${descripcion(accion)} en ${meta.tabla}${id ? ` (${id})` : ''}.${motivo}`,
          cambios,
          ip: req.ip ?? null,
        },
        req.headers['authorization'],
      );
    } catch {
      // La auditoría nunca rompe la operación.
    }
  }

  private async fila(tabla: TablaAuditada, id: string | undefined): Promise<Fila> {
    if (!id) return null;
    try {
      const filas = await this.dataSource.query(`SELECT * FROM ${tabla} WHERE id = $1`, [id]);
      return filas[0] ?? null;
    } catch {
      return null; // id mal formado u otro problema: sin foto, la operación sigue.
    }
  }

  private diferencias(antes: Fila, despues: Fila) {
    const cambios: Array<{ campo: string; previo: string | null; posterior: string | null }> = [];
    const campos = new Set([...Object.keys(antes ?? {}), ...Object.keys(despues ?? {})]);
    for (const campo of campos) {
      if (IGNORADAS.has(campo)) continue;
      const previo = antes ? texto(antes[campo]) : null;
      const posterior = despues ? texto(despues[campo]) : null;
      if (previo !== posterior) cambios.push({ campo, previo, posterior });
    }
    return cambios;
  }
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function descripcion(accion: string): string {
  const mapa: Record<string, string> = {
    insert: 'Alta',
    update: 'Edición',
    delete: 'Baja',
    desactivar: 'Desactivación (tiene historial, no se borró)',
    aprobar: 'Aprobación',
    rechazar: 'Rechazo',
  };
  return mapa[accion] ?? accion;
}
