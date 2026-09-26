import { useState } from 'react';
import { AppShell } from '../components/ui/AppShell';
import { RailModule } from '../components/ui/Rail';
import { useFetch, UseFetchState } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { getTiendas, getProductos } from '../api/catalogo';
import { getSegmentos } from '../api/segmentos';
import { MODULOS_POR_ROL } from '../routes/modulosPorRol';
import { Card } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { IconAccesibilidad, IconSegmentos } from '../components/ui/icons';
import { IncomeSegment, Producto, Tienda } from '../types';
import { SegmentosPanel } from './analista/SegmentosPanel';
import { TransaccionesPanel } from './analista/TransaccionesPanel';
import { IndicadoresPanel } from './analista/IndicadoresPanel';
import { ReglasAsociacionPanel } from './analista/ReglasAsociacionPanel';

type Tab =
  | 'transacciones'
  | 'segmentos'
  | 'canastas'
  | 'indicadores'
  | 'reglas-asociacion'
  | 'accesibilidad'
  | 'productos'
  | 'tiendas';

/** El flujo de negocio completo (CLAUDE.md): navega entre pestañas reales, no es un wizard de un solo paso. */
const PASOS: { label: string; tab: Tab }[] = [
  { label: 'Importar', tab: 'transacciones' },
  { label: 'Validar', tab: 'transacciones' },
  { label: 'Canastas', tab: 'canastas' },
  { label: 'Zona y segmento', tab: 'segmentos' },
  { label: 'Indicadores', tab: 'indicadores' },
  { label: 'Asociaciones', tab: 'reglas-asociacion' },
  { label: 'Accesibilidad', tab: 'accesibilidad' },
];

function inicialesDeTexto(texto: string): string {
  const palabras = texto.split(' ').filter(Boolean);
  if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase();
  return texto.slice(0, 2).toUpperCase();
}

function PipelineStepper({ tabActual, onIr }: { tabActual: Tab; onIr: (t: Tab) => void }) {
  return (
    <div className="flex items-center rounded-panel bg-arena px-6 py-5">
      {PASOS.map((paso, i) => {
        const activo = paso.tab === tabActual;
        return (
          <div key={paso.label} className="flex flex-1 items-center">
            {i > 0 && <span className="mb-6 h-1.5 flex-1 rounded-full bg-salvia/30" />}
            <button type="button" onClick={() => onIr(paso.tab)} className="flex w-24 flex-col items-center gap-2 text-center">
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-full border-2 font-display text-lg transition hover:-translate-y-1 ${
                  activo ? 'border-vino bg-vino text-arena shadow-lift' : 'border-salvia/50 bg-arena text-teal'
                }`}
              >
                {i + 1}
              </span>
              <span className="text-xs font-semibold text-teal">{paso.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** "Segmentos" — resumen compacto del catálogo real de M05, sin inventar una distribución poblacional que no existe. */
function SegmentosResumen({ segmentos }: { segmentos: UseFetchState<IncomeSegment[]> }) {
  const lista = segmentos.data ?? [];
  return (
    <section className="flex flex-col gap-3.5 rounded-panel bg-arena p-6">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-slab text-[26px] text-vino">Segmentos</h2>
        <StatusPill tone="neutral" icon={<IconSegmentos className="h-3.5 w-3.5" />}>
          por zona
        </StatusPill>
      </div>
      {lista.length === 0 && <p className="px-1 text-sm text-teal/70">Sin segmentos configurados todavía.</p>}
      {lista.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-3 rounded-full bg-marfil px-4 py-2.5">
          <span className="truncate text-sm font-bold text-tinta">{s.name}</span>
          <span className="font-data flex-shrink-0 text-xs text-teal">{s.code}</span>
        </div>
      ))}
    </section>
  );
}

/** M12 no existe como módulo todavía: placeholder honesto, sin inventar índices por zona. */
function AccesibilidadResumen() {
  return (
    <section className="flex flex-col gap-3 rounded-panel bg-teal p-6 text-arena">
      <h2 className="font-slab text-[26px]">Accesibilidad</h2>
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-arena/10">
          <IconAccesibilidad className="h-5 w-5" />
        </span>
        <p className="text-sm opacity-85">Aún no hay indicadores de accesibilidad calculados.</p>
      </div>
    </section>
  );
}

export function AnalistaPortal() {
  const { usuario, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('transacciones');
  const [busqueda, setBusqueda] = useState('');

  const tiendas = useFetch(getTiendas, []);
  const productos = useFetch(getProductos, []);
  const segmentos = useFetch(getSegmentos, []);

  const modulos: RailModule[] = MODULOS_POR_ROL['Analista comercial'].map((m) => ({
    key: m.key,
    label: m.label,
    icon: m.icon,
    permiso: m.permiso,
    active: tab === m.key,
    onClick: () => setTab(m.key as Tab),
  }));

  const iniciales = usuario?.nombre ? inicialesDeTexto(usuario.nombre) : '?';
  const primerNombre = usuario?.nombre?.split(' ')[0] ?? '';
  const mostrandoTransacciones = tab === 'transacciones';

  return (
    <AppShell
      rolLabel="Analista comercial"
      nombre={primerNombre}
      modulos={modulos}
      iniciales={iniciales}
      onLogout={logout}
      buscador={
        mostrandoTransacciones
          ? { placeholder: 'Buscar folio, tienda o producto', value: busqueda, onChange: setBusqueda }
          : undefined
      }
      aside={
        mostrandoTransacciones ? (
          <>
            <SegmentosResumen segmentos={segmentos} />
            <AccesibilidadResumen />
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6">
        <PipelineStepper tabActual={tab} onIr={setTab} />

        {tab === 'transacciones' && <TransaccionesPanel busqueda={busqueda} />}
        {tab === 'segmentos' && <SegmentosPanel />}
        {tab === 'indicadores' && <IndicadoresPanel />}
        {tab === 'reglas-asociacion' && <ReglasAsociacionPanel />}

        {tab === 'canastas' && (
          <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
            <p className="font-display text-2xl text-teal">Aún no se ha generado ninguna canasta</p>
            <p className="max-w-sm text-sm text-teal/70">Las canastas se construyen a partir de las transacciones registradas.</p>
          </div>
        )}

        {tab === 'accesibilidad' && (
          <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
            <p className="font-display text-2xl text-teal">Aún no hay indicadores de accesibilidad</p>
            <p className="max-w-sm text-sm text-teal/70">
              Calcula el índice de accesibilidad económica por zona y segmento cuando el módulo esté construido.
            </p>
          </div>
        )}

        {tab === 'productos' && <ProductosLectura estado={productos} />}
        {tab === 'tiendas' && <TiendasLectura estado={tiendas} />}
      </div>
    </AppShell>
  );
}

function ProductosLectura({ estado }: { estado: UseFetchState<Producto[]> }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-4xl text-vino">Productos</h1>
        <StatusPill tone="neutral">Lectura</StatusPill>
      </div>
      {estado.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {estado.data && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {estado.data.map((p) => (
            <Card key={p.id}>
              <span className="font-display text-lg text-tinta">{p.nombre}</span>
              <span className="text-xs text-teal">{p.categoria?.nombre}</span>
              <span className="font-data text-xs text-teal">{p.sku}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TiendasLectura({ estado }: { estado: UseFetchState<Tienda[]> }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-4xl text-vino">Tiendas</h1>
        <StatusPill tone="neutral">Lectura</StatusPill>
      </div>
      {estado.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {estado.data && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {estado.data.map((t) => (
            <Card key={t.id}>
              <span className="font-display text-lg text-tinta">{t.nombre}</span>
              <span className="text-xs text-teal">{t.zona?.nombre}</span>
              <span className="font-data text-xs text-teal">{t.formato}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
