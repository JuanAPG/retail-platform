import { useMemo, useState } from 'react';
import { UseFetchState, useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { actualizarTienda, getCodigosPostales, getZonas } from '../../api/catalogo';
import { Tienda } from '../../types';
import { Hero } from '../../components/ui/Hero';
import { Chip } from '../../components/ui/Chip';
import { Card } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { CircleButton } from '../../components/ui/CircleButton';
import { Switch } from '../../components/ui/Switch';
import { IconCerrar as IconEliminar, IconMas, IconOjo, IconTiendas } from '../../components/ui/icons';
import { TiendaFormModal } from './TiendaFormModal';
import { ConfirmarEliminarTiendaModal } from './ConfirmarEliminarTiendaModal';

interface TiendasPanelProps {
  estado: UseFetchState<Tienda[]>;
}

const ETIQUETA_FORMATO: Record<string, string> = {
  supermercado: 'Supermercado',
  minimarket: 'Minimarket',
  tienda_conveniencia: 'Tienda de conveniencia',
  mayorista: 'Mayorista',
  otro: 'Otro',
};

/**
 * M02 — Tiendas. CRUD completo (RF-05, RF-06): antes solo había una
 * tabla de solo lectura, sin forma de dar de alta, editar o desactivar
 * una sucursal.
 */
export function TiendasPanel({ estado }: TiendasPanelProps) {
  const zonas = useFetch(getZonas, []);
  const codigosPostales = useFetch(getCodigosPostales, []);

  const [formato, setFormato] = useState('todos');
  const [formAbierto, setFormAbierto] = useState(false);
  const [tiendaEditando, setTiendaEditando] = useState<Tienda | undefined>();
  const [tiendaAEliminar, setTiendaAEliminar] = useState<Tienda | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [cambiandoEstadoDe, setCambiandoEstadoDe] = useState<string | null>(null);

  const tiendas = estado.data ?? [];

  const formatosEnUso = useMemo(
    () => Array.from(new Set(tiendas.map((t) => t.formato).filter(Boolean))).sort(),
    [tiendas],
  );

  const filtradas = formato === 'todos' ? tiendas : tiendas.filter((t) => t.formato === formato);

  function cerrarForm() {
    setFormAbierto(false);
    setTiendaEditando(undefined);
  }

  function trasGuardar(mensaje: string) {
    cerrarForm();
    setErrorAccion(null);
    setAviso(mensaje);
    estado.refetch();
  }

  function abrirEdicion(tienda: Tienda) {
    setTiendaEditando(tienda);
    setFormAbierto(true);
  }

  async function alternarActivo(tienda: Tienda) {
    setErrorAccion(null);
    setAviso(null);
    setCambiandoEstadoDe(tienda.id);
    try {
      await actualizarTienda(tienda.id, { activo: !tienda.activo });
      setAviso(
        tienda.activo
          ? `Se desactivó la tienda "${tienda.nombre}".`
          : `Se activó la tienda "${tienda.nombre}".`,
      );
      estado.refetch();
    } catch (err) {
      setErrorAccion(mensajeDeError(err, 'No se pudo cambiar el estado de la tienda.'));
    } finally {
      setCambiandoEstadoDe(null);
    }
  }

  const puedeAbrirForm = (zonas.data?.length ?? 0) > 0 && (codigosPostales.data?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Tiendas"
        subtitle="Sucursales físicas registradas"
        action={
          <button
            type="button"
            onClick={() => {
              setTiendaEditando(undefined);
              setFormAbierto(true);
            }}
            disabled={!puedeAbrirForm}
            title={!puedeAbrirForm ? 'Necesitas al menos una zona y un código postal' : undefined}
            className="group flex h-[52px] items-center gap-2.5 rounded-full bg-vino py-0 pl-4.5 pr-6 text-[15px] font-bold text-arena transition hover:bg-arena hover:text-vino disabled:opacity-50"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-arena text-vino transition duration-300 group-hover:rotate-90 group-hover:bg-vino group-hover:text-arena">
              <IconMas className="h-[18px] w-[18px]" />
            </span>
            Nueva tienda
          </button>
        }
        decorations={
          <>
            <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
              <IconTiendas className="mt-8 h-[74px] w-[74px]" />
            </div>
            <div className="absolute right-[26px] top-[22px] flex h-[108px] w-[108px] flex-col items-center justify-center gap-0.5 rounded-full bg-arena text-teal">
              <span className="font-display text-[34px] leading-none">{tiendas.length}</span>
              <span className="text-[11px] font-semibold">tiendas</span>
            </div>
          </>
        }
      />

      {formatosEnUso.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Chip active={formato === 'todos'} onClick={() => setFormato('todos')} count={tiendas.length}>
            Todas
          </Chip>
          {formatosEnUso.map((f) => (
            <Chip key={f} active={formato === f} onClick={() => setFormato(f)} count={tiendas.filter((t) => t.formato === f).length}>
              {ETIQUETA_FORMATO[f] ?? f}
            </Chip>
          ))}
        </div>
      )}

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
          <p className="text-sm font-semibold text-vino">No se pudieron cargar las tiendas: {estado.error}</p>
        </div>
      )}

      {estado.data && tiendas.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconTiendas className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">No hay tiendas registradas</p>
        </div>
      )}

      {filtradas.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtradas.map((t) => (
            <Card
              key={t.id}
              actions={
                <>
                  <CircleButton icon={<IconOjo className="h-[19px] w-[19px]" />} label={`Editar ${t.nombre}`} onClick={() => abrirEdicion(t)} />
                  <CircleButton
                    icon={<IconEliminar className="h-[19px] w-[19px]" />}
                    label={`Eliminar ${t.nombre}`}
                    variant="delete"
                    onClick={() => setTiendaAEliminar(t)}
                  />
                </>
              }
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-display text-[19px] leading-tight text-tinta">{t.nombre}</span>
                <StatusPill tone="neutral">{ETIQUETA_FORMATO[t.formato] ?? t.formato}</StatusPill>
              </div>
              <div className="flex flex-col gap-0.5 font-data text-xs text-teal">
                <span>
                  {[t.direccion?.calle, t.direccion?.numeroExterior, t.direccion?.colonia].filter(Boolean).join(' ') || '—'}
                </span>
                <span>{t.direccion?.codigoPostal ?? '—'} · {t.zona?.nombre ?? 'Sin zona'}</span>
              </div>
              <div className="flex items-center justify-between">
                <Switch checked={t.activo} onChange={() => alternarActivo(t)} disabled={cambiandoEstadoDe === t.id}>
                  {cambiandoEstadoDe === t.id ? '…' : t.activo ? 'Activa' : 'Inactiva'}
                </Switch>
              </div>
            </Card>
          ))}
        </div>
      )}

      {formAbierto && zonas.data && codigosPostales.data && (
        <TiendaFormModal
          tienda={tiendaEditando}
          zonas={zonas.data}
          codigosPostales={codigosPostales.data}
          onCerrar={cerrarForm}
          onGuardado={trasGuardar}
        />
      )}

      {tiendaAEliminar && (
        <ConfirmarEliminarTiendaModal
          tienda={tiendaAEliminar}
          onCerrar={() => setTiendaAEliminar(null)}
          onEliminado={(mensaje) => {
            setTiendaAEliminar(null);
            setErrorAccion(null);
            setAviso(mensaje);
            estado.refetch();
          }}
        />
      )}
    </div>
  );
}
