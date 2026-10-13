import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { Grafica } from '../../components/Grafica';
import { SelectorTipoGrafica } from '../../components/SelectorTipoGrafica';
import { COLORES } from '../../components/coloresGrafica';
import type Highcharts from 'highcharts';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { Badge } from '../../components/Badge';
import { Select } from '../../components/ui/Select';
import { ErrorText } from '../../components/ui/ErrorText';
import { useFetch } from '../../hooks/useFetch';
import { getCategorias } from '../../api/catalogo';
import { getPatronesSustitucion } from '../../api/elasticidad';
import { SubstitutionPattern } from '../../types';
import { listaSegura } from '../../api/seguro';
import { formatearDia } from './corridaFormato';

const TIPO: Record<SubstitutionPattern['type'], { texto: string; tono: 'warning' | 'neutral'; flecha: string }> = {
  // Dirigido: B reemplaza a A cuando A sube de precio.
  precio: { texto: 'Por precio', tono: 'warning', flecha: '→' },
  // Simétrico: se compra uno u otro.
  preferencia: { texto: 'Por preferencia', tono: 'neutral', flecha: '↔' },
};

const dosDecimales = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

/** Un tipo que el servicio agregue mañana no debe tumbar la pantalla. */
const tipoDe = (t: string) => TIPO[t as keyof typeof TIPO] ?? TIPO.preferencia;

/**
 * M11 — Patrones de sustitución (S1-16) de una categoría. El backend los
 * calcula al momento y no los guarda; como el contrato devuelve solo la
 * lista, el método y sus supuestos se explican aquí.
 */
export function SustitucionPanel() {
  const categorias = useFetch(getCategorias, []);
  const [categoria, setCategoria] = useState('');
  const [tipoGrafica, setTipoGrafica] = useState<TipoSustitucion>('barras');
  const patrones = useFetch(
    () => (categoria ? getPatronesSustitucion(categoria) : Promise.resolve(null)),
    [categoria],
  );

  const nombreCategoria = categorias.data?.find((c) => String(c.id) === categoria)?.nombre ?? '';
  const lista = listaSegura<SubstitutionPattern>(patrones.data);

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Sustitución"
        description="Productos de una misma categoría que se reemplazan entre sí: la gente compra uno u otro."
        action={
          <button
            type="button"
            onClick={patrones.refetch}
            disabled={!categoria || patrones.loading}
            className="flex h-11 items-center rounded-full border-2 border-salvia/60 px-4 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta disabled:cursor-not-allowed disabled:opacity-50"
          >
            {patrones.loading && categoria ? 'Cargando…' : 'Actualizar'}
          </button>
        }
      />

      <div className="max-w-sm">
        <Select id="sus-categoria" label="Categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Elige una categoría">
          {(categorias.data ?? []).map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.nombre}
            </option>
          ))}
        </Select>
      </div>

      {!categoria && (
        <EmptyState
          title="Elige una categoría"
          description="Se buscan sustitutos entre los productos de esa categoría, con las canastas registradas."
        />
      )}
      {categoria && patrones.loading && <p className="text-sm text-teal/70">Buscando patrones…</p>}
      {categoria && !patrones.loading && patrones.error && (
        <div className="flex items-center gap-3">
          <ErrorText>{patrones.error}</ErrorText>
          <button
            type="button"
            onClick={patrones.refetch}
            className="flex h-11 shrink-0 items-center rounded-full border-2 border-salvia/60 px-4 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta"
          >
            Reintentar
          </button>
        </div>
      )}
      {categoria && !patrones.loading && !patrones.error && lista.length === 0 && (
        <EmptyState
          title={`No se detectaron sustitutos en ${nombreCategoria}`}
          description="Puede deberse a que sus productos se compran juntos (no se reemplazan), a que alguno aparece en menos de 2 canastas, o a que hay muy pocas ventas para distinguirlo del azar."
        />
      )}
      {categoria && !patrones.loading && !patrones.error && lista.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="rounded-panel bg-arena p-4">
            <div className="mb-2 flex justify-end">
              <SelectorTipoGrafica opciones={TIPOS_SUSTITUCION} valor={tipoGrafica} onChange={setTipoGrafica} nombre="sustitución" />
            </div>
            <Grafica
              key={tipoGrafica}
              opciones={opcionesSustitucion(lista, tipoGrafica)}
              altura={tipoGrafica === 'barras' ? Math.max(220, lista.length * 38 + 80) : 360}
            />
          </div>
          <DataTable
            rowKey={(p) => `${p.originProductId}-${p.targetProductId}-${p.type}`}
            rows={lista}
            columns={[
              {
                header: 'Producto → Lo reemplaza',
                render: (p) => (
                  <div>
                    <p className="text-tinta">
                      {p.originProductName} <span className="text-teal/50">{tipoDe(p.type).flecha}</span> {p.targetProductName}
                    </p>
                    <p className="mt-0.5 font-data text-xs text-teal/70">
                      lift {Number(p.lift).toLocaleString('es-MX', dosDecimales)} · r{' '}
                      {p.priceCorrelation === null || p.priceCorrelation === undefined ? '—' : Number(p.priceCorrelation).toLocaleString('es-MX', dosDecimales)} ·{' '}
                      {p.observations} canastas
                    </p>
                    {p.summary && <p className="mt-1 max-w-xl text-xs text-teal/80">{p.summary}</p>}
                  </div>
                ),
              },
              { header: 'Tipo', render: (p) => <Badge tone={tipoDe(p.type).tono}>{tipoDe(p.type).texto}</Badge> },
              {
                header: 'Fuerza',
                className: 'w-56',
                render: (p) => (
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded-full bg-marfil">
                      <div className="h-2 rounded-full bg-vino" style={{ width: `${p.score * 100}%` }} />
                    </div>
                    <span className="w-12 text-right font-data text-xs tabular-nums text-teal">{Math.round(p.score * 100)} %</span>
                  </div>
                ),
              },
            ]}
          />
          <p className="text-xs text-teal/70">
            Datos del {formatearDia(lista[0].periodStart)} al {formatearDia(lista[0].periodEnd)}.
          </p>
        </div>
      )}

      {/* Umbrales copiados de substitution.service.ts (PRICE_CORRELATION_MIN,
          MIN_BASKETS_PER_PRODUCT, MIN_EXPECTED_TOGETHER): si cambian allá, actualizar aquí. */}
      <details className="text-sm text-teal">
        <summary className="cursor-pointer font-semibold text-teal/70">Cómo se detecta (método y supuestos)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Regla: dos productos de la misma categoría se compran juntos menos de lo que se esperaría si no tuvieran
            relación entre sí, considerando solo las canastas que incluyen productos de esa categoría.
          </li>
          <li>
            Tipo: si las canastas llevan más del segundo producto cuando el primero sube de precio, se clasifica como
            «Por precio»; si no hay esa relación, como «Por preferencia».
          </li>
          <li>Mínimos: cada producto debe aparecer en al menos 2 canastas, con suficientes datos para que la comparación sea confiable.</li>
          <li>No detecta sustitución por falta de inventario: el sistema no lleva historial de existencias.</li>
          <li>Se calcula al momento con las canastas registradas; a diferencia de otros análisis, este no se guarda para consultarlo después.</li>
        </ol>
      </details>
    </section>
  );
}

export type TipoSustitucion = 'barras' | 'burbujas' | 'dona';

const TIPOS_SUSTITUCION: { clave: TipoSustitucion; etiqueta: string; ayuda: string }[] = [
  { clave: 'barras', etiqueta: 'Barras', ayuda: 'Fuerza de cada indicio, del más fuerte al más débil.' },
  { clave: 'burbujas', etiqueta: 'Burbujas', ayuda: 'Lift (izquierda = casi no se compran juntos) contra fuerza; el tamaño es el número de canastas.' },
  { clave: 'dona', etiqueta: 'Dona', ayuda: 'Cuántos indicios son por precio y cuántos por preferencia.' },
];

/**
 * Los mismos indicios de sustitución en tres formas. Siempre son indicios de coocurrencia y precio
 * (D-23), no prueba de causa: por precio en vino, por preferencia en salvia.
 */
function opcionesSustitucion(lista: SubstitutionPattern[], tipo: TipoSustitucion): Highcharts.Options {
  const color = (p: SubstitutionPattern) => (p.type === 'precio' ? COLORES.vino : COLORES.salvia);
  const nombre = (p: SubstitutionPattern) => `${p.originProductName} → ${p.targetProductName}`;
  const tipoTexto = (p: SubstitutionPattern) => (p.type === 'precio' ? 'Por precio' : 'Por preferencia');

  if (tipo === 'burbujas') {
    return {
      chart: { type: 'bubble', zooming: { type: 'xy' } },
      xAxis: {
        min: 0,
        max: 1.2,
        title: { text: 'Lift (menor que 1: se compran juntos menos de lo esperado)' },
        plotLines: [{ value: 1, width: 2, color: COLORES.vino, dashStyle: 'Dash', label: { text: 'lift = 1', style: { color: COLORES.vino } } }],
        gridLineWidth: 1,
      },
      yAxis: { min: 0, max: 100, title: { text: 'Fuerza del indicio (%)' } },
      legend: { enabled: false },
      tooltip: {
        useHTML: true,
        formatter() {
          const p = lista[this.index];
          return p ? `<b>${nombre(p)}</b><br/>${tipoTexto(p)} · fuerza ${Math.round(p.score * 100)} %<br/>lift ${Number(p.lift).toFixed(2)} · ${p.observations} canastas` : '';
        },
      },
      series: [
        {
          type: 'bubble',
          name: 'Indicios',
          minSize: 14,
          maxSize: 46,
          data: lista.map((p) => ({ x: Number(p.lift), y: Math.round(p.score * 100), z: Math.max(1, Number(p.observations) || 1), color: color(p), name: nombre(p) })),
          dataLabels: { enabled: true, format: '{point.name}', style: { fontSize: '10px', textOutline: 'none', color: COLORES.teal } },
        },
      ],
    };
  }

  if (tipo === 'dona') {
    const porPrecio = lista.filter((p) => p.type === 'precio').length;
    const porPreferencia = lista.length - porPrecio;
    return {
      chart: { type: 'pie' },
      tooltip: { pointFormat: '<b>{point.y}</b> indicio(s) · {point.percentage:.0f} %' },
      plotOptions: { pie: { innerSize: '58%', borderRadius: 6, dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { textOutline: 'none', color: COLORES.teal } } } },
      series: [
        {
          type: 'pie',
          name: 'Indicios',
          data: [
            { name: 'Por precio', y: porPrecio, color: COLORES.vino },
            { name: 'Por preferencia', y: porPreferencia, color: COLORES.salvia },
          ].filter((d) => d.y > 0),
        },
      ],
    };
  }

  // Barras: del indicio más fuerte al más débil.
  const orden = [...lista].sort((a, b) => Number(b.score) - Number(a.score));
  return {
    chart: { type: 'bar' },
    xAxis: { categories: orden.map(nombre) },
    yAxis: { min: 0, max: 100, title: { text: 'Fuerza del indicio (%)' } },
    legend: { enabled: false },
    tooltip: {
      useHTML: true,
      formatter() {
        const p = orden[this.index];
        return p ? `<b>${nombre(p)}</b><br/>${tipoTexto(p)} · fuerza ${Math.round(p.score * 100)} %<br/>lift ${Number(p.lift).toFixed(2)} · ${p.observations} canastas` : '';
      },
    },
    series: [{ type: 'bar', name: 'Fuerza', borderRadius: 6, data: orden.map((p) => ({ y: Math.round(p.score * 100), color: color(p) })) }],
  };
}
