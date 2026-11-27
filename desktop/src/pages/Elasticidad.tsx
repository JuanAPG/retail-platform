import { FormEvent, useEffect, useMemo, useState } from 'react';
import { calcularElasticidad, elasticidadVigente, graficaElasticidad } from '../api/algorithmsApi';
import {
  BarraElasticidad,
  ElasticidadCalculo,
  ElasticidadGrafica,
  ElasticidadResultado,
  ElasticidadVigente,
  NOMBRE_CLASE,
} from '../api/algorithmsParsers';
import { listProducts } from '../api/catalogApi';
import { Producto } from '../api/catalogParsers';
import { extractErrorMessage } from '../api/httpClient';
import BotonesExportar from '../components/BotonesExportar';
import { puede } from '../config/menu';
import { useAuth } from '../context/AuthContext';
import { Columna } from '../utils/exportar';
import Aviso from '../components/Aviso';
import { Cargando, FilaVacia } from '../components/EstadosTabla';
import { InsigniaElasticidad, Insignia } from '../components/Insignias';
import { Calculator, ChartColumn, TrendingDown } from 'lucide-react';

/*
 * Elasticidad precio-demanda (M11, algorithms-core). D-31: el Analista (y los demás perfiles del
 * escritorio, M11 = L) consultan; SOLO el Responsable de precios calcula. Clasificación (D-18):
 * unitaria si 0.95 ≤ |E| ≤ 1.05. Sin variación de precio el servicio lo reporta en `insufficient`,
 * nunca como Infinity ni NaN.
 */

const vacio = '—';
const fmt = (n: number | null, d = 4) => (n === null || Number.isNaN(n) ? vacio : n.toFixed(d));
const clase = (c: string | null) => (c ? NOMBRE_CLASE[c] ?? c : vacio);

const COLUMNAS_RESULTADO: Columna<ElasticidadResultado>[] = [
  { clave: 'producto', titulo: 'Producto', valor: (r) => r.productName },
  { clave: 'presentacion', titulo: 'Presentación', valor: (r) => r.presentationName },
  { clave: 'zona', titulo: 'Zona', valor: (r) => r.zoneName },
  { clave: 'elasticidad', titulo: 'Elasticidad (E)', valor: (r) => r.value },
  { clave: 'clasificacion', titulo: 'Clasificación', valor: (r) => clase(r.classification) },
  { clave: 'r_cuadrada', titulo: 'R²', valor: (r) => r.rSquared },
  { clave: 'observaciones', titulo: 'Observaciones', valor: (r) => r.observations },
  { clave: 'atipica', titulo: 'Atípica (E > 0)', valor: (r) => (r.atypical ? 'sí' : 'no') },
];

const COLUMNAS_VIGENTE: Columna<ElasticidadVigente>[] = [
  ...(COLUMNAS_RESULTADO as Columna<ElasticidadVigente>[]),
  { clave: 'desactualizada', titulo: 'Desactualizada', valor: (r) => (r.outdated ? 'sí' : 'no') },
  { clave: 'periodo', titulo: 'Periodo', valor: (r) => `${r.periodStart} a ${r.periodEnd}` },
];

const COLUMNAS_BARRAS: Columna<BarraElasticidad>[] = [
  { clave: 'grupo', titulo: 'Zona o segmento', valor: (b) => b.label },
  { clave: 'elasticidad', titulo: 'Elasticidad (E)', valor: (b) => b.value },
  { clave: 'clasificacion', titulo: 'Clasificación', valor: (b) => clase(b.classification) },
  { clave: 'observaciones', titulo: 'Observaciones', valor: (b) => b.observations },
  { clave: 'r_cuadrada', titulo: 'R²', valor: (b) => b.rSquared },
];

function TablaResultados({ filas, vigente }: { filas: ElasticidadResultado[]; vigente?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Presentación</th>
            <th>Zona</th>
            <th className="num">E</th>
            <th>Clasificación</th>
            <th className="num">R²</th>
            <th className="num">Obs.</th>
            {vigente && <th>Periodo</th>}
          </tr>
        </thead>
        <tbody>
          {filas.length === 0 && (
            <FilaVacia columnas={vigente ? 8 : 7} icono={TrendingDown}>Sin elasticidades calculadas.</FilaVacia>
          )}
          {filas.map((r, i) => (
            <tr key={`${r.presentationId}-${r.zoneId ?? 'nacional'}-${i}`}>
              <td>{r.productName}</td>
              <td>{r.presentationName}</td>
              <td>{r.zoneName}</td>
              <td className="num">{fmt(r.value)}</td>
              <td>
                <span className="insignias">
                  <InsigniaElasticidad clase={r.classification} />
                  {r.atypical && <Insignia tono="ambar">Atípica (E &gt; 0)</Insignia>}
                  {vigente && (r as ElasticidadVigente).outdated && <Insignia tono="gris">Desactualizada</Insignia>}
                </span>
              </td>
              <td className="num">{fmt(r.rSquared, 2)}</td>
              <td className="num">{r.observations.toLocaleString('es-MX')}</td>
              {vigente && (
                <td>
                  {(r as ElasticidadVigente).periodStart} a {(r as ElasticidadVigente).periodEnd}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Barras horizontales: a la izquierda del eje, E negativa (lo normal); a la derecha, atípica. */
function Grafica({ g }: { g: ElasticidadGrafica }) {
  const maximo = Math.max(1, ...g.bars.map((b) => Math.abs(b.value ?? 0)), Math.abs(g.national?.value ?? 0));
  return (
    <div className="grafica">
      {g.bars.map((b) => (
        <div className="barra-fila" key={b.key}>
          <span className="barra-etiqueta">{b.label}</span>
          <span className="barra-pista">
            {b.value === null ? (
              <span className="muted">sin datos suficientes</span>
            ) : (
              <span
                className={b.value > 0 ? 'barra atipica' : 'barra'}
                style={{ width: `${(Math.abs(b.value) / maximo) * 100}%` }}
                title={`${fmt(b.value)} · ${clase(b.classification)}`}
              />
            )}
          </span>
          <span className="barra-valor">
            {fmt(b.value, 2)} {b.classification ? `(${clase(b.classification)})` : ''}
          </span>
        </div>
      ))}
      <p className="muted">
        Nacional: {g.national ? `${fmt(g.national.value, 2)} (${clase(g.national.classification)})` : 'sin datos suficientes'} ·{' '}
        {g.note}
      </p>
    </div>
  );
}

export default function Elasticidad() {
  const { usuario } = useAuth();
  const puedeCalcular = puede(usuario?.rol, 'calcularElasticidad');

  const [productos, setProductos] = useState<Producto[]>([]);
  const [vigentes, setVigentes] = useState<ElasticidadVigente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Comparación por zona o segmento (gráfica).
  const [presentacionGrafica, setPresentacionGrafica] = useState('');
  const [groupBy, setGroupBy] = useState<'zone' | 'segment'>('zone');
  const [grafica, setGrafica] = useState<ElasticidadGrafica | null>(null);
  const [errorGrafica, setErrorGrafica] = useState<string | null>(null);

  // Cálculo (solo Responsable de precios).
  const [presentacionCalculo, setPresentacionCalculo] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('week');
  const [calculando, setCalculando] = useState(false);
  const [calculo, setCalculo] = useState<ElasticidadCalculo | null>(null);
  const [errorCalculo, setErrorCalculo] = useState<string | null>(null);

  async function cargarVigentes() {
    try {
      setVigentes(await elasticidadVigente());
      setError(null);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  useEffect(() => {
    Promise.all([cargarVigentes(), listProducts().then(setProductos).catch(() => setProductos([]))]).finally(() =>
      setCargando(false),
    );
  }, []);

  const presentaciones = useMemo(
    () =>
      productos.flatMap((p) =>
        p.presentaciones.filter((pr) => pr.activo).map((pr) => ({ id: pr.id, etiqueta: `${p.nombre} · ${pr.nombre}` })),
      ),
    [productos],
  );

  async function verGrafica(e: FormEvent) {
    e.preventDefault();
    if (!presentacionGrafica) return;
    setErrorGrafica(null);
    try {
      setGrafica(await graficaElasticidad(presentacionGrafica, groupBy));
    } catch (err) {
      setGrafica(null);
      setErrorGrafica(extractErrorMessage(err));
    }
  }

  async function calcular(e: FormEvent) {
    e.preventDefault();
    if (!puedeCalcular) return;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setErrorCalculo('La fecha inicial no puede ser posterior a la final.');
      return;
    }
    setErrorCalculo(null);
    setCalculando(true);
    try {
      setCalculo(
        await calcularElasticidad({
          presentationId: presentacionCalculo || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          granularity,
        }),
      );
      await cargarVigentes();
    } catch (err) {
      setErrorCalculo(extractErrorMessage(err));
    } finally {
      setCalculando(false);
    }
  }

  const selectorPresentacion = (valor: string, cambiar: (v: string) => void, vacioTexto: string) => (
    <select value={valor} onChange={(e) => cambiar(e.target.value)}>
      <option value="">{vacioTexto}</option>
      {presentaciones.map((p) => (
        <option key={p.id} value={p.id}>
          {p.etiqueta}
        </option>
      ))}
    </select>
  );

  if (cargando) return <Cargando texto="Cargando elasticidades…" />;

  return (
    <div>
      <h1>Elasticidad precio-demanda</h1>
      <p className="muted">
        Cuánto cambia la cantidad vendida cuando cambia el precio. Unitaria si 0.95 ≤ |E| ≤ 1.05 (D-18). Servicios:
        algorithms-core (cálculo y consultas) y catalog-service (presentaciones).
      </p>
      {error && <Aviso tipo="error">{error}</Aviso>}

      <h2>Calcular</h2>
      {!puedeCalcular && (
        <Aviso tipo="info">
          Tu rol ({usuario?.rol}) consulta la elasticidad; solo el Responsable de precios la calcula (D-31).
        </Aviso>
      )}
      <form className="panel form-grid" onSubmit={calcular}>
        <label>
          Presentación (opcional)
          {selectorPresentacion(presentacionCalculo, setPresentacionCalculo, 'Todas las que tienen ventas')}
        </label>
        <label>
          Granularidad
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}>
            <option value="week">Semana (recomendada, D-21)</option>
            <option value="day">Día</option>
            <option value="month">Mes</option>
          </select>
        </label>
        <label>
          Desde (opcional)
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label>
          Hasta (opcional)
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={!puedeCalcular || calculando} title={puedeCalcular ? '' : 'Solo Responsable de precios'}>
            <Calculator size={16} aria-hidden="true" />
            {calculando ? 'Calculando…' : 'Calcular elasticidad'}
          </button>
        </div>
        {(dateFrom || dateTo) && (
          <p className="muted wide">
            Con fechas, la corrida es exploratoria y no se vuelve la elasticidad vigente (D-22).
          </p>
        )}
      </form>
      {errorCalculo && <Aviso tipo="error">{errorCalculo}</Aviso>}
      {calculo && (
        <section>
          <h3>
            Corrida {calculo.runId}: {calculo.periodStart} a {calculo.periodEnd} ({calculo.granularity})
          </h3>
          <div className="toolbar">
            <BotonesExportar
              nombreArchivo="elasticidad-calculo"
              raizXml="elasticidades"
              filaXml="elasticidad"
              columnas={COLUMNAS_RESULTADO}
              filas={calculo.results}
            />
          </div>
          <TablaResultados filas={calculo.results} />
          {calculo.insufficient.length > 0 && (
            <details open>
              <summary>Sin datos suficientes ({calculo.insufficient.length})</summary>
              <ul>
                {calculo.insufficient.map((i, n) => (
                  <li key={n}>
                    {i.productName} · {i.presentationName} · {i.zoneName}: {i.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {calculo.assumptions.length > 0 && (
            <details>
              <summary>Supuestos ({calculo.assumptions.length})</summary>
              <ul>
                {calculo.assumptions.map((a, n) => (
                  <li key={n}>{a}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <h2>Comparar entre zonas o segmentos</h2>
      <form className="panel form-grid" onSubmit={verGrafica}>
        <label>
          Presentación
          {selectorPresentacion(presentacionGrafica, setPresentacionGrafica, 'Elige una presentación')}
        </label>
        <label>
          Agrupar por
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'zone' | 'segment')}>
            <option value="zone">Zona</option>
            <option value="segment">Segmento de ingreso</option>
          </select>
        </label>
        <div className="form-actions">
          <button type="submit" disabled={!presentacionGrafica}>
            <ChartColumn size={16} aria-hidden="true" />
            Ver comparación
          </button>
        </div>
      </form>
      {errorGrafica && <Aviso tipo="error">{errorGrafica}</Aviso>}
      {grafica && (
        <section>
          <p className="muted">
            {grafica.productName} · {grafica.presentationName} · corrida del {grafica.executedAt} ({grafica.periodStart} a{' '}
            {grafica.periodEnd})
          </p>
          <div className="toolbar">
            <BotonesExportar
              nombreArchivo="elasticidad-comparacion"
              raizXml="comparacionElasticidad"
              filaXml="grupo"
              columnas={COLUMNAS_BARRAS}
              filas={grafica.bars}
            />
          </div>
          <Grafica g={grafica} />
        </section>
      )}

      <h2>Elasticidad vigente</h2>
      <p className="muted">
        La de la corrida más reciente de ventana completa para cada presentación y zona (D-22); la fila «Nacional» aplica
        a todas las zonas.
      </p>
      <div className="toolbar">
        <BotonesExportar
          nombreArchivo="elasticidad-vigente"
          raizXml="elasticidadesVigentes"
          filaXml="elasticidad"
          columnas={COLUMNAS_VIGENTE}
          filas={vigentes}
        />
      </div>
      <TablaResultados filas={vigentes} vigente />
    </div>
  );
}
