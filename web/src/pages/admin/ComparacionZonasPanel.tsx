import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { compararZonas, ZoneComparisonRow } from '../../api/catalogo';
import { mensajeDeError } from '../../api/errores';
import { Zona } from '../../types';

interface ComparacionZonasPanelProps {
  estado: UseFetchState<Zona[]>;
}

function formatoNumero(valor: number | null, unidad: string): string {
  if (valor === null) return 'Sin datos';
  return `${new Intl.NumberFormat('es-MX').format(valor)} ${unidad}`;
}

/**
 * M03 — Compara zonas por su clasificación vigente y sus indicadores
 * más recientes (ingreso estimado, población, disponibilidad). Esos
 * indicadores los calcula Analítica (M09); aquí solo se leen.
 */
export function ComparacionZonasPanel({ estado }: ComparacionZonasPanelProps) {
  const zonas = estado.data ?? [];
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const [resultado, setResultado] = useState<ZoneComparisonRow[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function alternarSeleccion(id: string) {
    setSeleccionadas((actuales) =>
      actuales.includes(id) ? actuales.filter((x) => x !== id) : [...actuales, id],
    );
    setResultado(null);
  }

  async function comparar() {
    setError(null);
    setCargando(true);
    try {
      const filas = await compararZonas(seleccionadas);
      setResultado(filas);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo comparar las zonas.'));
    } finally {
      setCargando(false);
    }
  }

  return (
    <section>
      <SectionHeader
        title="Comparar zonas"
        description="Clasificación vigente e indicadores más recientes (ingreso estimado, población, disponibilidad) de las zonas que elijas."
      />

      {estado.loading && <p className="text-sm text-slate-500">Cargando zonas…</p>}
      {estado.error && <p className="text-sm text-rose-600">{estado.error}</p>}

      {zonas.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          {zonas.map((z) => (
            <label
              key={z.id}
              className="flex items-center gap-2 rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              <input
                type="checkbox"
                checked={seleccionadas.includes(z.id)}
                onChange={() => alternarSeleccion(z.id)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {z.nombre}
            </label>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={comparar}
        disabled={seleccionadas.length < 2 || cargando}
        title={seleccionadas.length < 2 ? 'Selecciona al menos 2 zonas' : undefined}
        className="mb-6 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {cargando ? 'Comparando…' : 'Comparar'}
      </button>

      {error && (
        <p role="alert" className="mb-4 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {!resultado && (
        <EmptyState
          title="Selecciona al menos 2 zonas"
          description="Marca las zonas que quieres comparar y presiona «Comparar»."
        />
      )}

      {resultado && resultado.length > 0 && (
        <DataTable
          rowKey={(r) => r.zoneId}
          rows={resultado}
          columns={[
            { header: 'Zona', render: (r) => r.zoneName },
            { header: 'Municipio', render: (r) => r.municipality },
            { header: 'Segmento vigente', render: (r) => r.classification ?? 'Sin clasificar' },
            { header: 'Ingreso estimado', render: (r) => formatoNumero(r.estimatedIncome, 'MXN') },
            { header: 'Población', render: (r) => formatoNumero(r.population, 'hab.') },
            { header: 'Disponibilidad', render: (r) => formatoNumero(r.availability, '%') },
          ]}
        />
      )}
    </section>
  );
}
