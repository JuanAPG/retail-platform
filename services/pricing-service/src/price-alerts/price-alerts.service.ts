import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SesionUsuario } from '../common/auth/session.guard';
import { hoyOperacion } from '../common/fecha';
import { NotificationsReporter } from '../common/notifications/notifications-reporter.service';

/** Defaults de D-09 cuando todavía nadie configuró la alerta: 5 % dentro de 30 días. */
export const UMBRAL_POR_DEFECTO_PCT = 5;
export const VENTANA_POR_DEFECTO_DIAS = 30;

export interface AlertSettingsDto {
  umbralPct: number;
  ventanaDias: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface CambioPrecio {
  presentationId: string;
  storeId: string;
  /** Precio recién registrado. */
  nuevoPrecio: number;
  /** Fecha desde la que aplica el precio nuevo (YYYY-MM-DD). */
  effectiveDate: string;
  /** Id del precio recién creado: es la llave del aviso, para que dos cambios seguidos no se fusionen (QA-PRI53-05). */
  precioId?: string;
}

export interface ResultadoAlerta {
  alerta: boolean;
  basePrecio: number | null;
  variacionPct: number | null;
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/**
 * PRI-07 / D-09 — Alerta de cambio de precio ACUMULADO en una ventana de tiempo.
 *
 * Compara el precio nuevo con el que la misma presentación y tienda tenían al INICIO de la ventana
 * (`effectiveDate - ventanaDias`), no con el inmediato anterior: así un 1 % diario durante un mes sí
 * cruza el 10 %, en vez de no avisar nunca porque cada paso queda debajo del umbral. El umbral y la
 * ventana los define el Responsable de precios.
 */
@Injectable()
export class PriceAlertsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditReporter,
    private readonly notificaciones: NotificationsReporter,
  ) {}

  async getSettings(): Promise<AlertSettingsDto> {
    const [fila] = await this.dataSource.query(
      'SELECT umbral_pct::float AS umbral, ventana_dias, actualizado_por, updated_at FROM config_alertas_precio WHERE id = 1',
    );
    if (!fila) {
      return { umbralPct: UMBRAL_POR_DEFECTO_PCT, ventanaDias: VENTANA_POR_DEFECTO_DIAS, updatedBy: null, updatedAt: null };
    }
    return {
      umbralPct: Number(fila.umbral),
      ventanaDias: Number(fila.ventana_dias),
      updatedBy: fila.actualizado_por ?? null,
      updatedAt: fila.updated_at ? new Date(fila.updated_at).toISOString() : null,
    };
  }

  async updateSettings(
    dto: { umbralPct: number; ventanaDias: number },
    solicitante: SesionUsuario,
    ip?: string,
    token?: string,
  ): Promise<AlertSettingsDto> {
    const previo = await this.getSettings();
    await this.dataSource.query(
      `INSERT INTO config_alertas_precio (id, umbral_pct, ventana_dias, actualizado_por, updated_at)
       VALUES (1, $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET umbral_pct = EXCLUDED.umbral_pct, ventana_dias = EXCLUDED.ventana_dias,
         actualizado_por = EXCLUDED.actualizado_por, updated_at = now()`,
      [dto.umbralPct, dto.ventanaDias, solicitante.id],
    );
    await this.audit.reportar(
      {
        tabla: 'config_alertas_precio',
        registroId: '1',
        accion: 'update',
        descripcion: `Alerta de cambio de precio: umbral ${dto.umbralPct} % en ${dto.ventanaDias} días.`,
        cambios: [
          { campo: 'umbral_pct', previo: String(previo.umbralPct), posterior: String(dto.umbralPct) },
          { campo: 'ventana_dias', previo: String(previo.ventanaDias), posterior: String(dto.ventanaDias) },
        ],
        ip: ip ?? null,
      },
      token,
    );
    return this.getSettings();
  }

  /**
   * Calcula la variación acumulada y, si alcanza el umbral, avisa al Responsable de precios
   * (`precio.umbral`). Va DESPUÉS de confirmar el alta y nunca la rompe.
   */
  async evaluar(cambio: CambioPrecio, token?: string): Promise<ResultadoAlerta> {
    try {
      const { umbralPct, ventanaDias } = await this.getSettings();
      const base = await this.precioBase(cambio, ventanaDias);
      if (base === null || base <= 0) return { alerta: false, basePrecio: base, variacionPct: null };

      const variacionPct = redondear2((Math.abs(cambio.nuevoPrecio - base) / base) * 100);
      if (variacionPct < umbralPct) return { alerta: false, basePrecio: base, variacionPct };

      const [ctx] = await this.dataSource.query(
        `SELECT prod.nombre AS producto, pres.nombre AS presentacion, t.nombre AS tienda
         FROM producto_presentaciones pres JOIN productos prod ON prod.id = pres.producto_id, tiendas t
         WHERE pres.id = $1 AND t.id = $2`,
        [cambio.presentationId, cambio.storeId],
      );
      const sube = cambio.nuevoPrecio > base;
      await this.notificaciones.emitir(
        {
          eventType: 'precio.umbral',
          // notifications-service deduplica por (evento, entidad, destinatario) en 5 min: la llave es el PRECIO,
          // no la presentación, para que una segunda alerta de la misma presentación o de otra tienda no se pierda.
          relatedEntityType: cambio.precioId ? 'precio' : 'presentacion',
          relatedEntityId: cambio.precioId ?? cambio.presentationId,
          title: `Cambio de precio de ${variacionPct} % en ${ventanaDias} días`,
          message:
            `${ctx?.producto ?? 'Producto'} (${ctx?.presentacion ?? 'presentación'}) en ${ctx?.tienda ?? 'tienda'}: ` +
            `${sube ? 'subió' : 'bajó'} de ${base.toFixed(2)} a ${cambio.nuevoPrecio.toFixed(2)} ` +
            `(umbral ${umbralPct} % en ${ventanaDias} días).` +
            // PRI-15: si el precio es programado, el aviso lo dice en vez de sonar a un cambio que ya rige.
            (cambio.effectiveDate > hoyOperacion() ? ` Aplica a partir del ${cambio.effectiveDate}.` : ''),
          priority: variacionPct >= umbralPct * 2 ? 'critical' : 'warning',
        },
        token,
      );
      return { alerta: true, basePrecio: base, variacionPct };
    } catch {
      return { alerta: false, basePrecio: null, variacionPct: null }; // una alerta fallida nunca rompe el alta
    }
  }

  /**
   * El precio de la presentación en la tienda al inicio de la ventana. Si el historial es más corto
   * que la ventana (no había precio hace N días), se toma el MÁS ANTIGUO dentro de la ventana: es el
   * mejor punto de partida disponible. Sin historial previo no hay con qué comparar.
   */
  private async precioBase(c: CambioPrecio, ventanaDias: number): Promise<number | null> {
    const [enForma] = await this.dataSource.query(
      `SELECT precio::float AS precio FROM precios
       WHERE presentacion_id = $1 AND tienda_id = $2
         AND fecha_vigencia_desde <= ($3::date - $4::int)
         AND (fecha_vigencia_hasta IS NULL OR fecha_vigencia_hasta >= ($3::date - $4::int))
       ORDER BY fecha_vigencia_desde DESC LIMIT 1`,
      [c.presentationId, c.storeId, c.effectiveDate, ventanaDias],
    );
    if (enForma) return Number(enForma.precio);

    const [masAntiguo] = await this.dataSource.query(
      `SELECT precio::float AS precio FROM precios
       WHERE presentacion_id = $1 AND tienda_id = $2 AND fecha_vigencia_desde < $3::date
       ORDER BY fecha_vigencia_desde ASC LIMIT 1`,
      [c.presentationId, c.storeId, c.effectiveDate],
    );
    return masAntiguo ? Number(masAntiguo.precio) : null;
  }
}
