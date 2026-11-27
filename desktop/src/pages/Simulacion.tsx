import { FormEvent, useEffect, useMemo, useState } from 'react';
import { listProducts, listZones } from '../api/catalogApi';
import { Producto, Zone } from '../api/catalogParsers';
import {
  Escenario,
  PresentacionEvaluada,
  ResultadoIndicador,
  SimulacionEmpaque,
  SimulacionPrecio,
  listarEscenarios,
  simularEmpaque,
  simularPrecio,
} from '../api/decisionApi';
import { extractErrorMessage } from '../api/httpClient';
import BotonesExportar from '../components/BotonesExportar';
import { puede } from '../config/menu';
import { useAuth } from '../context/AuthContext';
import { Columna } from '../utils/exportar';

/*
 * Simulación (M13, decision-service). D-31: SOLO el Planeador simula; el Analista (y el
 * Responsable de precios, M13 = L) ven los escenarios guardados. Elasticidad constante (D-01):
 * caso de control demanda 1,000, precio 25 → 27.5, E = −2 → 826 unidades, ingreso −9.1 %.
 * Empaques: mínimo 3 presentaciones del mismo producto (D-14). Las promociones (paquete n×$,
 * D-39) son de promotion-service (3115), que todavía no existe: aquí no se llaman.
 */

const vacio = '—';
const fmt = (n: number | null, d = 2) => (n === null ? vacio : n.toLocaleString('es-MX', { maximumFractionDigits: d }));
const dinero = (n: number | null) => (n === null ? vacio : n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }));

const NOMBRE_INDICADOR: Record<string, string> = {
  demanda_estimada: 'Demanda estimada',
  ingreso_estimado: 'Ingreso estimado',
};

const COLUMNAS_INDICADORES: Columna<ResultadoIndicador>[] = [
  { clave: 'indicador', titulo: 'Indicador', valor: (r) => NOMBRE_INDICADOR[r.indicatorKey] ?? r.indicatorKey },
  { clave: 'base', titulo: 'Base', valor: (r) => r.baseValue },
  { clave: 'simulado', titulo: 'Simulado', valor: (r) => r.simulatedValue },
  { clave: 'variacion_pct', titulo: 'Variación %', valor: (r) => r.variationPct },
];

const COLUMNAS_EMPAQUES: Columna<PresentacionEvaluada>[] = [
  { clave: 'presentacion', titulo: 'Presentación', valor: (p) => p.presentationName },
  { clave: 'estado_precio', titulo: 'Estado del precio', valor: (p) => p.priceStatus },
  { clave: 'desembolso', titulo: 'Desembolso', valor: (p) => p.outlay },
  { clave: 'precio_unitario', titulo: 'Precio unitario', valor: (p) => p.unitPrice },
  { clave: 'unidad_base', titulo: 'Unidad base', valor: (p) => p.baseUnit },
  { clave: 'demanda_estimada', titulo: 'Demanda estimada', valor: (p) => p.estimatedDemand },
  { clave: 'pct_ingreso', titulo: '% del ingreso', valor: (p) => p.incomeSharePct },
];

const COLUMNAS_ESCENARIOS: Columna<Escenario>[] = [
  { clave: 'nombre', titulo: 'Escenario', valor: (e) => e.name },
  { clave: 'tipo', titulo: 'Tipo', valor: (e) => e.type },
  { clave: 'zona', titulo: 'Zona', valor: (e) => e.zoneId },
  { clave: 'precio_actual', titulo: 'Precio actual', valor: (e) => e.currentPrice },
  { clave: 'precio_nuevo', titulo: 'Precio nuevo', valor: (e) => e.newPrice },
  { clave: 'elasticidad', titulo: 'Elasticidad', valor: (e) => e.elasticity },
  { clave: 'creado', titulo: 'Creado', valor: (e) => e.createdAt },
];

function TablaIndicadores({ filas }: { filas: ResultadoIndicador[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Indicador</th>
            <th>Base</th>
            <th>Simulado</th>
            <th>Variación</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r, i) => (
            <tr key={`${r.indicatorKey}-${i}`}>
              <td>{NOMBRE_INDICADOR[r.indicatorKey] ?? r.indicatorKey}</td>
              <td>{fmt(r.baseValue)}</td>
              <td>{fmt(r.simulatedValue)}</td>
              <td>{r.variationPct === null ? vacio : `${fmt(r.variationPct)} %`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Simulacion() {
  const { usuario } = useAuth();
  const puedeSimular = puede(usuario?.rol, 'simular');

  const [productos, setProductos] = useState<Producto[]>([]);
  const [zonas, setZonas] = useState<Zone[]>([]);
  const [escenarios, setEscenarios] = useState<Escenario[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Precio / descuento
  const [productoPrecio, setProductoPrecio] = useState('');
  const [presentacionPrecio, setPresentacionPrecio] = useState('');
  const [zonaPrecio, setZonaPrecio] = useState('');
  const [nuevoPrecio, setNuevoPrecio] = useState('');
  const [resultadoPrecio, setResultadoPrecio] = useState<SimulacionPrecio | null>(null);
  const [errorPrecio, setErrorPrecio] = useState<string | null>(null);

  // Empaque
  const [productoEmpaque, setProductoEmpaque] = useState('');
  const [zonaEmpaque, setZonaEmpaque] = useState('');
  const [resultadoEmpaque, setResultadoEmpaque] = useState<SimulacionEmpaque | null>(null);
  const [errorEmpaque, setErrorEmpaque] = useState<string | null>(null);
  const [simulando, setSimulando] = useState(false);

  async function cargarEscenarios() {
    try {
      setEscenarios((await listarEscenarios()).escenarios);
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  useEffect(() => {
    cargarEscenarios();
    if (puedeSimular) {
      listProducts().then(setProductos).catch((e) => setError(extractErrorMessage(e)));
      listZones().then(setZonas).catch((e) => setError(extractErrorMessage(e)));
    }
  }, [puedeSimular]);

  const presentacionesPrecio = useMemo(
    () => productos.find((p) => p.id === productoPrecio)?.presentaciones.filter((p) => p.activo) ?? [],
    [productos, productoPrecio],
  );
  const empaquesActivos = productos.find((p) => p.id === productoEmpaque)?.presentaciones.filter((p) => p.activo).length ?? 0;

  async function simularDescuento(e: FormEvent) {
    e.preventDefault();
    const precio = Number(nuevoPrecio);
    if (!presentacionPrecio || !zonaPrecio) return setErrorPrecio('Elige producto, presentación y zona.');
    if (!(precio > 0)) return setErrorPrecio('El precio nuevo debe ser mayor que cero.');
    setErrorPrecio(null);
    setSimulando(true);
    try {
      setResultadoPrecio(await simularPrecio({ presentationId: presentacionPrecio, zoneId: zonaPrecio, newPrice: precio }));
      await cargarEscenarios();
    } catch (err) {
      setResultadoPrecio(null);
      setErrorPrecio(extractErrorMessage(err));
    } finally {
      setSimulando(false);
    }
  }

  async function compararEmpaques(e: FormEvent) {
    e.preventDefault();
    if (!productoEmpaque) return setErrorEmpaque('Elige un producto.');
    setErrorEmpaque(null);
    setSimulando(true);
    try {
      setResultadoEmpaque(await simularEmpaque({ productId: productoEmpaque, zoneId: zonaEmpaque || undefined }));
      await cargarEscenarios();
    } catch (err) {
      setResultadoEmpaque(null);
      setErrorEmpaque(extractErrorMessage(err));
    } finally {
      setSimulando(false);
    }
  }

  const opcionesZona = zonas.map((z) => (
    <option key={z.id} value={z.id}>
      {z.nombre}
    </option>
  ));

  return (
    <div>
      <h1>Simulación de precio y empaque</h1>
      <p className="muted">
        Servicios: decision-service (simula y guarda el escenario) y catalog-service (productos y zonas). Modelo de
        elasticidad constante (D-01); es un análisis, no una predicción.
      </p>
      {error && <p className="alert-error">{error}</p>}

      {!puedeSimular ? (
        <p className="alert-info">
          Tu rol ({usuario?.rol}) consulta los escenarios guardados; solo el Planeador simula (D-31).
        </p>
      ) : (
        <>
          <h2>Descuento o cambio de precio</h2>
          <form className="panel form-grid" onSubmit={simularDescuento}>
            <label>
              Producto
              <select
                value={productoPrecio}
                onChange={(e) => {
                  setProductoPrecio(e.target.value);
                  setPresentacionPrecio('');
                }}
              >
                <option value="">Elige un producto</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Presentación
              <select value={presentacionPrecio} onChange={(e) => setPresentacionPrecio(e.target.value)}>
                <option value="">Elige una presentación</option>
                {presentacionesPrecio.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zona
              <select value={zonaPrecio} onChange={(e) => setZonaPrecio(e.target.value)}>
                <option value="">Elige una zona</option>
                {opcionesZona}
              </select>
            </label>
            <label>
              Precio nuevo (MXN)
              <input value={nuevoPrecio} onChange={(e) => setNuevoPrecio(e.target.value)} inputMode="decimal" />
            </label>
            <div className="form-actions">
              <button type="submit" disabled={simulando}>
                {simulando ? 'Simulando...' : 'Simular precio'}
              </button>
            </div>
          </form>
          {errorPrecio && <p className="alert-error">{errorPrecio}</p>}
          {resultadoPrecio && (
            <section>
              <p className="muted">
                Escenario {resultadoPrecio.scenarioId} · precio {dinero(resultadoPrecio.currentPrice)} →{' '}
                {dinero(resultadoPrecio.newPrice)} · E = {fmt(resultadoPrecio.elasticity, 4)} · demanda base{' '}
                {fmt(resultadoPrecio.baseDemand)}
              </p>
              <div className="toolbar">
                <BotonesExportar
                  nombreArchivo="simulacion-precio"
                  raizXml="simulacionPrecio"
                  filaXml="indicador"
                  columnas={COLUMNAS_INDICADORES}
                  filas={resultadoPrecio.results}
                />
              </div>
              <TablaIndicadores filas={resultadoPrecio.results} />
              {resultadoPrecio.note && <p className="muted">{resultadoPrecio.note}</p>}
            </section>
          )}

          <h2>Comparar empaques de un producto</h2>
          <form className="panel form-grid" onSubmit={compararEmpaques}>
            <label>
              Producto
              <select value={productoEmpaque} onChange={(e) => setProductoEmpaque(e.target.value)}>
                <option value="">Elige un producto</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} ({p.presentaciones.filter((x) => x.activo).length} presentaciones)
                  </option>
                ))}
              </select>
            </label>
            <label>
              Zona (opcional: sin ella, datos nacionales)
              <select value={zonaEmpaque} onChange={(e) => setZonaEmpaque(e.target.value)}>
                <option value="">Nacional</option>
                {opcionesZona}
              </select>
            </label>
            <div className="form-actions">
              <button type="submit" disabled={simulando}>
                {simulando ? 'Simulando...' : 'Comparar empaques'}
              </button>
            </div>
            {productoEmpaque && empaquesActivos < 3 && (
              <p className="muted wide">
                Este producto tiene {empaquesActivos} presentaciones activas; el servicio pide al menos 3 (D-14).
              </p>
            )}
          </form>
          {errorEmpaque && <p className="alert-error">{errorEmpaque}</p>}
          {resultadoEmpaque && (
            <section>
              <p className="muted">
                Escenario {resultadoEmpaque.scenarioId} · {resultadoEmpaque.productName}
              </p>
              {resultadoEmpaque.warnings.map((w, i) => (
                <p key={i} className="alert-info">
                  {w}
                </p>
              ))}
              <div className="toolbar">
                <BotonesExportar
                  nombreArchivo="simulacion-empaques"
                  raizXml="simulacionEmpaques"
                  filaXml="presentacion"
                  columnas={COLUMNAS_EMPAQUES}
                  filas={resultadoEmpaque.presentations}
                />
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Presentación</th>
                      <th>Precio</th>
                      <th>Desembolso</th>
                      <th>Precio unitario</th>
                      <th>Demanda estimada</th>
                      <th>% del ingreso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultadoEmpaque.presentations.map((p) => (
                      <tr key={p.presentationId}>
                        <td>{p.presentationName}</td>
                        <td>{p.priceStatus}</td>
                        <td>{dinero(p.outlay)}</td>
                        <td>
                          {dinero(p.unitPrice)}
                          {p.baseUnit ? ` / ${p.baseUnit}` : ''}
                        </td>
                        <td>{fmt(p.estimatedDemand)}</td>
                        <td>{p.incomeSharePct === null ? vacio : `${fmt(p.incomeSharePct)} %`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {resultadoEmpaque.results.length > 0 && <TablaIndicadores filas={resultadoEmpaque.results} />}
            </section>
          )}
        </>
      )}

      <h2>Escenarios guardados</h2>
      <div className="toolbar">
        <BotonesExportar
          nombreArchivo="escenarios"
          raizXml="escenarios"
          filaXml="escenario"
          columnas={COLUMNAS_ESCENARIOS}
          filas={escenarios}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Escenario</th>
              <th>Tipo</th>
              <th>Precio actual → nuevo</th>
              <th>Elasticidad</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            {escenarios.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Todavía no hay escenarios.
                </td>
              </tr>
            )}
            {escenarios.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.type}</td>
                <td>{e.currentPrice === null ? vacio : `${dinero(e.currentPrice)} → ${dinero(e.newPrice)}`}</td>
                <td>{fmt(e.elasticity, 4)}</td>
                <td>{e.createdAt ? new Date(e.createdAt).toLocaleString('es-MX') : vacio}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
