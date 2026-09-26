import { FormEvent, useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { getResumenIndicadores } from '../../api/analitica';
import { getTiendas, getZonas } from '../../api/catalogo';
import { getSegmentos } from '../../api/segmentos';
import { AnalyticsFilters } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { IconReportes } from '../../components/ui/icons';

const moneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const decimal = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const selectClass =
  'h-14 rounded-full border-2 border-transparent bg-arena px-5 text-[15px] text-tinta outline-none transition focus:border-vino focus:bg-marfil hover:border-salvia/60';
const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

/**
 * M09 — Indicadores descriptivos: ticket promedio, productos por canasta,
 * frecuencia de compra, unidades por transacción y gasto por categoría.
 * Se llega aquí desde el paso "Indicadores" del flujo en Transacciones:
 * el prototipo no le da un ícono propio en el Rail.
 */
export function IndicadoresPanel() {
  const tiendas = useFetch(getTiendas, []);
  const zonas = useFetch(getZonas, []);
  const segmentos = useFetch(getSegmentos, []);

  const [borrador, setBorrador] = useState<AnalyticsFilters>({});
  const [aplicados, setAplicados] = useState<AnalyticsFilters>({});
  const indicadores = useFetch(() => getResumenIndicadores(aplicados), [aplicados]);

  const fechasInvertidas = Boolean(borrador.dateFrom && borrador.dateTo && borrador.dateTo < borrador.dateFrom);
  const tiendasDisponibles = (tiendas.data ?? []).filter((t) => !borrador.zoneId || t.zonaId === borrador.zoneId);

  function cambiarZona(zoneId: string) {
    setBorrador((f) => {
      const tienda = tiendas.data?.find((t) => t.id === f.storeId);
      const tiendaFueraDeZona = Boolean(zoneId && tienda && tienda.zonaId !== zoneId);
      return { ...f, zoneId: zoneId || undefined, storeId: tiendaFueraDeZona ? undefined : f.storeId };
    });
  }

  function aplicar(e: FormEvent) {
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
    <div className="flex flex-col gap-6">
      <Hero
        title="Indicadores"
        subtitle="Tamaño y frecuencia de compra a partir de las canastas"
        decorations={
          <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
            <IconReportes className="mt-8 h-[74px] w-[74px]" />
          </div>
        }
      />

      <form onSubmit={aplicar} className="flex flex-col gap-4 rounded-panel bg-arena p-6">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
          <label className={labelClass} htmlFor="ind-zona">
            Zona
            <select id="ind-zona" className={selectClass} value={borrador.zoneId ?? ''} onChange={(e) => cambiarZona(e.target.value)}>
              <option value="">Todas</option>
              {(zonas.data ?? []).map((z) => (
                <option key={z.id} value={z.id}>{z.nombre}</option>
              ))}
            </select>
          </label>
          <label className={labelClass} htmlFor="ind-tienda">
            Tienda
            <select
              id="ind-tienda"
              className={selectClass}
              value={borrador.storeId ?? ''}
              onChange={(e) => setBorrador((f) => ({ ...f, storeId: e.target.value || undefined }))}
            >
              <option value="">Todas</option>
              {tiendasDisponibles.map((t) => (
                <option key={t.id} value={t.id}>{t.nombre}</option>
              ))}
            </select>
          </label>
          <label className={labelClass} htmlFor="ind-segmento">
            Segmento de ingreso
            <select
              id="ind-segmento"
              className={selectClass}
              value={borrador.segmentId ?? ''}
              onChange={(e) => setBorrador((f) => ({ ...f, segmentId: e.target.value ? Number(e.target.value) : undefined }))}
            >
              <option value="">Todos</option>
              {(segmentos.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className={labelClass} htmlFor="ind-desde">
            Desde
            <input
              id="ind-desde"
              type="date"
              className={selectClass}
              value={borrador.dateFrom ?? ''}
              onChange={(e) => setBorrador((f) => ({ ...f, dateFrom: e.target.value || undefined }))}
            />
          </label>
          <label className={labelClass} htmlFor="ind-hasta">
            Hasta
            <input
              id="ind-hasta"
              type="date"
              className={selectClass}
              value={borrador.dateTo ?? ''}
              onChange={(e) => setBorrador((f) => ({ ...f, dateTo: e.target.value || undefined }))}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className="text-xs font-semibold text-vino">
            {fechasInvertidas && 'La fecha final no puede ser anterior a la inicial.'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={limpiar} className="flex h-11 items-center rounded-full border-2 border-salvia/60 px-5 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta">
              Limpiar
            </button>
            <button
              type="submit"
              disabled={fechasInvertidas || indicadores.loading}
              className="flex h-11 items-center rounded-full bg-teal px-6 text-sm font-bold text-arena transition hover:bg-vino disabled:opacity-50"
            >
              Aplicar
            </button>
          </div>
        </div>
      </form>

      {indicadores.loading && <p className="text-sm text-teal/70">Cargando indicadores…</p>}
      {!indicadores.loading && indicadores.error && <p className="text-sm font-semibold text-vino">{indicadores.error}</p>}

      {!indicadores.loading && !indicadores.error && sinCanastas && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-2xl text-teal">No hay canastas para estos filtros</p>
          <p className="text-sm text-teal/70">Prueba con otro periodo o quita filtros.</p>
        </div>
      )}

      {!indicadores.loading && !indicadores.error && datos && !sinCanastas && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Ticket promedio', value: moneda.format(datos.ticketPromedio), hint: 'por canasta' },
              { label: 'Productos por canasta', value: decimal.format(datos.productosPorCanasta), hint: 'distintos' },
              { label: 'Frecuencia de compra', value: decimal.format(datos.frecuenciaCompra), hint: 'compras/mes' },
              { label: 'Unidades por transacción', value: decimal.format(datos.unidadesPorTransaccion), hint: 'unidades' },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col gap-1 rounded-card bg-arena p-5">
                <span className="text-xs font-semibold uppercase tracking-wide text-teal/70">{stat.label}</span>
                <span className="font-display text-3xl text-vino">{stat.value}</span>
                <span className="text-xs text-teal/70">{stat.hint}</span>
              </div>
            ))}
          </div>

          <h2 className="px-1 font-display text-[28px] text-vino">Gasto por categoría</h2>
          {datos.gastoPorCategoria.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
              <p className="font-display text-xl text-teal">Sin gasto registrado por categoría</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {datos.gastoPorCategoria.map((c) => (
                <div key={c.categoryId} className="group relative flex h-14 items-center overflow-hidden rounded-full bg-arena px-5 transition hover:translate-x-1">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-salvia transition-all group-hover:bg-teal"
                    style={{ width: `${c.share}%` }}
                  />
                  <div className="relative z-[1] flex w-full items-center justify-between text-sm font-semibold text-tinta group-hover:text-arena">
                    <span>
                      {c.categoryName} <span className="font-data text-xs opacity-70">{c.basketCount} canastas</span>
                    </span>
                    <span className="font-data">
                      {moneda.format(c.totalSpend)} · {decimal.format(c.share)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="px-1 text-xs text-teal/60">
        El segmento corresponde a la zona donde se hizo la compra; no se infiere el ingreso de ninguna persona.
      </p>
    </div>
  );
}
