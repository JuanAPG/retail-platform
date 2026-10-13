import { FormEvent, useState } from 'react';
import type Highcharts from 'highcharts';
import { useAuth } from '../../context/AuthContext';
import { SectionHeader } from '../../components/SectionHeader';
import { Grafica } from '../../components/Grafica';
import { SelectorTipoGrafica } from '../../components/SelectorTipoGrafica';
import { COLORES } from '../../components/coloresGrafica';
import { ErrorText } from '../../components/ui/ErrorText';
import { mensajeDeError } from '../../api/errores';
import { listaSegura } from '../../api/seguro';
import {
  compararProporciones,
  correrAnova,
  CondicionCanastas,
  FuenteCanastas,
  GrupoConteo,
  GrupoValores,
  MetricaCanastas,
  probarHipotesis,
  ResultadoMedias,
  ResultadoProporciones,
  ResumenGrupo,
  ResumenProporcion,
} from '../../api/estadistica';
import { IncomeSegment, Zona } from '../../types';

type Prueba = 'hipotesis' | 'anova' | 'proporciones';
type Origen = 'canastas' | 'manual';

const PRUEBAS: { clave: Prueba; titulo: string; ayuda: string }[] = [
  { clave: 'hipotesis', titulo: 'Hipótesis (2 grupos)', ayuda: 'Compara el promedio de dos zonas o segmentos y dice si la diferencia es estadística.' },
  { clave: 'anova', titulo: 'ANOVA (más de 2)', ayuda: 'Compara el promedio de varias zonas o segmentos a la vez. Dice si alguno difiere, no cuál.' },
  { clave: 'proporciones', titulo: 'Proporciones', ayuda: 'Compara qué proporción de canastas cumple algo (por ejemplo, llevar productos básicos) entre grupos.' },
];

const METRICAS: Record<MetricaCanastas, string> = { totalValue: 'Ticket de la canasta (MXN)', productCount: 'Productos distintos por canasta', unitsTotal: 'Unidades por canasta' };
const CONDICIONES: Record<CondicionCanastas, string> = {
  hasBasicProducts: 'Lleva productos básicos',
  chica: 'Es una compra chica',
  mediana: 'Es una compra mediana',
  grande: 'Es una compra grande',
};

const inputClass =
  'h-12 rounded-full border-2 border-transparent bg-marfil px-4 text-[14px] text-tinta outline-none transition focus:border-vino hover:border-salvia/60 disabled:opacity-50';
const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

/** p-value legible: nunca "0.0000" ni notación científica en pantalla. */
export function formatearP(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p < 0.0001) return '< 0.0001';
  return p.toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

const num = (n: number | null | undefined, d = 2) =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

interface GrupoManual {
  id: number;
  label: string;
  valores: string; // hipótesis y ANOVA: números separados por coma, espacio o salto de línea
  exitos: string; // proporciones
  total: string;
}

/** Convierte el texto "12, 15.5  18" en números; devuelve null si algo no es un número finito. */
function leerNumeros(texto: string): number[] | null {
  const partes = texto.split(/[\s,;]+/).filter(Boolean);
  const numeros = partes.map((p) => Number(p.replace(',', '.')));
  return numeros.every((n) => Number.isFinite(n)) ? numeros : null;
}

/**
 * RF-20/21/22 — Pruebas estadísticas entre grupos agregados (zonas o segmentos), con los datos de las
 * canastas o con valores escritos a mano. Solo el Analista comercial las corre (D-24); los demás perfiles
 * ven una nota. Los resultados se leen como diferencia estadística en estos datos, nunca como causa.
 */
export function EstadisticaPanel({ zonas, segmentos }: { zonas: Zona[]; segmentos: IncomeSegment[] }) {
  const { usuario } = useAuth();
  const puedeCorrer = usuario?.rol === 'Analista comercial';

  const [prueba, setPrueba] = useState<Prueba>('hipotesis');
  const [origen, setOrigen] = useState<Origen>('canastas');
  const [agruparPor, setAgruparPor] = useState<'zone' | 'segment'>('zone');
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [metrica, setMetrica] = useState<MetricaCanastas>('totalValue');
  const [condicion, setCondicion] = useState<CondicionCanastas>('hasBasicProducts');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [alfa, setAlfa] = useState('0.05');
  const [metodo, setMetodo] = useState<'auto' | 'welch' | 'mannwhitney'>('auto');
  const [alternativa, setAlternativa] = useState<'two-sided' | 'greater' | 'less'>('two-sided');
  const [manuales, setManuales] = useState<GrupoManual[]>([
    { id: 1, label: 'Grupo A', valores: '', exitos: '', total: '' },
    { id: 2, label: 'Grupo B', valores: '', exitos: '', total: '' },
  ]);

  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [medias, setMedias] = useState<ResultadoMedias | null>(null);
  const [proporciones, setProporciones] = useState<ResultadoProporciones | null>(null);
  const [tipoMedias, setTipoMedias] = useState<'medias' | 'mediana'>('medias');
  const [tipoProp, setTipoProp] = useState<'columnas' | 'barras' | 'dona'>('columnas');

  const opcionesGrupo = agruparPor === 'zone' ? listaSegura<Zona>(zonas).map((z) => ({ id: z.id, nombre: z.nombre })) : listaSegura<IncomeSegment>(segmentos).map((s) => ({ id: String(s.id), nombre: s.name }));
  const minGrupos = prueba === 'hipotesis' ? 2 : prueba === 'anova' ? 2 : 2;
  const maxGrupos = prueba === 'hipotesis' ? 2 : 20;

  function cambiarPrueba(p: Prueba) {
    setPrueba(p);
    setError(null);
    setMedias(null);
    setProporciones(null);
    setElegidos([]);
  }
  function alternarGrupo(id: string) {
    setElegidos((previos) => (previos.includes(id) ? previos.filter((x) => x !== id) : [...previos, id]));
  }

  async function correr(e: FormEvent) {
    e.preventDefault();
    if (corriendo) return;
    setError(null);
    const a = Number(alfa);
    if (!(a > 0 && a < 1)) return setError('El nivel de significancia (α) debe estar entre 0 y 1; lo común es 0.05.');

    let cuerpoValores: GrupoValores[] | undefined;
    let cuerpoConteos: GrupoConteo[] | undefined;
    let baskets: FuenteCanastas | undefined;

    if (origen === 'canastas') {
      if (elegidos.length < minGrupos) return setError(`Elige al menos ${minGrupos} ${agruparPor === 'zone' ? 'zonas' : 'segmentos'} para comparar.`);
      if (elegidos.length > maxGrupos) return setError(`Esta prueba compara como máximo ${maxGrupos} grupos.`);
      if (desde && hasta && desde > hasta) return setError('La fecha «desde» no puede ser posterior a «hasta».');
      baskets = {
        groupBy: agruparPor,
        groupIds: elegidos,
        ...(prueba === 'proporciones' ? { condition: condicion } : { metric: metrica }),
        ...(desde ? { dateFrom: desde } : {}),
        ...(hasta ? { dateTo: hasta } : {}),
      };
    } else {
      if (manuales.length < minGrupos || manuales.length > maxGrupos) return setError(`Escribe entre ${minGrupos} y ${maxGrupos} grupos.`);
      const etiquetas = manuales.map((g) => g.label.trim());
      if (etiquetas.some((l) => !l || l.length > 60)) return setError('Cada grupo necesita un nombre de 1 a 60 caracteres.');
      if (new Set(etiquetas).size !== etiquetas.length) return setError('Los nombres de los grupos no se pueden repetir.');
      if (prueba === 'proporciones') {
        const conteos: GrupoConteo[] = [];
        for (const g of manuales) {
          const s = Number(g.exitos);
          const t = Number(g.total);
          if (!Number.isInteger(s) || s < 0 || !Number.isInteger(t) || t < 1) return setError(`«${g.label}»: éxitos y total deben ser enteros (total ≥ 1).`);
          if (s > t) return setError(`«${g.label}»: los éxitos no pueden ser más que el total.`);
          conteos.push({ label: g.label.trim(), successes: s, total: t });
        }
        cuerpoConteos = conteos;
      } else {
        const grupos: GrupoValores[] = [];
        for (const g of manuales) {
          const valores = leerNumeros(g.valores);
          if (!valores) return setError(`«${g.label}»: hay valores que no son números.`);
          if (valores.length < 2) return setError(`«${g.label}»: escribe al menos 2 valores.`);
          grupos.push({ label: g.label.trim(), values: valores });
        }
        cuerpoValores = grupos;
      }
    }

    setCorriendo(true);
    try {
      if (prueba === 'proporciones') {
        setProporciones(await compararProporciones({ alpha: a, ...(baskets ? { baskets } : { groups: cuerpoConteos }) }));
        setMedias(null);
      } else {
        const base = { alpha: a, ...(baskets ? { baskets } : { groups: cuerpoValores }) };
        setMedias(prueba === 'hipotesis' ? await probarHipotesis({ ...base, method: metodo, alternative: alternativa }) : await correrAnova(base));
        setProporciones(null);
      }
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo correr la prueba. Intenta de nuevo.'));
    } finally {
      setCorriendo(false);
    }
  }

  const ayuda = PRUEBAS.find((p) => p.clave === prueba)?.ayuda;

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Pruebas estadísticas"
        description="Comparan zonas o segmentos (nunca personas) y dicen si una diferencia es estadística. No prueban una causa."
      />

      <div className="flex flex-wrap gap-2 px-6" role="tablist" aria-label="Tipo de prueba">
        {PRUEBAS.map((p) => (
          <button
            key={p.clave}
            type="button"
            role="tab"
            aria-selected={prueba === p.clave}
            onClick={() => cambiarPrueba(p.clave)}
            className={`flex h-11 items-center rounded-full px-5 text-sm font-bold transition ${prueba === p.clave ? 'bg-vino text-arena' : 'bg-arena text-teal hover:bg-salvia/30'}`}
          >
            {p.titulo}
          </button>
        ))}
      </div>
      <p className="px-6 text-sm text-teal/80">{ayuda}</p>

      {!puedeCorrer && (
        <p className="mx-6 rounded-full bg-arena px-5 py-3 text-sm text-teal">Solo el Analista comercial corre pruebas estadísticas; tu perfil no las ejecuta.</p>
      )}

      {puedeCorrer && (
        <form noValidate onSubmit={correr} className="mx-6 flex flex-col gap-5 rounded-panel bg-arena p-6">
          <div className="flex flex-wrap gap-2" role="group" aria-label="De dónde salen los datos">
            {(['canastas', 'manual'] as const).map((o) => (
              <button
                key={o}
                type="button"
                aria-pressed={origen === o}
                onClick={() => { setOrigen(o); setError(null); }}
                className={`flex h-10 items-center rounded-full px-4 text-xs font-bold transition ${origen === o ? 'bg-teal text-arena' : 'bg-marfil text-teal hover:bg-salvia/30'}`}
              >
                {o === 'canastas' ? 'Datos de las canastas' : 'Escribir los valores'}
              </button>
            ))}
          </div>

          {origen === 'canastas' ? (
            <>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                <label className={labelClass}>
                  Comparar por
                  <select className={inputClass} value={agruparPor} onChange={(e) => { setAgruparPor(e.target.value as 'zone' | 'segment'); setElegidos([]); }}>
                    <option value="zone">Zona</option>
                    <option value="segment">Segmento de ingreso</option>
                  </select>
                </label>
                {prueba === 'proporciones' ? (
                  <label className={labelClass}>
                    Qué proporción
                    <select className={inputClass} value={condicion} onChange={(e) => setCondicion(e.target.value as CondicionCanastas)}>
                      {Object.entries(CONDICIONES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                ) : (
                  <label className={labelClass}>
                    Qué medir
                    <select className={inputClass} value={metrica} onChange={(e) => setMetrica(e.target.value as MetricaCanastas)}>
                      {Object.entries(METRICAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                )}
                <label className={labelClass}>
                  Desde
                  <input type="date" className={inputClass} value={desde} onChange={(e) => setDesde(e.target.value)} />
                </label>
                <label className={labelClass}>
                  Hasta
                  <input type="date" className={inputClass} value={hasta} onChange={(e) => setHasta(e.target.value)} />
                </label>
              </div>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-[13px] font-semibold text-teal">
                  {agruparPor === 'zone' ? 'Zonas' : 'Segmentos'} a comparar ({prueba === 'hipotesis' ? 'elige 2' : 'elige 2 o más'})
                </legend>
                <div className="flex flex-wrap gap-2">
                  {opcionesGrupo.length === 0 && <span className="text-sm text-teal/70">No hay {agruparPor === 'zone' ? 'zonas' : 'segmentos'} cargados.</span>}
                  {opcionesGrupo.map((g) => (
                    <label key={g.id} className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm transition ${elegidos.includes(g.id) ? 'bg-vino text-arena' : 'bg-marfil text-tinta hover:bg-salvia/30'}`}>
                      <input type="checkbox" className="sr-only" checked={elegidos.includes(g.id)} onChange={() => alternarGrupo(g.id)} />
                      <span className="max-w-[16rem] truncate">{g.nombre}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              {manuales.map((g, i) => (
                <div key={g.id} className="grid grid-cols-1 gap-3 rounded-[28px] bg-marfil p-4 sm:grid-cols-[14rem_1fr_auto]">
                  <label className={labelClass}>
                    Nombre
                    <input className={inputClass} value={g.label} maxLength={60} onChange={(e) => setManuales((m) => m.map((x) => (x.id === g.id ? { ...x, label: e.target.value } : x)))} />
                  </label>
                  {prueba === 'proporciones' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <label className={labelClass}>
                        Casos que cumplen
                        <input type="number" min="0" className={inputClass} value={g.exitos} onChange={(e) => setManuales((m) => m.map((x) => (x.id === g.id ? { ...x, exitos: e.target.value } : x)))} />
                      </label>
                      <label className={labelClass}>
                        Total de casos
                        <input type="number" min="1" className={inputClass} value={g.total} onChange={(e) => setManuales((m) => m.map((x) => (x.id === g.id ? { ...x, total: e.target.value } : x)))} />
                      </label>
                    </div>
                  ) : (
                    <label className={labelClass}>
                      Valores (separados por coma, espacio o salto de línea)
                      <textarea rows={2} className="rounded-[24px] border-2 border-transparent bg-arena px-4 py-3 text-[14px] font-normal text-tinta outline-none focus:border-vino" value={g.valores} onChange={(e) => setManuales((m) => m.map((x) => (x.id === g.id ? { ...x, valores: e.target.value } : x)))} />
                    </label>
                  )}
                  <button
                    type="button"
                    aria-label={`Quitar ${g.label || `grupo ${i + 1}`}`}
                    disabled={manuales.length <= minGrupos}
                    onClick={() => setManuales((m) => m.filter((x) => x.id !== g.id))}
                    className="self-end rounded-full px-3 py-2.5 text-sm font-bold text-vino hover:bg-vino/10 disabled:opacity-30"
                  >
                    Quitar
                  </button>
                </div>
              ))}
              {manuales.length < maxGrupos && (
                <button
                  type="button"
                  onClick={() => setManuales((m) => [...m, { id: Math.max(0, ...m.map((x) => x.id)) + 1, label: `Grupo ${String.fromCharCode(65 + m.length)}`, valores: '', exitos: '', total: '' }])}
                  className="self-start rounded-full border-2 border-salvia/60 px-4 py-2 text-sm font-bold text-teal hover:bg-salvia hover:text-tinta"
                >
                  Agregar grupo
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3.5">
            <label className={labelClass}>
              Nivel de significancia (α)
              <input type="number" step="0.01" min="0.001" max="0.5" className={`${inputClass} w-40`} value={alfa} onChange={(e) => setAlfa(e.target.value)} />
            </label>
            {prueba === 'hipotesis' && (
              <>
                <label className={labelClass}>
                  Método
                  <select className={inputClass} value={metodo} onChange={(e) => setMetodo(e.target.value as typeof metodo)}>
                    <option value="auto">Automático</option>
                    <option value="welch">Welch (t sin varianzas iguales)</option>
                    <option value="mannwhitney">Mann-Whitney</option>
                  </select>
                </label>
                <label className={labelClass}>
                  Hipótesis alternativa
                  <select className={inputClass} value={alternativa} onChange={(e) => setAlternativa(e.target.value as typeof alternativa)}>
                    <option value="two-sided">Hay diferencia (dos colas)</option>
                    <option value="greater">El primero es mayor</option>
                    <option value="less">El primero es menor</option>
                  </select>
                </label>
              </>
            )}
            <button
              type="submit"
              disabled={corriendo}
              className="ml-auto flex h-[52px] shrink-0 items-center rounded-full bg-teal px-6 text-[15px] font-bold text-arena transition hover:bg-vino disabled:opacity-50"
            >
              {corriendo ? 'Calculando…' : 'Correr prueba'}
            </button>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
        </form>
      )}

      {medias && prueba !== 'proporciones' && (
        <Resultado resultado={medias}>
          <div className="mb-2 flex justify-end">
            <SelectorTipoGrafica
              nombre="la prueba"
              valor={tipoMedias}
              onChange={setTipoMedias}
              opciones={[
                { clave: 'medias', etiqueta: 'Medias ± desviación', ayuda: 'Promedio de cada grupo con una desviación estándar hacia cada lado.' },
                { clave: 'mediana', etiqueta: 'Media y mediana', ayuda: 'Si la media y la mediana se separan mucho, hay valores extremos.' },
              ]}
            />
          </div>
          <Grafica key={tipoMedias} opciones={opcionesMedias(medias, tipoMedias)} altura={340} />
          <TablaGrupos filas={listaSegura<ResumenGrupo>(medias.groups).map((g) => [g.label, String(g.n), num(g.mean), num(g.median), num(g.standardDeviation)])} columnas={['Grupo', 'n', 'Media', 'Mediana', 'Desv. estándar']} />
        </Resultado>
      )}

      {proporciones && prueba === 'proporciones' && (
        <Resultado resultado={proporciones}>
          <div className="mb-2 flex justify-end">
            <SelectorTipoGrafica
              nombre="proporciones"
              valor={tipoProp}
              onChange={setTipoProp}
              opciones={[
                { clave: 'columnas', etiqueta: 'Columnas', ayuda: 'Porcentaje de casos que cumplen en cada grupo.' },
                { clave: 'barras', etiqueta: 'Barras', ayuda: 'Lo mismo en horizontal, del grupo con mayor proporción al menor.' },
                { clave: 'dona', etiqueta: 'Dona', ayuda: 'Cómo se reparten entre los grupos los casos que cumplen.' },
              ]}
            />
          </div>
          <Grafica key={tipoProp} opciones={opcionesProporciones(proporciones, tipoProp)} altura={340} />
          <TablaGrupos
            filas={listaSegura<ResumenProporcion>(proporciones.groups).map((g) => [g.label, String(g.successes), String(g.total), `${num(g.proportion * 100, 1)} %`])}
            columnas={['Grupo', 'Cumplen', 'Total', 'Proporción']}
          />
        </Resultado>
      )}
    </section>
  );
}

function Resultado({ resultado, children }: { resultado: ResultadoMedias | ResultadoProporciones; children: React.ReactNode }) {
  const supuestos = Array.isArray(resultado.assumptions) ? resultado.assumptions : [];
  const detalles = [
    ['Prueba', resultado.test],
    ['Estadístico', num(resultado.statistic, 3)],
    ['p-value', formatearP(Number(resultado.pValue))],
    ['α', String(resultado.alpha)],
    ...(resultado.degreesOfFreedom != null ? [['Grados de libertad', num(resultado.degreesOfFreedom, 1)]] : []),
    ...(resultado.dfBetween != null ? [['gl entre / dentro', `${resultado.dfBetween} / ${resultado.dfWithin ?? '—'}`]] : []),
  ];
  return (
    <div className="mx-6 flex flex-col gap-4 rounded-panel bg-arena p-6" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-4 py-1.5 text-sm font-bold ${resultado.rejectNull ? 'bg-vino text-arena' : 'bg-salvia/40 text-teal'}`}>
          {resultado.rejectNull ? 'Hay diferencia estadística' : 'Sin evidencia suficiente de diferencia'}
        </span>
        <span className="font-data text-sm text-teal">p = {formatearP(Number(resultado.pValue))}</span>
      </div>
      <p className="text-[15px] text-tinta">{typeof resultado.conclusion === 'string' ? resultado.conclusion : ''}</p>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {detalles.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-teal/70">{k}</dt>
            <dd className="font-data text-tinta">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-[28px] bg-marfil p-4">{children}</div>
      {supuestos.length > 0 && (
        <details className="text-sm text-teal">
          <summary className="cursor-pointer font-semibold text-teal/70">Qué supone esta prueba</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {supuestos.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function TablaGrupos({ columnas, filas }: { columnas: string[]; filas: string[][] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[320px] text-left text-sm">
        <thead>
          <tr className="text-[12px] font-semibold text-teal">{columnas.map((c) => <th key={c} className="px-3 py-1.5">{c}</th>)}</tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-salvia/25 text-tinta">
              {f.map((c, j) => <td key={j} className={`px-3 py-1.5 ${j === 0 ? '' : 'font-data'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function opcionesMedias(r: ResultadoMedias, tipo: 'medias' | 'mediana'): Highcharts.Options {
  const grupos = listaSegura<ResumenGrupo>(r.groups);
  const categorias = grupos.map((g) => g.label);
  if (tipo === 'mediana') {
    return {
      chart: { type: 'column' },
      xAxis: { categories: categorias },
      yAxis: { min: 0, title: { text: 'Valor' } },
      tooltip: { shared: true, valueDecimals: 2 },
      series: [
        { type: 'column', name: 'Media', data: grupos.map((g) => g.mean), color: COLORES.teal, borderRadius: 6 },
        { type: 'column', name: 'Mediana', data: grupos.map((g) => g.median), color: COLORES.salvia, borderRadius: 6 },
      ],
    };
  }
  return {
    chart: { type: 'column' },
    xAxis: { categories: categorias },
    yAxis: { title: { text: 'Media ± 1 desviación estándar' } },
    legend: { enabled: false },
    tooltip: { shared: true, valueDecimals: 2 },
    series: [
      { type: 'column', name: 'Media', data: grupos.map((g) => g.mean), color: COLORES.salvia, borderRadius: 6 },
      { type: 'errorbar', name: '± 1 desv. estándar', data: grupos.map((g) => [g.mean - g.standardDeviation, g.mean + g.standardDeviation]), color: COLORES.vino, whiskerLength: 14 },
    ],
  };
}

function opcionesProporciones(r: ResultadoProporciones, tipo: 'columnas' | 'barras' | 'dona'): Highcharts.Options {
  const lista = listaSegura<ResumenProporcion>(r.groups);
  const grupos = tipo === 'barras' ? [...lista].sort((a, b) => b.proportion - a.proportion) : lista;
  const paleta = [COLORES.teal, COLORES.salvia, COLORES.vino, '#B8A98A', '#4F6F68', '#A66A5B', '#7E8F5A'];
  if (tipo === 'dona') {
    return {
      chart: { type: 'pie' },
      tooltip: { pointFormat: '<b>{point.y}</b> casos que cumplen · {point.percentage:.1f} %' },
      plotOptions: { pie: { innerSize: '58%', borderRadius: 6, dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { textOutline: 'none', color: COLORES.teal } } } },
      series: [{ type: 'pie', name: 'Cumplen', data: grupos.map((g, i) => ({ name: g.label, y: g.successes, color: paleta[i % paleta.length] })) }],
    };
  }
  return {
    chart: { type: tipo === 'barras' ? 'bar' : 'column' },
    xAxis: { categories: grupos.map((g) => g.label) },
    yAxis: { min: 0, max: 100, title: { text: 'Proporción que cumple (%)' } },
    legend: { enabled: false },
    tooltip: { pointFormat: '<b>{point.y:.1f} %</b>' },
    series: [
      {
        type: tipo === 'barras' ? 'bar' : 'column',
        name: 'Proporción',
        borderRadius: 6,
        data: grupos.map((g, i) => ({ y: Math.round(g.proportion * 1000) / 10, color: paleta[i % paleta.length] })),
        dataLabels: { enabled: true, format: '{y:.1f} %' },
      },
    ],
  };
}
