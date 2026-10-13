import { useState } from 'react';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { actualizarZona, getMunicipios } from '../../api/catalogo';
import { Zona } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { Card } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { CircleButton } from '../../components/ui/CircleButton';
import { CtaButton } from '../../components/ui/CtaButton';
import { Switch } from '../../components/ui/Switch';
import { IconCerrar as IconEliminar, IconOjo, IconZonas } from '../../components/ui/icons';
import { ZonaFormModal } from './ZonaFormModal';
import { ConfirmarEliminarZonaModal } from './ConfirmarEliminarZonaModal';
import { ZonaDatosModal } from './ZonaDatosModal';
import { IconSegmentos } from '../../components/ui/icons';
import { EstadoError } from '../../components/EstadoError';
import { Cargando } from '../../components/Cargando';
import { useAuth } from '../../context/AuthContext';
import { puedeEscribir, quienEscribe } from '../../routes/permisosEscritura';

interface ZonasPanelProps {
  estado: UseFetchState<Zona[]>;
  onComparar: () => void;
}

/** M03 — Zonas. CRUD completo: antes era una tabla de solo lectura. */
export function ZonasPanel({ estado, onComparar }: ZonasPanelProps) {
  const { usuario } = useAuth();
  // catalog-service: solo el Analista comercial escribe zonas; al resto no se le ofrece lo que daría 403.
  const escribe = puedeEscribir('zonas', usuario?.rol);
  const municipios = useFetch(getMunicipios, []);

  const [formAbierto, setFormAbierto] = useState(false);
  const [zonaEditando, setZonaEditando] = useState<Zona | undefined>();
  const [zonaAEliminar, setZonaAEliminar] = useState<Zona | null>(null);
  const [zonaDatos, setZonaDatos] = useState<Zona | null>(null);
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
            {escribe && (
              <CtaButton
                onClick={() => {
                  setZonaEditando(undefined);
                  setFormAbierto(true);
                }}
                disabled={!municipios.data || municipios.data.length === 0}
              >
                Nueva zona
              </CtaButton>
            )}
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
      {!escribe && (
        <p className="rounded-full bg-arena px-5 py-3 text-sm text-teal">
          Vista de solo lectura: solo {quienEscribe('zonas')} administra las zonas. Aquí puedes consultarlas.
        </p>
      )}
      {estado.loading && !estado.data && <Cargando etiqueta="Cargando zonas…" />}
      {estado.error && (
        <EstadoError mensaje={`No se pudieron cargar las zonas: ${estado.error}`} onReintentar={estado.reintentable ? estado.refetch : undefined} />
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
                escribe ? (
                  <>
                    <CircleButton icon={<IconSegmentos className="h-[19px] w-[19px]" />} label={`Indicadores y segmento de ${z.nombre}`} onClick={() => setZonaDatos(z)} />
                    <CircleButton icon={<IconOjo className="h-[19px] w-[19px]" />} label={`Editar ${z.nombre}`} onClick={() => abrirEdicion(z)} />
                    <CircleButton
                      icon={<IconEliminar className="h-[19px] w-[19px]" />}
                      label={`Eliminar ${z.nombre}`}
                      variant="delete"
                      onClick={() => setZonaAEliminar(z)}
                    />
                  </>
                ) : undefined
              }
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-display text-base leading-tight text-tinta sm:text-[19px]">{z.nombre}</span>
                <StatusPill tone="neutral">{z.municipio?.nombre}</StatusPill>
              </div>
              <p className="font-data text-xs text-teal">{z.descripcion ?? 'Sin descripción'}</p>
              <div className="flex items-center justify-between">
                <Switch checked={z.activo} onChange={() => alternarActivo(z)} disabled={!escribe || cambiandoEstadoDe === z.id}>
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

      {zonaDatos && (
        <ZonaDatosModal
          zona={zonaDatos}
          onCerrar={() => setZonaDatos(null)}
          onGuardado={(mensaje) => {
            setZonaDatos(null);
            setErrorAccion(null);
            setAviso(mensaje);
            estado.refetch();
          }}
        />
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
