import { Injectable, Logger } from '@nestjs/common';
import { Indicador, ParametrosReporte } from './schemas/report.schema';

/** Timeout por llamada a otro servicio (D-20): pasado esto, la sección va como no disponible. */
export const TIMEOUT_SERVICIOS_MS = 3000;

/** URLs de los servicios dueños de los datos; en Docker se resuelven por el nombre del servicio. */
export const urlsServicios = () => ({
  core: process.env.CORE_PROCESS_SERVICE_URL ?? 'http://core-process-service:3104',
  catalog: process.env.CATALOG_SERVICE_URL ?? 'http://catalog-service:3102',
  pricing: process.env.PRICING_SERVICE_URL ?? 'http://pricing-service:3103',
  algorithms: process.env.ALGORITHMS_CORE_URL ?? 'http://algorithms-core:3105',
  decision: process.env.DECISION_SERVICE_URL ?? 'http://decision-service:3107',
});

type Servicio = 'core-process-service' | 'catalog-service' | 'pricing-service' | 'algorithms-core' | 'decision-service';

/** Error al consultar otro servicio; su mensaje es el `motivo` que ve el lector del reporte. */
class ServicioNoDisponible extends Error {}

const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const promedio = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Reúne los 16 indicadores del reporte ejecutivo (D-20) llamando por HTTP a los
 * servicios dueños y REENVIANDO el `Authorization` del usuario: ningún servicio
 * confía en uno que no sea el del propio usuario.
 *
 * Regla central: si un servicio no responde (timeout de 3 s, 5xx, red), el
 * indicador sale `disponible: false` con su `motivo`. Un 0 inventado en un reporte
 * ejecutivo es peor que un hueco: parece un dato.
 */
@Injectable()
export class IndicatorsService {
  private readonly logger = new Logger(IndicatorsService.name);

  async reunir(p: ParametrosReporte, authorization: string | undefined): Promise<Indicador[]> {
    const u = urlsServicios();
    const get = <T>(servicio: Servicio, base: string, ruta: string, query: Record<string, unknown> = {}) =>
      this.pedir<T>(servicio, `${base}${ruta}`, query, authorization);

    // Filtros que entienden los servicios de analítica (nombres de AnalyticsFilterDto).
    const filtros = { dateFrom: p.dateFrom, dateTo: p.dateTo, zoneId: p.zoneId, segmentId: p.segmentId };

    const def = (
      clave: string,
      nombre: string,
      servicio: Servicio,
      calcular: () => Promise<unknown>,
    ): Promise<Indicador> => this.indicador(clave, nombre, servicio, calcular);

    // Cada indicador falla solo; `Promise.all` nunca rechaza porque `indicador` atrapa.
    return Promise.all([
      // --- core-process-service ---
      def('transacciones_analizadas', 'Transacciones analizadas', 'core-process-service', async () => {
        const r = await get<{ total: number }>('core-process-service', u.core, '/v1/transactions', { ...filtros, limit: 1 });
        return r.total;
      }),
      // RN-03: una canasta equivale a una transacción.
      def('canastas', 'Canastas construidas', 'core-process-service', async () => {
        const r = await get<{ total: number }>('core-process-service', u.core, '/v1/transactions', { ...filtros, limit: 1 });
        return r.total;
      }),
      def('ticket_promedio', 'Ticket promedio (MXN por canasta)', 'core-process-service', () =>
        get<number>('core-process-service', u.core, '/v1/analytics/average-ticket', filtros),
      ),
      def('productos_por_canasta', 'Productos distintos por canasta', 'core-process-service', () =>
        get<number>('core-process-service', u.core, '/v1/analytics/products-per-basket', filtros),
      ),
      def('frecuencia_compra', 'Frecuencia de compra (canastas por mes)', 'core-process-service', () =>
        get<number>('core-process-service', u.core, '/v1/analytics/purchase-frequency', filtros),
      ),
      def('categorias_principales', 'Categorías principales por gasto', 'core-process-service', async () => {
        const filas = await get<Array<Record<string, unknown>>>('core-process-service', u.core, '/v1/analytics/spend-by-category', filtros);
        return filas.slice(0, 5).map((f) => ({
          categoria: f.categoryName,
          gasto: f.totalSpend,
          participacionPct: f.share,
        }));
      }),

      // --- catalog-service ---
      def('zonas_analizadas', 'Zonas analizadas', 'catalog-service', async () => {
        if (p.zoneId) return 1;
        const r = await get<{ total: number }>('catalog-service', u.catalog, '/v1/zones', { limit: 1 });
        return r.total;
      }),
      def('productos_basicos_disponibles', 'Productos de la canasta básica disponibles', 'catalog-service', async () => {
        const productos = await this.todos<{ esCanastaBasica: boolean }>('catalog-service', u.catalog, '/v1/products', authorization);
        return productos.filter((x) => x.esCanastaBasica).length;
      }),

      // --- algorithms-core ---
      def('asociaciones_principales', 'Asociaciones principales (última corrida)', 'algorithms-core', async () => {
        const corridas = await get<{ data: Array<{ id: string }> }>('algorithms-core', u.algorithms, '/v1/association/runs', { limit: 1 });
        if (!corridas.data.length) return { corrida: null, reglas: [] };
        const corrida = await get<{ id: string; results?: Array<Record<string, any>> }>(
          'algorithms-core', u.algorithms, `/v1/association/runs/${corridas.data[0].id}`,
        );
        const nombres = (r: Record<string, any>, lado: string) =>
          (r.items ?? []).filter((i: any) => i.side === lado).map((i: any) => i.product?.nombre);
        return {
          corrida: corrida.id,
          reglas: (corrida.results ?? []).slice(0, 5).map((r) => ({
            antecedente: nombres(r, 'antecedente'),
            consecuente: nombres(r, 'consecuente'),
            soporte: r.support,
            confianza: r.confidence,
            lift: r.lift,
          })),
        };
      }),
      def('sustituciones', 'Patrones de sustitución detectados', 'algorithms-core', async () => {
        const categorias = await get<Array<{ id: number }>>('catalog-service', u.catalog, '/v1/product-categories');
        const patrones: Array<Record<string, any>> = [];
        for (const c of categorias.slice(0, 15)) {
          try {
            patrones.push(...(await get<Array<Record<string, any>>>('algorithms-core', u.algorithms, '/v1/substitution/patterns', { categoryId: c.id })));
          } catch (err) {
            // Una categoría sin datos suficientes no invalida al resto; un servicio caído sí.
            if (err instanceof ServicioNoDisponible && /HTTP 4\d\d/.test(err.message)) continue;
            throw err;
          }
        }
        return {
          total: patrones.length,
          principales: patrones.slice(0, 5).map((s) => ({ origen: s.originProductName, destino: s.targetProductName, tipo: s.type })),
        };
      }),
      def('elasticidad_promedio', 'Elasticidad promedio', 'algorithms-core', async () => {
        const filas = await this.todos<{ value: number }>('algorithms-core', u.algorithms, '/v1/elasticity/current', authorization, p.zoneId ? { zoneId: p.zoneId } : {});
        return filas.length ? redondear(promedio(filas.map((f) => Number(f.value))), 3) : null;
      }),
      def('productos_mas_sensibles', 'Productos más sensibles al precio', 'algorithms-core', async () => {
        const filas = await this.todos<Record<string, any>>('algorithms-core', u.algorithms, '/v1/elasticity/current', authorization, p.zoneId ? { zoneId: p.zoneId } : {});
        return filas
          .sort((a, b) => Math.abs(Number(b.value)) - Math.abs(Number(a.value)))
          .slice(0, 5)
          .map((f) => ({ producto: f.productName, presentacion: f.presentationName, zona: f.zoneName, elasticidad: f.value, clasificacion: f.classification }));
      }),

      // --- pricing-service ---
      def('variacion_precios', 'Variación de precios en el periodo', 'pricing-service', async () => {
        const productos = (await this.todos<{ id: string }>('catalog-service', u.catalog, '/v1/products', authorization)).slice(0, 10);
        const cambios: number[] = [];
        for (const prod of productos) {
          const h = await get<{ data: Array<{ presentationId: string; storeId: string; price: string; effectiveDate: string }> }>(
            'pricing-service', u.pricing, '/v1/prices/history', { productId: prod.id, limit: 100 },
          );
          const grupos = new Map<string, Array<{ price: number; fecha: string }>>();
          for (const x of h.data) {
            if (x.effectiveDate < p.dateFrom || x.effectiveDate > p.dateTo) continue;
            const k = `${x.presentationId}|${x.storeId}`;
            grupos.set(k, [...(grupos.get(k) ?? []), { price: Number(x.price), fecha: x.effectiveDate }]);
          }
          for (const serie of grupos.values()) {
            serie.sort((a, b) => a.fecha.localeCompare(b.fecha));
            for (let i = 1; i < serie.length; i++) cambios.push(((serie[i].price - serie[i - 1].price) / serie[i - 1].price) * 100);
          }
        }
        return {
          cambiosAnalizados: cambios.length,
          variacionPromedioPct: cambios.length ? redondear(promedio(cambios)) : null,
          variacionMaximaPct: cambios.length ? redondear(Math.max(...cambios.map(Math.abs))) : null,
        };
      }),

      // --- decision-service ---
      def('accesibilidad_por_zona', 'Accesibilidad por zona (última corrida)', 'decision-service', async () => {
        // Se lee el historial: `/accessibility/index` CALCULA y guarda una corrida nueva en cada llamada.
        const zonas = p.zoneId
          ? [{ id: p.zoneId, nombre: null as string | null }]
          : (await this.todos<{ id: string; nombre: string }>('catalog-service', u.catalog, '/v1/zones', authorization));
        const filas: Array<Record<string, unknown>> = [];
        for (const z of zonas) {
          const hist = await get<Array<Record<string, any>>>('decision-service', u.decision, `/v1/accessibility/by-zone/${z.id}`);
          if (hist.length) filas.push({ zonaId: z.id, zona: z.nombre, indice: hist[0].indexValue, calculadoEn: hist[0].calculatedAt });
        }
        return filas;
      }),
      def('escenarios_creados', 'Escenarios creados', 'decision-service', async () => {
        const esc = await get<Array<{ createdAt: string }>>('decision-service', u.decision, '/v1/simulation/scenarios');
        return esc.filter((e) => e.createdAt.slice(0, 10) >= p.dateFrom && e.createdAt.slice(0, 10) <= p.dateTo).length;
      }),
      def('impacto_estimado', 'Impacto estimado de los escenarios (ingreso estimado)', 'decision-service', async () => {
        const esc = await get<Array<{ id: string; nombre: string }>>('decision-service', u.decision, '/v1/simulation/scenarios');
        if (esc.length < 2) return [];
        const ids = esc.slice(0, 5).map((e) => e.id);
        const cmp = await get<{ scenarioNames?: Record<string, string>; rows: Array<{ indicatorKey: string; valuesByScenario: Record<string, number> }> }>(
          'decision-service', u.decision, '/v1/simulation/compare', { ids: ids.join(',') },
        );
        const fila = cmp.rows.find((r) => r.indicatorKey === 'ingreso_estimado');
        return fila ? ids.map((id) => ({ escenario: cmp.scenarioNames?.[id] ?? id, ingresoEstimado: fila.valuesByScenario[id] ?? null })) : [];
      }),
    ]);
  }

  /** Envuelve un cálculo: éxito → `disponible: true`; cualquier fallo → `disponible: false` + motivo. */
  private async indicador(clave: string, nombre: string, servicio: string, calcular: () => Promise<unknown>): Promise<Indicador> {
    try {
      return { clave, nombre, servicio, disponible: true, valor: await calcular(), motivo: null };
    } catch (err) {
      const motivo = err instanceof ServicioNoDisponible ? err.message : `Error al calcular el indicador: ${(err as Error).message}`;
      this.logger.warn(`Indicador ${clave} no disponible: ${motivo}`);
      return { clave, nombre, servicio, disponible: false, valor: null, motivo };
    }
  }

  /** GET con timeout; cualquier fallo se vuelve `ServicioNoDisponible` con un motivo legible. */
  private async pedir<T>(servicio: Servicio, url: string, query: Record<string, unknown>, authorization: string | undefined): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const destino = qs.toString() ? `${url}?${qs}` : url;

    const control = new AbortController();
    const limite = setTimeout(() => control.abort(), TIMEOUT_SERVICIOS_MS);
    try {
      const r = await fetch(destino, {
        headers: { Accept: 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
        signal: control.signal,
      });
      if (!r.ok) throw new ServicioNoDisponible(`${servicio} respondió HTTP ${r.status}.`);
      return (await r.json()) as T;
    } catch (err) {
      if (err instanceof ServicioNoDisponible) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new ServicioNoDisponible(`${servicio} no respondió en ${TIMEOUT_SERVICIOS_MS / 1000} s.`);
      }
      throw new ServicioNoDisponible(`${servicio} no está disponible.`);
    } finally {
      clearTimeout(limite);
    }
  }

  /** Recorre las páginas de un listado paginado (límite 100) hasta 5 páginas. */
  private async todos<T>(servicio: Servicio, base: string, ruta: string, authorization: string | undefined, query: Record<string, unknown> = {}): Promise<T[]> {
    const filas: T[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this.pedir<{ data: T[]; total: number }>(servicio, `${base}${ruta}`, { ...query, page, limit: 100 }, authorization);
      filas.push(...r.data);
      if (filas.length >= r.total || r.data.length === 0) break;
    }
    return filas;
  }
}
