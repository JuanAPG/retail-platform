import { useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { getCorrida, getCorridas, parametro } from '../../api/asociacion';
import { getTiendas, getZonas } from '../../api/catalogo';
import { getSegmentos } from '../../api/segmentos';
import { AssociationRule } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { IconAsociacion } from '../../components/ui/icons';
import { CorridaAprioriForm } from './CorridaAprioriForm';
import { CorridaDetalle } from './CorridaDetalle';
import { EstadoCorridaBadge, formatearFechaHora, porcentaje } from './corridaFormato';

/** M10 — Reglas de asociación: correr Apriori, consultar el historial de corridas y abrir una con sus parámetros, supuestos y reglas. */
export function ReglasAsociacionPanel() {
  const tiendas = useFetch(getTiendas, []);
  const zonas = useFetch(getZonas, []);
  const segmentos = useFetch(getSegmentos, []);
  const corridas = useFetch(getCorridas, []);

  const [seleccionada, setSeleccionada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const detalle = useFetch(() => (seleccionada ? getCorrida(seleccionada) : Promise.resolve(null)), [seleccionada]);

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
    <div className="flex flex-col gap-6">
      <Hero
        title="Asociaciones"
        subtitle="Productos que se compran juntos (Apriori)"
        decorations={
          <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
            <IconAsociacion className="mt-8 h-[74px] w-[74px]" />
          </div>
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
        <div className="flex items-center justify-between gap-4 rounded-full bg-vino/10 px-5 py-3">
          <p className="text-sm font-semibold text-vino">{aviso}</p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="text-sm text-vino">
            ✕
          </button>
        </div>
      )}

      {corridas.error && <p className="px-1 text-sm font-semibold text-vino">{corridas.error}</p>}

      {!corridas.loading && !corridas.error && lista.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-2xl text-teal">Aún no se ha ejecutado ningún análisis</p>
          <p className="text-sm text-teal/70">Corre Apriori sobre las canastas para descubrir productos que se compran juntos.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-2">
            <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-teal/70">Historial</h2>
            {lista.map((corrida) => {
              const generadas = Number(parametro(corrida, 'reglas_generadas') ?? 0);
              const excluidas = Number(parametro(corrida, 'reglas_excluidas_rn10') ?? 0);
              const activa = corrida.id === seleccionada;
              return (
                <button
                  key={corrida.id}
                  type="button"
                  onClick={() => setSeleccionada(corrida.id)}
                  className={`flex flex-col gap-1 rounded-[28px] border-2 px-4 py-3 text-left transition hover:translate-x-1 ${
                    activa ? 'border-transparent bg-teal text-arena' : 'border-transparent bg-arena text-tinta hover:border-salvia'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm ${activa ? 'text-arena' : 'text-teal'}`}>{formatearFechaHora(corrida.date)}</span>
                    <EstadoCorridaBadge estado={corrida.status} />
                  </div>
                  <p className={`font-data text-xs ${activa ? 'text-salvia' : 'text-teal/70'}`}>
                    soporte {porcentaje(parametro(corrida, 'soporte_minimo'))} · confianza {porcentaje(parametro(corrida, 'confianza_minima'))}
                  </p>
                  {corrida.status === 'fallida' ? (
                    <p className="truncate text-xs text-vino">{corrida.errorMessage}</p>
                  ) : (
                    <p className={`font-data text-xs ${activa ? 'text-salvia' : 'text-teal/70'}`}>
                      {corrida.basketsConsidered} canastas · {generadas - excluidas} regla(s)
                      {excluidas > 0 && ` (${excluidas} excluidas)`}
                    </p>
                  )}
                  {corrida.user && <p className={`text-xs ${activa ? 'text-salvia' : 'text-teal/60'}`}>{corrida.user.nombre}</p>}
                </button>
              );
            })}
          </div>

          <div>
            <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-teal/70">Detalle de la corrida</h2>
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

      <p className="px-1 text-xs text-teal/60">
        Soporte: en qué porcentaje de las canastas aparece la regla completa. Confianza: de quienes compran lo
        primero, qué porcentaje lleva también lo segundo. Lift mayor a 1: se compran juntos más de lo que explicaría
        la popularidad de cada producto.
      </p>
    </div>
  );
}
