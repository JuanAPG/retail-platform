import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { StatCard } from '../../components/StatCard';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { useFetch } from '../../hooks/useFetch';
import { getResumenIndicadores } from '../../api/analitica';
import { getTiendas, getZonas } from '../../api/catalogo';
import { getSegmentos } from '../../api/segmentos';
import { AnalyticsFilters } from '../../types';

const moneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const decimal = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inputCls = 'w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900';
const labelCls = 'mb-1 block text-xs font-medium text-slate-600';

/**
 * M09 — Indicadores descriptivos: ticket promedio, productos por canasta,
 * frecuencia de compra, unidades por transacción y gasto por categoría.
 *
 * Los filtros se editan en un borrador y solo se consultan al pulsar
 * "Aplicar": cada consulta son cinco peticiones, y así las cifras en
 * pantalla siempre corresponden a los filtros aplicados.
 */
export function IndicadoresPanel() {
  const tiendas = useFetch(getTiendas, []);
  const zonas = useFetch(getZonas, []);
  const segmentos = useFetch(getSegmentos, []);

  const [borrador, setBorrador] = useState<AnalyticsFilters>({});
  const [aplicados, setAplicados] = useState<AnalyticsFilters>({});
  const indicadores = useFetch(() => getResumenIndicadores(aplicados), [aplicados]);

  const fechasInvertidas = Boolean(borrador.dateFrom && borrador.dateTo && borrador.dateTo < borrador.dateFrom);

  // Una tienda ya determina su zona: con una zona elegida solo se ofrecen
  // sus tiendas, para no armar combinaciones que siempre darían vacío.
  const tiendasDisponibles = (tiendas.data ?? []).filter((t) => !borrador.zoneId || t.zonaId === borrador.zoneId);

  function cambiarZona(zoneId: string) {
    setBorrador((f) => {
      const tienda = tiendas.data?.find((t) => t.id === f.storeId);
      const tiendaFueraDeZona = Boolean(zoneId && tienda && tienda.zonaId !== zoneId);
      return { ...f, zoneId: zoneId || undefined, storeId: tiendaFueraDeZona ? undefined : f.storeId };
    });
  }

  function aplicar(e: React.FormEvent) {
    e.preventDefault();
    if (fechasInvertidas) return;
    setAplicados({ ...borrador });
  }

  function limpiar() {
    setBorrador({});
    setAplicados({});
  }

  const datos = indicadores.data;
  // Una canasta real nunca vale 0 (CHECK en `canastas`): ticket 0 y sin
  // categorías solo ocurre cuando los filtros no abarcan ninguna canasta.
  const sinCanastas = datos !== null && datos.ticketPromedio === 0 && datos.gastoPorCategoria.length === 0;

  return (
    <section>
      <SectionHeader
        title="Indicadores descriptivos"
        description="Tamaño y frecuencia de compra calculados a partir de las canastas."
        action={
          <button
            type="button"
            onClick={indicadores.refetch}
            disabled={indicadores.loading}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {indicadores.loading ? 'Cargando…' : 'Actualizar'}
          </button>
        }
      />

      <form onSubmit={aplicar} className="mb-6 rounded border border-slate-200 px-4 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div>
            <label className={labelCls} htmlFor="ind-zona">Zona</label>
            <select id="ind-zona" className={inputCls} value={borrador.zoneId ?? ''} onChange={(e) => cambiarZona(e.target.value)}>
              <option value="">Todas</option>
              {(zonas.data ?? []).map((z) => (
                <option key={z.id} value={z.id}>{z.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="ind-tienda">Tienda</label>
            <select
              id="ind-tienda"
              className={inputCls}
              value={borrador.storeId ?? ''}
              onChange={(e) => setBorrador((f) => ({ ...f, storeId: e.target.value || undefined }))}
            >
              <option value="">Todas</option>
              {tiendasDisponibles.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="ind-segmento">Segmento de ingreso</label>
            <select
              id="ind-segmento"
              className={inputCls}
              value={borrador.segmentId ?? ''}
              onChange={(e) =>
                setBorrador((f) => ({ ...f, segmentId: e.target.value ? Number(e.target.value) : undefined }))
              }
            >
              <option value="">Todos</option>
              {(segmentos.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="ind-desde">Desde</label>
            <input
              id="ind-desde"
              type="date"
              className={inputCls}
              value={borrador.dateFrom ?? ''}
              onChange={(e) => setBorrador((f) => ({ ...f, dateFrom: e.target.value || undefined }))}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="ind-hasta">Hasta</label>
            <input
              id="ind-hasta"
              type="date"
              className={inputCls}
              value={borrador.dateTo ?? ''}
              onChange={(e) => setBorrador((f) => ({ ...f, dateTo: e.target.value || undefined }))}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-xs text-red-600">
            {fechasInvertidas && 'La fecha final no puede ser anterior a la inicial.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={limpiar}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Limpiar
            </button>
            <button
              type="submit"
              disabled={fechasInvertidas || indicadores.loading}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Aplicar
            </button>
          </div>
        </div>
      </form>

      {indicadores.loading && <p className="text-sm text-slate-500">Cargando indicadores…</p>}

      {!indicadores.loading && indicadores.error && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-600">{indicadores.error}</p>
          <button
            type="button"
            onClick={indicadores.refetch}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Reintentar
          </button>
        </div>
      )}

      {!indicadores.loading && !indicadores.error && sinCanastas && (
        <EmptyState
          title="No hay canastas para estos filtros"
          description="Prueba con otro periodo o quita filtros."
        />
      )}

      {!indicadores.loading && !indicadores.error && datos && !sinCanastas && (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Ticket promedio" value={moneda.format(datos.ticketPromedio)} hint="por canasta" />
            <StatCard
              label="Productos por canasta"
              value={decimal.format(datos.productosPorCanasta)}
              hint="productos distintos"
            />
            <StatCard
              label="Frecuencia de compra"
              value={decimal.format(datos.frecuenciaCompra)}
              hint="compras por mes"
            />
            <StatCard
              label="Unidades por transacción"
              value={decimal.format(datos.unidadesPorTransaccion)}
              hint="unidades"
            />
          </div>

          <h2 className="mb-3 text-lg font-semibold text-slate-900">Gasto por categoría</h2>
          {datos.gastoPorCategoria.length === 0 ? (
            <EmptyState
              title="Sin gasto registrado por categoría"
              description="Las canastas filtradas no tienen líneas con categoría asignada."
            />
          ) : (
            <DataTable
              rowKey={(c) => String(c.categoryId)}
              rows={datos.gastoPorCategoria}
              columns={[
                { header: 'Categoría', render: (c) => c.categoryName },
                { header: 'Gasto', render: (c) => moneda.format(c.totalSpend) },
                {
                  header: '% del gasto',
                  className: 'w-64',
                  render: (c) => (
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded bg-slate-100">
                        <div className="h-2 rounded bg-slate-700" style={{ width: `${c.share}%` }} />
                      </div>
                      <span className="w-16 text-right tabular-nums">{decimal.format(c.share)}%</span>
                    </div>
                  ),
                },
                { header: 'Unidades', render: (c) => decimal.format(c.units) },
                { header: 'Canastas', render: (c) => c.basketCount },
              ]}
            />
          )}
        </>
      )}

      <p className="mt-6 text-xs text-slate-400">
        Indicadores agregados por tienda, zona o segmento. El segmento corresponde a la zona donde se hizo la
        compra; no se infiere el ingreso de ninguna persona. La frecuencia de compra se mide en canastas por mes.
      </p>
    </section>
  );
}
