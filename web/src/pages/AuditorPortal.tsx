import { useState } from 'react';
import { AppShell } from '../components/ui/AppShell';
import { RailModule } from '../components/ui/Rail';
import { useFetch, UseFetchState } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { getUsuarios } from '../api/usuarios';
import { getTiendas, getZonas, getProveedores, getProductos } from '../api/catalogo';
import { getTransacciones } from '../api/transacciones';
import { getHistorialPrecios } from '../api/precios';
import { getBitacora } from '../api/auditoria';
import { MODULOS_POR_ROL } from '../routes/modulosPorRol';
import { inicialesDeTexto, perfilesParaAdmin } from '../routes/portalPorRol';
import { Hero } from '../components/ui/Hero';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { StatusPill } from '../components/ui/StatusPill';
import { ErrorText } from '../components/ui/ErrorText';
import { IconAuditoria, IconCandado, IconFlecha } from '../components/ui/icons';
import { AccionAuditoria, Producto, Proveedor, Tienda, Transaction, Usuario, Zona } from '../types';

type Tab = 'bitacora' | 'usuarios' | 'tiendas' | 'zonas' | 'proveedores' | 'productos' | 'precios' | 'transacciones';

const NOMBRE_ACCION: Record<AccionAuditoria, string> = {
  insert: 'Alta',
  update: 'Modificación',
  delete: 'Baja',
  login: 'Inicio de sesión',
  importacion: 'Importación',
};

const TONO_ACCION: Record<AccionAuditoria, 'ok' | 'warn' | 'neutral'> = {
  insert: 'ok',
  update: 'neutral',
  delete: 'warn',
  login: 'neutral',
  importacion: 'ok',
};

const NOMBRE_TABLA: Record<string, string> = {
  productos: 'Productos',
  producto_presentaciones: 'Presentaciones',
  precios: 'Precios',
  usuarios: 'Usuarios',
  transacciones: 'Transacciones',
  transaccion_detalles: 'Líneas de venta',
  proveedores: 'Proveedores',
  tiendas: 'Tiendas',
  zonas: 'Zonas',
  segmentos_ingreso: 'Segmentos de ingreso',
};

function nombreTabla(tabla: string) {
  return NOMBRE_TABLA[tabla] ?? tabla.replace(/_/g, ' ');
}

function Placeholder({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
        <IconAuditoria className="h-6 w-6" />
      </span>
      <p className="font-display text-2xl text-teal">{titulo}</p>
      <p className="max-w-md text-sm text-teal/70">{descripcion}</p>
    </div>
  );
}

function EncabezadoLectura({ titulo }: { titulo: string }) {
  return (
    <div className="flex items-center gap-3">
      <h1 className="font-display text-4xl text-vino">{titulo}</h1>
      <StatusPill tone="neutral">Lectura</StatusPill>
    </div>
  );
}

export function AuditorPortal() {
  const { usuario, logout } = useAuth();
  const [tab, setTab] = useState<Tab>('bitacora');

  const usuarios = useFetch(getUsuarios, []);
  const tiendas = useFetch(getTiendas, []);
  const zonas = useFetch(getZonas, []);
  const proveedores = useFetch(getProveedores, []);
  const productos = useFetch(getProductos, []);
  const transacciones = useFetch(getTransacciones, []);

  const modulos: RailModule[] = MODULOS_POR_ROL.Auditor.map((m) => ({
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
  const perfiles = esAdmin ? perfilesParaAdmin('/auditor') : undefined;

  return (
    <AppShell
      rolLabel={esAdmin ? 'Administrador' : 'Auditor'}
      nombre={primerNombre}
      modulos={modulos}
      iniciales={iniciales}
      perfiles={perfiles}
      onLogout={logout}
    >
      {tab === 'bitacora' && <BitacoraPanel usuarios={usuarios} />}

      {tab === 'usuarios' && <UsuariosLectura estado={usuarios} />}
      {tab === 'tiendas' && <TiendasLectura estado={tiendas} />}
      {tab === 'zonas' && <ZonasLectura estado={zonas} />}
      {tab === 'proveedores' && <ProveedoresLectura estado={proveedores} />}
      {tab === 'productos' && <ProductosLectura estado={productos} />}
      {tab === 'transacciones' && <TransaccionesLectura estado={transacciones} />}
      {tab === 'precios' && <PreciosLectura productos={productos} />}
    </AppShell>
  );
}

const LIMITE_BITACORA = 20;

function BitacoraPanel({ usuarios }: { usuarios: UseFetchState<Usuario[]> }) {
  const [accion, setAccion] = useState<AccionAuditoria | ''>('');
  const [page, setPage] = useState(1);

  const bitacora = useFetch(
    () => getBitacora({ accion: accion || undefined, page, limit: LIMITE_BITACORA }),
    [accion, page],
  );

  const eventos = bitacora.data?.data ?? [];
  const total = bitacora.data?.total ?? 0;
  const totalPaginas = Math.max(1, Math.ceil(total / LIMITE_BITACORA));

  function nombreUsuario(usuarioId: string | null) {
    if (!usuarioId) return 'Sistema';
    return usuarios.data?.find((u) => u.id === usuarioId)?.nombre ?? 'Usuario dado de baja';
  }

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Bitácora"
        subtitle="Registro de operaciones del sistema"
        decorations={
          <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
            <IconCandado className="mt-8 h-[74px] w-[74px]" />
          </div>
        }
      />

      <div className="max-w-xs">
        <Select
          id="bitacora-accion"
          label="Tipo de operación"
          value={accion}
          onChange={(e) => {
            setAccion(e.target.value as AccionAuditoria | '');
            setPage(1);
          }}
          placeholder="Todas"
        >
          {[
            <option key="" value="">Todas</option>,
            ...(Object.keys(NOMBRE_ACCION) as AccionAuditoria[]).map((a) => (
              <option key={a} value={a}>{NOMBRE_ACCION[a]}</option>
            )),
          ]}
        </Select>
      </div>

      {bitacora.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {bitacora.error && <ErrorText>{bitacora.error}</ErrorText>}

      {bitacora.data && eventos.length === 0 && (
        <Placeholder
          titulo="Aún no hay eventos registrados"
          descripcion="Aquí aparecerán las operaciones importantes del sistema (altas, cambios y bajas), con quién las hizo y cuándo."
        />
      )}

      {eventos.length > 0 && (
        <div className="flex flex-col gap-2">
          {eventos.map((ev) => (
            <Card key={ev.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <StatusPill tone={TONO_ACCION[ev.accion]}>{NOMBRE_ACCION[ev.accion]}</StatusPill>
                  <span className="text-sm font-bold text-tinta">{nombreTabla(ev.tablaAfectada)}</span>
                </div>
                <span className="font-data text-xs text-teal">
                  {new Date(ev.fecha).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
              </div>
              <span className="text-xs text-teal">{nombreUsuario(ev.usuarioId)}</span>
              {ev.descripcion && <span className="text-sm text-tinta/80">{ev.descripcion}</span>}
              {ev.cambios.length > 0 && (
                <div className="flex flex-col gap-1 rounded-card bg-arena px-3.5 py-2.5">
                  {ev.cambios.map((c) => (
                    <span key={c.campo} className="font-data text-xs text-teal">
                      <strong className="font-semibold text-tinta">{c.campo}</strong>: {c.valorPrevio ?? '—'} → {c.valorPosterior ?? '—'}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {eventos.length > 0 && totalPaginas > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            aria-label="Página anterior"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-arena text-teal transition hover:bg-teal hover:text-arena disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconFlecha className="h-4 w-4 rotate-180" />
          </button>
          <span className="font-data text-xs text-teal">Página {page} de {totalPaginas}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPaginas, p + 1))}
            disabled={page >= totalPaginas}
            aria-label="Página siguiente"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-arena text-teal transition hover:bg-teal hover:text-arena disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconFlecha className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function UsuariosLectura({ estado }: { estado: UseFetchState<Usuario[]> }) {
  return (
    <div className="flex flex-col gap-6">
      <EncabezadoLectura titulo="Usuarios" />
      {estado.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {estado.error && <ErrorText>{estado.error}</ErrorText>}
      {estado.data && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {estado.data.map((u) => (
            <Card key={u.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg text-tinta">{u.nombre}</span>
                <StatusPill tone={u.activo ? 'ok' : 'neutral'}>{u.activo ? 'Activo' : 'Inactivo'}</StatusPill>
              </div>
              <span className="text-xs text-teal">{u.rol}</span>
              <span className="font-data text-xs text-teal">{u.email}</span>
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
      <EncabezadoLectura titulo="Tiendas" />
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

function ZonasLectura({ estado }: { estado: UseFetchState<Zona[]> }) {
  return (
    <div className="flex flex-col gap-6">
      <EncabezadoLectura titulo="Zonas" />
      {estado.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {estado.data && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {estado.data.map((z) => (
            <Card key={z.id}>
              <span className="font-display text-lg text-tinta">{z.nombre}</span>
              <span className="text-xs text-teal">{z.municipio?.nombre}</span>
              <StatusPill tone={z.activo ? 'ok' : 'neutral'}>{z.activo ? 'Activa' : 'Inactiva'}</StatusPill>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ProveedoresLectura({ estado }: { estado: UseFetchState<Proveedor[]> }) {
  return (
    <div className="flex flex-col gap-6">
      <EncabezadoLectura titulo="Proveedores" />
      {estado.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {estado.data && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {estado.data.map((p) => (
            <Card key={p.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-lg text-tinta">{p.razonSocial}</span>
                <StatusPill tone={p.activo ? 'ok' : 'warn'}>{p.activo ? 'Activo' : 'Pendiente'}</StatusPill>
              </div>
              <span className="font-data text-xs text-teal">{p.rfc ?? 'Sin RFC'}</span>
              <span className="font-data text-xs text-teal">{p.email}</span>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductosLectura({ estado }: { estado: UseFetchState<Producto[]> }) {
  return (
    <div className="flex flex-col gap-6">
      <EncabezadoLectura titulo="Productos" />
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

function TransaccionesLectura({ estado }: { estado: UseFetchState<Transaction[]> }) {
  return (
    <div className="flex flex-col gap-6">
      <EncabezadoLectura titulo="Transacciones" />
      {estado.loading && <p className="text-sm text-teal/70">Cargando…</p>}
      {estado.error && <ErrorText>{estado.error}</ErrorText>}
      {estado.data && estado.data.length === 0 && (
        <Placeholder titulo="Aún no hay transacciones registradas" descripcion="Las registra el Analista comercial; aquí solo se consultan." />
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
      <EncabezadoLectura titulo="Precios" />

      <div className="max-w-md">
        <Select id="auditor-precios-producto" label="Producto" value={productoId} onChange={(e) => setProductoId(e.target.value)} placeholder="Selecciona…">
          {(productos.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.sku} — {p.nombre}</option>
          ))}
        </Select>
      </div>

      {!productoId && <Placeholder titulo="Elige un producto" descripcion="Verás su histórico de precios por tienda y presentación." />}

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
        <Placeholder titulo="Este producto no tiene precios registrados" descripcion="Aún no hay histórico para consultar." />
      )}
    </div>
  );
}
