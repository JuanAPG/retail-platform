import { ReactNode, useState } from 'react';
import { AppShell } from '../components/ui/AppShell';
import { RailModule } from '../components/ui/Rail';
import { useFetch, UseFetchState } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { getProductos, getTiendas } from '../api/catalogo';
import { getTransacciones } from '../api/transacciones';
import { getHistorialPrecios } from '../api/precios';
import { MODULOS_POR_ROL } from '../routes/modulosPorRol';
import { inicialesDeTexto, perfilesParaAdmin } from '../routes/portalPorRol';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { StatusPill } from '../components/ui/StatusPill';
import { Hero } from '../components/ui/Hero';
import { ErrorText } from '../components/ui/ErrorText';
import { IconRecomendaciones, IconResultados, IconSimulacion } from '../components/ui/icons';
import { Producto, Tienda, Transaction } from '../types';

type Tab =
  | 'nueva-simulacion'
  | 'historial-simulaciones'
  | 'resultados'
  | 'recomendaciones'
  | 'productos'
  | 'tiendas'
  | 'precios'
  | 'transacciones';

function PlaceholderHonesto({ titulo, descripcion, icono }: { titulo: string; descripcion: string; icono: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">{icono}</span>
      <p className="font-display text-2xl text-teal">{titulo}</p>
      <p className="max-w-md text-sm text-teal/70">{descripcion}</p>
    </div>
  );
}

/**
 * M13 (Simulación) y M14 (Recomendaciones) todavía no existen como
 * módulo backend — son de Fernando, pendientes. Precios.dc.html/
 * Planeador.dc.html simulan un motor de elasticidad con coeficientes
 * inventados a mano; se deja como placeholder honesto en vez de fingir
 * un cálculo que no existe (misma decisión que ya tomamos para
 * Elasticidad en el portal de Precios).
 */
export function PlaneadorPortal() {
  const { usuario, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('nueva-simulacion');

  const productos = useFetch(getProductos, []);
  const tiendas = useFetch(getTiendas, []);
  const transacciones = useFetch(getTransacciones, []);

  const modulos: RailModule[] = MODULOS_POR_ROL.Planeador.map((m) => ({
    key: m.key,
    label: m.label,
    icon: m.icon,
    permiso: m.permiso,
    active: tab === m.key,
    onClick: () => setTab(m.key as Tab),
  }));

  const esAdmin = usuario?.rol === 'Administrador';
  const iniciales = usuario?.nombre ? inicialesDeTexto(usuario.nombre) : '?';
  const primerNombre = usuario?.nombre?.split(' ')[0] ?? '';
  const perfiles = esAdmin ? perfilesParaAdmin('/planeador') : undefined;

  return (
    <AppShell
      rolLabel={esAdmin ? 'Administrador' : 'Planeador'}
      nombre={primerNombre}
      modulos={modulos}
      iniciales={iniciales}
      perfiles={perfiles}
      onLogout={logout}
    >
      {tab === 'nueva-simulacion' && (
        <div className="flex flex-col gap-6">
          <Hero
            title="Simulación"
            subtitle="Escenarios hipotéticos de formato, empaque o descuento"
            decorations={
              <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
                <IconSimulacion className="mt-8 h-[74px] w-[74px]" />
              </div>
            }
          />
          <PlaceholderHonesto
            titulo="El motor de simulación aún no está construido"
            descripcion="Esta pantalla mostrará el formulario de parámetros (producto, zona, segmento, tipo de cambio) en cuanto el módulo de Simulación (M13) esté listo."
            icono={<IconSimulacion className="h-6 w-6" />}
          />
        </div>
      )}

      {tab === 'historial-simulaciones' && (
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-4xl text-vino">Historial</h1>
          <PlaceholderHonesto
            titulo="Aún no has ejecutado ninguna simulación"
            descripcion="Las simulaciones que ejecutes aparecerán aquí con su fecha y resultado."
            icono={<IconResultados className="h-6 w-6" />}
          />
        </div>
      )}

      {tab === 'resultados' && (
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-4xl text-vino">Resultados</h1>
          <PlaceholderHonesto
            titulo="Sin escenarios para comparar todavía"
            descripcion="Cuando guardes dos o más simulaciones podrás compararlas aquí lado a lado."
            icono={<IconResultados className="h-6 w-6" />}
          />
        </div>
      )}

      {tab === 'recomendaciones' && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl text-vino">Recomendaciones</h1>
            <StatusPill tone="neutral">0</StatusPill>
          </div>
          <PlaceholderHonesto
            titulo="Aún no hay recomendaciones generadas"
            descripcion="El motor de recomendaciones (M14) explicará aquí qué recomienda, por qué, con qué datos y qué impacto estima."
            icono={<IconRecomendaciones className="h-6 w-6" />}
          />
        </div>
      )}

      {tab === 'productos' && <ProductosLectura estado={productos} />}
      {tab === 'tiendas' && <TiendasLectura estado={tiendas} />}
      {tab === 'transacciones' && <TransaccionesLectura estado={transacciones} />}
      {tab === 'precios' && <PreciosLectura productos={productos} />}
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
      {estado.error && <ErrorText>{estado.error}</ErrorText>}
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

function TransaccionesLectura({ estado }: { estado: UseFetchState<Transaction[]> }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-4xl text-vino">Transacciones</h1>
        <StatusPill tone="neutral">Lectura</StatusPill>
      </div>
      {estado.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {estado.error && <ErrorText>{estado.error}</ErrorText>}
      {estado.data && estado.data.length === 0 && (
        <PlaceholderHonesto
          titulo="Aún no hay transacciones registradas"
          descripcion="Las registra el Analista comercial; aquí solo se consultan."
          icono={<IconResultados className="h-6 w-6" />}
        />
      )}
      {estado.data && estado.data.length > 0 && (
        <div className="flex flex-col gap-2">
          {estado.data.map((t) => (
            <div key={t.id} className="flex items-center gap-3.5 rounded-full bg-arena p-2 pr-4">
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-salvia text-sm font-bold text-tinta">
                {t.details?.length ?? 0}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-bold text-tinta">{t.store?.nombre ?? '—'}</span>
                <span className="font-data text-xs text-teal">
                  {t.folio} · {new Date(t.fecha).toLocaleDateString('es-MX')}
                </span>
              </div>
              <span className="font-data text-[15px] font-semibold text-tinta">${Number(t.total).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreciosLectura({ productos }: { productos: UseFetchState<Producto[]> }) {
  const [productoId, setProductoId] = useState('');
  const historial = useFetch(() => (productoId ? getHistorialPrecios(productoId) : Promise.resolve([])), [productoId]);
  const filas = historial.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="font-display text-4xl text-vino">Precios</h1>
        <StatusPill tone="neutral">Lectura</StatusPill>
      </div>

      <div className="max-w-md">
        <Select id="planeador-precios-producto" label="Producto" value={productoId} onChange={(e) => setProductoId(e.target.value)} placeholder="Selecciona…">
          {(productos.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.sku} — {p.nombre}</option>
          ))}
        </Select>
      </div>

      {!productoId && (
        <PlaceholderHonesto
          titulo="Elige un producto"
          descripcion="Verás su histórico de precios por tienda y presentación."
          icono={<IconResultados className="h-6 w-6" />}
        />
      )}

      {productoId && filas.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filas.map((f) => (
            <Card key={f.id}>
              <div className="flex items-center justify-between">
                <StatusPill tone={f.vigente ? 'ok' : 'neutral'}>{f.vigente ? 'Vigente' : 'Histórico'}</StatusPill>
                <span className="font-data text-sm font-semibold text-vino">
                  {new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(f.price))}
                </span>
              </div>
              <span className="text-sm font-bold text-tinta">{f.presentation?.nombre}</span>
              <span className="font-data text-xs text-teal">{f.store?.nombre}</span>
            </Card>
          ))}
        </div>
      )}

      {productoId && historial.data && filas.length === 0 && (
        <PlaceholderHonesto
          titulo="Este producto no tiene precios registrados"
          descripcion="Aún no hay histórico para consultar."
          icono={<IconResultados className="h-6 w-6" />}
        />
      )}
    </div>
  );
}
