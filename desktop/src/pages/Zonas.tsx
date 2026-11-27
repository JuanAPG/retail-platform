import { useEffect, useMemo, useState } from 'react';
import { compareZones, listMunicipalities, listZones } from '../api/catalogApi';
import { Municipality, Zone, ZoneComparison } from '../api/catalogParsers';
import { extractErrorMessage } from '../api/httpClient';
import BotonesExportar from '../components/BotonesExportar';
import { Columna } from '../utils/exportar';
import Aviso from '../components/Aviso';
import { Cargando, FilaVacia } from '../components/EstadosTabla';
import { InsigniaIngreso, InsigniaSiNo } from '../components/Insignias';
import { GitCompareArrows, MapPinned } from 'lucide-react';
import { aNumero, miles, mxn, proporcion } from '../utils/formato';

/** Minúsculas y sin acentos, para que "Garza" encuentre "garza" y "Garzá". */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

const vacio = '—';

/**
 * Disponibilidad de básicos de la zona: llega como proporción (0.95) y se muestra como porcentaje
 * (95 %). Nula = todavía no se calcula para la zona (nunca 0).
 */
const disponibilidadPct = (c: ZoneComparison): number | null => {
  const n = aNumero(c.availability);
  return n === null ? null : Math.round(n * 1000) / 10;
};

const NOTA_DISPONIBILIDAD = 'Porcentaje de productos de la canasta básica que se encuentran en las tiendas de la zona.';

const COLUMNAS_COMPARACION: Columna<ZoneComparison>[] = [
  { clave: 'zona', titulo: 'Zona', valor: (c) => c.zoneName },
  { clave: 'municipio', titulo: 'Municipio', valor: (c) => c.municipality },
  { clave: 'clasificacion', titulo: 'Clasificación', valor: (c) => c.classification },
  { clave: 'ingreso_estimado', titulo: 'Ingreso estimado', valor: (c) => c.estimatedIncome },
  { clave: 'poblacion', titulo: 'Población', valor: (c) => c.population },
  { clave: 'disponibilidad_basicos_pct', titulo: 'Disponibilidad de básicos (%)', valor: disponibilidadPct },
];

export default function Zonas() {
  const [zonas, setZonas] = useState<Zone[]>([]);
  const [municipios, setMunicipios] = useState<Municipality[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Búsqueda y filtros (se aplican en pantalla sobre las zonas ya cargadas).
  const [busqueda, setBusqueda] = useState('');
  const [municipioId, setMunicipioId] = useState('');
  const [estado, setEstado] = useState<'todas' | 'activas' | 'inactivas'>('todas');

  // Selección y resultado de la comparación.
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [comparacion, setComparacion] = useState<ZoneComparison[] | null>(null);
  const [comparando, setComparando] = useState(false);
  const [errorComparacion, setErrorComparacion] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listZones(), listMunicipalities()])
      .then(([z, m]) => {
        setZonas(z);
        setMunicipios(m);
      })
      .catch((e) => setError(extractErrorMessage(e)))
      .finally(() => setCargando(false));
  }, []);

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    return zonas.filter((z) => {
      if (q && !normalizar(`${z.nombre} ${z.municipio} ${z.descripcion}`).includes(q)) return false;
      if (municipioId && String(z.municipioId) !== municipioId) return false;
      if (estado === 'activas' && !z.activo) return false;
      if (estado === 'inactivas' && z.activo) return false;
      return true;
    });
  }, [zonas, busqueda, municipioId, estado]);

  function alternar(id: string) {
    setSeleccion((previa) => {
      const nueva = new Set(previa);
      if (nueva.has(id)) nueva.delete(id);
      else nueva.add(id);
      return nueva;
    });
  }

  async function comparar() {
    setComparando(true);
    setErrorComparacion(null);
    try {
      setComparacion(await compareZones([...seleccion]));
    } catch (e) {
      setComparacion(null);
      setErrorComparacion(extractErrorMessage(e));
    } finally {
      setComparando(false);
    }
  }

  if (cargando) return <Cargando texto="Cargando zonas…" />;
  if (error) return <Aviso tipo="error">{error}</Aviso>;

  return (
    <div>
      <h1>Comparar zonas</h1>
      <p className="muted">
        Selecciona dos o más zonas y compáralas por clasificación, ingreso, población y disponibilidad.
      </p>

      <div className="panel form-grid">
        <label className="wide">
          Buscar
          <input
            type="search"
            placeholder="Nombre, municipio o descripción"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </label>
        <label>
          Municipio
          <select value={municipioId} onChange={(e) => setMunicipioId(e.target.value)}>
            <option value="">Todos los municipios</option>
            {municipios.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estado
          <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
            <option value="todas">Todas</option>
            <option value="activas">Solo activas</option>
            <option value="inactivas">Solo inactivas</option>
          </select>
        </label>
        <div className="form-actions">
          <button onClick={comparar} disabled={seleccion.size < 2 || comparando}>
            <GitCompareArrows size={16} aria-hidden="true" />
            {comparando ? 'Comparando…' : `Comparar (${seleccion.size})`}
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="check-col">
                <span className="sr-only">Seleccionar</span>
              </th>
              <th>Zona</th>
              <th>Municipio</th>
              <th>Descripción</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <FilaVacia columnas={5} icono={MapPinned}>
                Ninguna zona coincide con la búsqueda.
              </FilaVacia>
            )}
            {visibles.map((z) => (
              <tr key={z.id}>
                <td className="check-col">
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${z.nombre}`}
                    checked={seleccion.has(z.id)}
                    onChange={() => alternar(z.id)}
                  />
                </td>
                <td>
                  <strong>{z.nombre}</strong>
                </td>
                <td>{z.municipio}</td>
                <td>{z.descripcion || vacio}</td>
                <td>
                  <InsigniaSiNo si={z.activo} textoSi="Activa" textoNo="Inactiva" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tabla-pie">
        {visibles.length} de {zonas.length} zonas · elige dos o más para compararlas
      </p>

      {errorComparacion && <Aviso tipo="error">{errorComparacion}</Aviso>}

      {comparacion && (
        <section>
          <h2>Resultado de la comparación</h2>
          <div className="toolbar">
            <BotonesExportar
              nombreArchivo="comparacion-zonas"
              raizXml="comparacion"
              filaXml="zona"
              columnas={COLUMNAS_COMPARACION}
              filas={comparacion}
            />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Zona</th>
                  <th>Municipio</th>
                  <th>Nivel de ingreso</th>
                  <th className="num">Ingreso estimado</th>
                  <th className="num">Población</th>
                  <th className="num" title={NOTA_DISPONIBILIDAD}>
                    Disponibilidad de básicos
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparacion.map((c) => (
                  <tr key={c.zoneId}>
                    <td>
                      <strong>{c.zoneName}</strong>
                    </td>
                    <td>{c.municipality}</td>
                    <td>
                      <InsigniaIngreso nivel={c.classification} />
                    </td>
                    <td className="num">{mxn(c.estimatedIncome)}</td>
                    <td className="num">{miles(c.population, 0)}</td>
                    <td className="num">{proporcion(aNumero(c.availability), 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tabla-pie">
            <strong>Disponibilidad de básicos:</strong> {NOTA_DISPONIBILIDAD}
          </p>
          <p className="tabla-pie">«—» significa que Analítica todavía no calcula ese indicador para la zona.</p>
        </section>
      )}
    </div>
  );
}