import { useState } from 'react';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { actualizarZona, getMunicipios } from '../../api/catalogo';
import { Zona } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { Card } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { CircleButton } from '../../components/ui/CircleButton';
import { Switch } from '../../components/ui/Switch';
import { IconCerrar as IconEliminar, IconMas, IconOjo, IconZonas } from '../../components/ui/icons';
import { ZonaFormModal } from './ZonaFormModal';
import { ConfirmarEliminarZonaModal } from './ConfirmarEliminarZonaModal';

interface ZonasPanelProps {
  estado: UseFetchState<Zona[]>;
  onComparar: () => void;
}

/** M03 — Zonas. CRUD completo: antes era una tabla de solo lectura. */
export function ZonasPanel({ estado, onComparar }: ZonasPanelProps) {
  const municipios = useFetch(getMunicipios, []);

  const [formAbierto, setFormAbierto] = useState(false);
  const [zonaEditando, setZonaEditando] = useState<Zona | undefined>();
  const [zonaAEliminar, setZonaAEliminar] = useState<Zona | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [cambiandoEstadoDe, setCambiandoEstadoDe] = useState<string | null>(null);

  const zonas = estado.data ?? [];

  function cerrarForm() {
    setFormAbierto(false);
    setZonaEditando(undefined);
  }

  function trasGuardar(mensaje: string) {
    cerrarForm();
    setErrorAccion(null);
    setAviso(mensaje);
    estado.refetch();
  }

  function abrirEdicion(zona: Zona) {
    setZonaEditando(zona);
    setFormAbierto(true);
  }

  async function alternarActivo(zona: Zona) {
    setErrorAccion(null);
    setAviso(null);
    setCambiandoEstadoDe(zona.id);
    try {
      await actualizarZona(zona.id, { activo: !zona.activo });
      setAviso(
        zona.activo ? `Se desactivó la zona "${zona.nombre}".` : `Se activó la zona "${zona.nombre}".`,
      );
      estado.refetch();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, 'No se pudo cambiar el estado de la zona.'));
    } finally {
      setCambiandoEstadoDe(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Zonas"
        subtitle="Área Metropolitana"
        action={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => {
                setZonaEditando(undefined);
                setFormAbierto(true);
              }}
              disabled={!municipios.data || municipios.data.length === 0}
              className="group flex h-[52px] items-center gap-2.5 rounded-full bg-vino py-0 pl-4.5 pr-6 text-[15px] font-bold text-arena transition hover:bg-arena hover:text-vino disabled:opacity-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-arena text-vino transition duration-300 group-hover:rotate-90 group-hover:bg-vino group-hover:text-arena">
                <IconMas className="h-[18px] w-[18px]" />
              </span>
              Nueva zona
            </button>
            <button
              type="button"
              onClick={onComparar}
              className="flex h-[52px] items-center gap-2 rounded-full border-2 border-arena/40 px-5 text-sm font-bold text-arena transition hover:bg-salvia hover:text-tinta"
            >
              Comparar zonas
            </button>
          </div>
        }
        decorations={
          <>
            <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
              <IconZonas className="mt-8 h-[74px] w-[74px]" />
            </div>
            <div className="absolute right-[26px] top-[22px] flex h-[108px] w-[108px] flex-col items-center justify-center gap-0.5 rounded-full bg-arena text-teal">
              <span className="font-display text-[34px] leading-none">{zonas.length}</span>
              <span className="text-[11px] font-semibold">zonas</span>
            </div>
          </>
        }
      />

      {aviso && (
        <div className="flex items-center justify-between gap-4 rounded-full bg-salvia/25 px-5 py-3">
          <p className="text-sm font-semibold text-teal">{aviso}</p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="text-sm text-teal">
            ✕
          </button>
        </div>
      )}
      {errorAccion && (
        <div className="rounded-full bg-vino/10 px-5 py-3">
          <p className="text-sm font-semibold text-vino">{errorAccion}</p>
        </div>
      )}
      {estado.error && (
        <div className="rounded-panel border-2 border-dashed border-vino/40 px-5 py-4">
          <p className="text-sm font-semibold text-vino">No se pudieron cargar las zonas: {estado.error}</p>
        </div>
      )}

      {estado.data && zonas.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconZonas className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">No hay zonas registradas</p>
        </div>
      )}

      {zonas.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {zonas.map((z) => (
            <Card
              key={z.id}
              actions={
                <>
                  <CircleButton icon={<IconOjo className="h-[19px] w-[19px]" />} label={`Editar ${z.nombre}`} onClick={() => abrirEdicion(z)} />
                  <CircleButton
                    icon={<IconEliminar className="h-[19px] w-[19px]" />}
                    label={`Eliminar ${z.nombre}`}
                    variant="delete"
                    onClick={() => setZonaAEliminar(z)}
                  />
                </>
              }
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-[19px] leading-tight text-tinta">{z.nombre}</span>
                <StatusPill tone="neutral">{z.municipio?.nombre}</StatusPill>
              </div>
              <p className="font-data text-xs text-teal">{z.descripcion ?? 'Sin descripción'}</p>
              <div className="flex items-center justify-between">
                <Switch checked={z.activo} onChange={() => alternarActivo(z)} disabled={cambiandoEstadoDe === z.id}>
                  {cambiandoEstadoDe === z.id ? '…' : z.activo ? 'Activa' : 'Inactiva'}
                </Switch>
              </div>
            </Card>
          ))}
        </div>
      )}

      {formAbierto && municipios.data && (
        <ZonaFormModal zona={zonaEditando} municipios={municipios.data} onCerrar={cerrarForm} onGuardado={trasGuardar} />
      )}

      {zonaAEliminar && (
        <ConfirmarEliminarZonaModal
          zona={zonaAEliminar}
          onCerrar={() => setZonaAEliminar(null)}
          onEliminado={(mensaje) => {
            setZonaAEliminar(null);
            setErrorAccion(null);
            setAviso(mensaje);
            estado.refetch();
          }}
        />
      )}
    </div>
  );
}
