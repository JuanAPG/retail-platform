import { FormEvent, useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { getResumenIndicadores } from '../../api/analitica';
import { getTiendas, getZonas } from '../../api/catalogo';
import { getSegmentos } from '../../api/segmentos';
import { AnalyticsFilters, CategorySpend } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { Select } from '../../components/ui/Select';
import { Grafica } from '../../components/Grafica';
import { SelectorTipoGrafica } from '../../components/SelectorTipoGrafica';
import { COLORES } from '../../components/coloresGrafica';
import type Highcharts from 'highcharts';
import { ErrorText } from '../../components/ui/ErrorText';
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
  const [tipoGasto, setTipoGasto] = useState<TipoGasto>('barras');
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
          <Select id="ind-zona" label="Zona" value={borrador.zoneId ?? ''} onChange={(e) => cambiarZona(e.target.value)} placeholder="Todas">
            {(zonas.data ?? []).map((z) => (
              <option key={z.id} value={z.id}>{z.nombre}</option>
            ))}
          </Select>
          <Select
            id="ind-tienda"
            label="Tienda"
            value={borrador.storeId ?? ''}
            onChange={(e) => setBorrador((f) => ({ ...f, storeId: e.target.value || undefined }))}
            placeholder="Todas"
          >
            {tiendasDisponibles.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </Select>
          <Select
            id="ind-segmento"
            label="Segmento de ingreso"
            value={borrador.segmentId ?? ''}
            onChange={(e) => setBorrador((f) => ({ ...f, segmentId: e.target.value ? Number(e.target.value) : undefined }))}
            placeholder="Todos"
          >
            {(segmentos.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
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
      {!indicadores.loading && indicadores.error && <ErrorText>{indicadores.error}</ErrorText>}

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
            <div className="rounded-panel bg-arena p-4">
              <div className="mb-2 flex justify-end">
                <SelectorTipoGrafica opciones={TIPOS_GASTO} valor={tipoGasto} onChange={setTipoGasto} nombre="gasto por categoría" />
              </div>
              <Grafica key={tipoGasto} opciones={opcionesGasto(datos.gastoPorCategoria, tipoGasto)} altura={tipoGasto === 'barras' ? Math.max(260, datos.gastoPorCategoria.length * 44 + 90) : 380} />
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

export type TipoGasto = 'barras' | 'columnas' | 'dona' | 'arbol';

const TIPOS_GASTO: { clave: TipoGasto; etiqueta: string; ayuda: string }[] = [
  { clave: 'barras', etiqueta: 'Barras', ayuda: 'Gasto (MXN) de cada categoría, de la que más gasto concentra a la que menos.' },
  { clave: 'columnas', etiqueta: 'Columnas', ayuda: 'Gasto (MXN) por categoría en columnas, para compararlas lado a lado.' },
  { clave: 'dona', etiqueta: 'Dona', ayuda: 'Qué porcentaje del gasto total representa cada categoría.' },
  { clave: 'arbol', etiqueta: 'Mapa de árbol', ayuda: 'El área de cada bloque es su gasto: las categorías grandes saltan a la vista.' },
];

/** Gasto por categoría en cuatro formas; el tooltip siempre trae gasto, participación y canastas. */
function opcionesGasto(datos: CategorySpend[], tipo: TipoGasto): Highcharts.Options {
  const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const filas = [...datos].sort((a, b) => b.totalSpend - a.totalSpend);
  const detalle = (c: CategorySpend) =>
    `<b>${c.categoryName}</b><br/>${fmt.format(c.totalSpend)} · ${Number(c.share).toFixed(1)} % del gasto<br/>${c.basketCount} canastas`;
  const tooltip: Highcharts.TooltipOptions = { useHTML: true, formatter() { const c = filas[this.index]; return c ? detalle(c) : ''; } };
  const paleta = [COLORES.teal, COLORES.salvia, COLORES.vino, '#B8A98A', '#4F6F68', '#A66A5B', '#7E8F5A'];

  if (tipo === 'dona') {
    return {
      chart: { type: 'pie' },
      tooltip: { useHTML: true, formatter() { const c = filas[this.index]; return c ? detalle(c) : ''; } },
      plotOptions: { pie: { innerSize: '58%', borderRadius: 6, dataLabels: { enabled: true, format: '{point.name}: {point.percentage:.1f} %', style: { textOutline: 'none', color: COLORES.teal } } } },
      series: [{ type: 'pie', name: 'Gasto', data: filas.map((c, i) => ({ name: c.categoryName, y: c.totalSpend, color: paleta[i % paleta.length] })) }],
    };
  }

  if (tipo === 'arbol') {
    return {
      tooltip: { useHTML: true, formatter() { const c = filas.find((f) => f.categoryName === (this as unknown as { name: string }).name); return c ? detalle(c) : ''; } },
      series: [
        {
          type: 'treemap',
          layoutAlgorithm: 'squarified',
          data: filas.map((c, i) => ({ name: c.categoryName, value: c.totalSpend, color: paleta[i % paleta.length] })),
          dataLabels: { enabled: true, format: '{point.name}', style: { textOutline: 'none', fontWeight: '600', color: '#FAF8F2' } },
        },
      ],
    };
  }

  const horizontal = tipo === 'barras';
  return {
    chart: { type: horizontal ? 'bar' : 'column' },
    xAxis: { categories: filas.map((c) => c.categoryName) },
    yAxis: { min: 0, title: { text: 'Gasto (MXN)' } },
    legend: { enabled: false },
    tooltip,
    series: [
      {
        type: horizontal ? 'bar' : 'column',
        name: 'Gasto',
        borderRadius: 6,
        data: filas.map((c, i) => ({ y: c.totalSpend, color: paleta[i % paleta.length] })),
      },
    ],
  };
}
