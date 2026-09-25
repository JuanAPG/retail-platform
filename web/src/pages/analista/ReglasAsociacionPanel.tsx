import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { EmptyState } from '../../components/EmptyState';
import { useFetch } from '../../hooks/useFetch';
import { getCorrida, getCorridas, parametro } from '../../api/asociacion';
import { getTiendas, getZonas } from '../../api/catalogo';
import { getSegmentos } from '../../api/segmentos';
import { AssociationRule } from '../../types';
import { CorridaAprioriForm } from './CorridaAprioriForm';
import { CorridaDetalle } from './CorridaDetalle';
import { EstadoCorridaBadge, formatearFechaHora, porcentaje } from './corridaFormato';

/**
 * M10 — Reglas de asociación: correr Apriori, consultar el historial de
 * corridas y abrir una con sus parámetros, supuestos y reglas.
 */
export function ReglasAsociacionPanel() {
  const tiendas = useFetch(getTiendas, []);
  const zonas = useFetch(getZonas, []);
  const segmentos = useFetch(getSegmentos, []);
  const corridas = useFetch(getCorridas, []);

  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const detalle = useFetch(() => (seleccionada ? getCorrida(seleccionada) : Promise.resolve(null)), [seleccionada]);

  /** Abre la corrida más reciente: la recién creada cuando no trae reglas (y por tanto runId). */
  async function abrirMasReciente() {
    try {
      const lista = await getCorridas();
      if (lista[0]) setSeleccionada(lista[0].id);
    } finally {
      corridas.refetch();
    }
  }

  function trasCorrer(reglas: AssociationRule[]) {
    if (reglas.length > 0) {
      setAviso(null);
      setSeleccionada(reglas[0].runId);
      corridas.refetch();
    } else {
      setAviso('La corrida no generó reglas con esos umbrales; prueba bajando el soporte o la confianza.');
      void abrirMasReciente();
    }
  }

  const lista = corridas.data ?? [];
  const catalogos = { tiendas: tiendas.data ?? [], zonas: zonas.data ?? [], segmentos: segmentos.data ?? [] };

  return (
    <section>
      <SectionHeader
        title="Reglas de asociación"
        description="Productos que se compran juntos (Apriori). Cada corrida se guarda con sus parámetros, datos y supuestos para poder reproducirla."
        action={
          <button
            type="button"
            onClick={corridas.refetch}
            disabled={corridas.loading}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {corridas.loading ? 'Cargando…' : 'Actualizar'}
          </button>
        }
      />

      <CorridaAprioriForm
        {...catalogos}
        onTerminada={trasCorrer}
        onFallida={() => {
          setAviso(null);
          void abrirMasReciente();
        }}
      />

      {aviso && (
        <div className="mb-4 flex items-start justify-between gap-4 rounded border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm text-amber-800">{aviso}</p>
          <button
            type="button"
            onClick={() => setAviso(null)}
            aria-label="Cerrar aviso"
            className="text-sm text-amber-700 hover:text-amber-900"
          >
            ✕
          </button>
        </div>
      )}

      {corridas.error && <p className="mb-4 text-sm text-red-600">{corridas.error}</p>}

      {!corridas.loading && !corridas.error && lista.length === 0 ? (
        <EmptyState
          title="Aún no se ha ejecutado ningún análisis"
          description="Corre Apriori sobre las canastas para descubrir productos que se compran juntos."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Historial</h2>
            <ul className="space-y-2">
              {lista.map((corrida) => {
                const generadas = Number(parametro(corrida, 'reglas_generadas') ?? 0);
                const excluidas = Number(parametro(corrida, 'reglas_excluidas_rn10') ?? 0);
                const activa = corrida.id === seleccionada;
                return (
                  <li key={corrida.id}>
                    <button
                      type="button"
                      onClick={() => setSeleccionada(corrida.id)}
                      className={`w-full rounded border px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                        activa ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-700">{formatearFechaHora(corrida.date)}</span>
                        <EstadoCorridaBadge estado={corrida.status} />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Soporte {porcentaje(parametro(corrida, 'soporte_minimo'))} · confianza{' '}
                        {porcentaje(parametro(corrida, 'confianza_minima'))}
                      </p>
                      {corrida.status === 'fallida' ? (
                        <p className="mt-1 truncate text-xs text-rose-600">{corrida.errorMessage}</p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500">
                          {corrida.basketsConsidered} canastas · {generadas - excluidas} regla(s)
                          {excluidas > 0 && ` (${excluidas} excluidas por RN-10)`}
                        </p>
                      )}
                      {corrida.user && <p className="mt-1 text-xs text-slate-400">{corrida.user.nombre}</p>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Detalle de la corrida</h2>
            <CorridaDetalle
              corrida={detalle.data}
              loading={Boolean(seleccionada) && detalle.loading}
              error={detalle.error}
              onReintentar={detalle.refetch}
              {...catalogos}
            />
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        Soporte: en qué porcentaje de las canastas aparece la regla completa. Confianza: de quienes compran lo
        primero, qué porcentaje lleva también lo segundo. Lift mayor a 1: se compran juntos más de lo que explicaría
        la popularidad de cada producto. Una regla indica coocurrencia, no causalidad.
      </p>
    </section>
  );
}
