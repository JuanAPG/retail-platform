import { useState } from 'react';
import { UseFetchState } from '../../hooks/useFetch';
import { compararZonas, ZoneComparisonRow } from '../../api/catalogo';
import { mensajeDeError } from '../../api/errores';
import { Zona } from '../../types';
import { Chip } from '../../components/ui/Chip';
import { Card } from '../../components/ui/Card';
import { IconResultados } from '../../components/ui/icons';

interface ComparacionZonasPanelProps {
  estado: UseFetchState<Zona[]>;
  onVolver: () => void;
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
export function ComparacionZonasPanel({ estado, onVolver }: ComparacionZonasPanelProps) {
  const zonas = estado.data ?? [];
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const [resultado, setResultado] = useState<ZoneComparisonRow[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function alternarSeleccion(id: string) {
    setSeleccionadas((actuales) => (actuales.includes(id) ? actuales.filter((x) => x !== id) : [...actuales, id]));
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl text-vino">Comparar zonas</h1>
          <p className="mt-1 text-sm font-semibold text-teal/70">
            Clasificación e indicadores más recientes de las zonas que elijas.
          </p>
        </div>
        <button
          type="button"
          onClick={onVolver}
          className="flex h-11 items-center rounded-full border-2 border-salvia/60 px-5 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta"
        >
          Volver a Zonas
        </button>
      </div>

      {estado.error && <p className="text-sm font-semibold text-vino">{estado.error}</p>}

      {zonas.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {zonas.map((z) => (
            <Chip key={z.id} active={seleccionadas.includes(z.id)} onClick={() => alternarSeleccion(z.id)}>
              {z.nombre}
            </Chip>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={comparar}
        disabled={seleccionadas.length < 2 || cargando}
        title={seleccionadas.length < 2 ? 'Selecciona al menos 2 zonas' : undefined}
        className="flex h-[52px] w-fit items-center rounded-full bg-teal px-6 text-[15px] font-bold text-arena transition hover:bg-vino disabled:opacity-50"
      >
        {cargando ? 'Comparando…' : 'Comparar'}
      </button>

      {error && (
        <p role="alert" className="rounded-full bg-vino/10 px-5 py-3 text-sm font-semibold text-vino">
          {error}
        </p>
      )}

      {!resultado && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconResultados className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">Selecciona al menos 2 zonas</p>
        </div>
      )}

      {resultado && resultado.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {resultado.map((r) => (
            <Card key={r.zoneId}>
              <div className="flex flex-col gap-0.5">
                <span className="font-display text-[19px] leading-tight text-tinta">{r.zoneName}</span>
                <span className="font-data text-xs text-teal">{r.municipality}</span>
              </div>
              <p className="text-sm font-semibold text-vino">{r.classification ?? 'Sin clasificar'}</p>
              <div className="flex flex-col gap-1 font-data text-xs text-teal">
                <span>Ingreso estimado: {formatoNumero(r.estimatedIncome, 'MXN')}</span>
                <span>Población: {formatoNumero(r.population, 'hab.')}</span>
                <span>Disponibilidad: {formatoNumero(r.availability, '%')}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
