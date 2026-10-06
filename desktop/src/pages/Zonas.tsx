import { useEffect, useMemo, useState } from 'react';
import { compareZones, listMunicipalities, listZones } from '../api/catalogApi';
import { Municipality, Zone, ZoneComparison } from '../api/catalogParsers';
import { extractErrorMessage } from '../api/httpClient';
import BotonesExportar from '../components/BotonesExportar';
import { Columna } from '../utils/exportar';

/** Minúsculas y sin acentos, para que "Garza" encuentre "garza" y "Garzá". */
function normalizar(texto: string): string {
  return texto.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

const dinero = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const vacio = '—';

const COLUMNAS_COMPARACION: Columna<ZoneComparison>[] = [
  { clave: 'zona', titulo: 'Zona', valor: (c) => c.zoneName },
  { clave: 'municipio', titulo: 'Municipio', valor: (c) => c.municipality },
  { clave: 'clasificacion', titulo: 'Clasificación', valor: (c) => c.classification },
  { clave: 'ingreso_estimado', titulo: 'Ingreso estimado', valor: (c) => c.estimatedIncome },
  { clave: 'poblacion', titulo: 'Población', valor: (c) => c.population },
  { clave: 'disponibilidad', titulo: 'Disponibilidad', valor: (c) => c.availability },
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

  if (cargando) return <p>Cargando zonas...</p>;
  if (error) return <p className="alert-error">{error}</p>;

  return (
    <div>
      <h1>Comparar zonas</h1>
      <p className="muted">
        Selecciona dos o más zonas y compáralas por clasificación, ingreso, población y disponibilidad.
      </p>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Buscar por nombre, municipio o descripción"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select value={municipioId} onChange={(e) => setMunicipioId(e.target.value)}>
          <option value="">Todos los municipios</option>
          {municipios.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}>
          <option value="todas">Todas</option>
          <option value="activas">Solo activas</option>
          <option value="inactivas">Solo inactivas</option>
        </select>
        <button onClick={comparar} disabled={seleccion.size < 2 || comparando}>
          {comparando ? 'Comparando...' : `Comparar (${seleccion.size})`}
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Zona</th>
              <th>Municipio</th>
              <th>Descripción</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Ninguna zona coincide con la búsqueda.
                </td>
              </tr>
            )}
            {visibles.map((z) => (
              <tr key={z.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar ${z.nombre}`}
                    checked={seleccion.has(z.id)}
                    onChange={() => alternar(z.id)}
                  />
                </td>
                <td>{z.nombre}</td>
                <td>{z.municipio}</td>
                <td>{z.descripcion || vacio}</td>
                <td>{z.activo ? 'Activa' : 'Inactiva'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        {visibles.length} de {zonas.length} zonas
      </p>

      {errorComparacion && <p className="alert-error">{errorComparacion}</p>}

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
                  <th>Clasificación</th>
                  <th>Ingreso estimado</th>
                  <th>Población</th>
                  <th>Disponibilidad</th>
                </tr>
              </thead>
              <tbody>
                {comparacion.map((c) => (
                  <tr key={c.zoneId}>
                    <td>{c.zoneName}</td>
                    <td>{c.municipality}</td>
                    <td>{c.classification ?? vacio}</td>
                    <td>{c.estimatedIncome === null ? vacio : dinero(c.estimatedIncome)}</td>
                    <td>{c.population === null ? vacio : c.population.toLocaleString('es-MX')}</td>
                    <td>{c.availability ?? vacio}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            «—» significa que Analítica todavía no calcula ese indicador para la zona.
          </p>
        </section>
      )}
    </div>
  );
}