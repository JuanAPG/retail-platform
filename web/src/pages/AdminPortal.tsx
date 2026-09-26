import { useState } from 'react';
import { AppShell } from '../components/ui/AppShell';
import { RailModule, RailPerfil } from '../components/ui/Rail';
import { IconCheck } from '../components/ui/icons';
import { useFetch, UseFetchState } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { getTiendas, getZonas, getProveedores } from '../api/catalogo';
import { getUsuarios } from '../api/usuarios';
import { MODULOS_POR_ROL } from '../routes/modulosPorRol';
import { PORTALES } from '../routes/portalPorRol';
import { Proveedor, Tienda, Zona } from '../types';
import { UsuariosPanel } from './admin/UsuariosPanel';
import { TiendasPanel } from './admin/TiendasPanel';
import { ZonasPanel } from './admin/ZonasPanel';
import { ComparacionZonasPanel } from './admin/ComparacionZonasPanel';
import { ProveedoresPanel } from './admin/ProveedoresPanel';
import { AuditoriaPanel } from './admin/AuditoriaPanel';

type TabAdmin = 'usuarios' | 'tiendas' | 'zonas' | 'comparar-zonas' | 'proveedores' | 'auditoria';

function inicialesDeTexto(texto: string): string {
  const palabras = texto.split(' ').filter(Boolean);
  if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase();
  return texto.slice(0, 2).toUpperCase();
}

/** "Zonas y tiendas" — resumen navegable, igual que el aside de Admin.dc.html. */
function ZonasTiendasResumen({ zonas, tiendas }: { zonas: UseFetchState<Zona[]>; tiendas: UseFetchState<Tienda[]> }) {
  const [zonaAbiertaId, setZonaAbiertaId] = useState<string | null>(null);
  const listaZonas = zonas.data ?? [];
  const listaTiendas = tiendas.data ?? [];

  return (
    <section className="flex flex-col gap-4 rounded-panel bg-arena p-6">
      <h2 className="px-1 font-slab text-[26px] text-vino">Zonas y tiendas</h2>
      <div className="flex flex-col gap-2">
        {listaZonas.length === 0 && <p className="px-1 text-sm text-teal/70">Sin zonas registradas.</p>}
        {listaZonas.map((z) => {
          const tiendasDeZona = listaTiendas.filter((t) => t.zonaId === z.id);
          const abierta = zonaAbiertaId === z.id;
          return (
            <div key={z.id} className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => setZonaAbiertaId(abierta ? null : z.id)}
                className={`flex w-full items-center gap-3.5 rounded-full p-2 pr-4 text-left transition hover:translate-x-1 ${
                  abierta ? 'bg-teal text-arena' : 'bg-marfil text-teal'
                }`}
              >
                <span
                  className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    abierta ? 'bg-vino text-arena' : 'bg-salvia text-tinta'
                  }`}
                >
                  {inicialesDeTexto(z.nombre)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{z.nombre}</span>
                <span className="font-data text-xs">{tiendasDeZona.length}</span>
              </button>
              {abierta && (
                <div className="flex flex-col gap-1.5 pl-6">
                  {tiendasDeZona.length === 0 && <p className="pl-1 text-xs text-teal/60">Sin tiendas en esta zona.</p>}
                  {tiendasDeZona.slice(0, 3).map((t) => (
                    <div key={t.id} className="flex items-center gap-3 rounded-full bg-marfil px-2 py-1.5 pr-3.5 text-teal">
                      <span className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full bg-arena text-xs font-bold">
                        {t.nombre[0]}
                      </span>
                      <span className="flex-1 truncate text-sm font-semibold">{t.nombre}</span>
                    </div>
                  ))}
                  {tiendasDeZona.length > 3 && (
                    <span className="pl-1 font-data text-xs text-teal">+ {tiendasDeZona.length - 3} tiendas</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** "Cuentas de proveedor" — solo lectura, ver nota en ProveedoresPanel.tsx sobre el endpoint faltante. */
function ProveedoresPendientesResumen({ proveedores }: { proveedores: UseFetchState<Proveedor[]> }) {
  const pendientes = (proveedores.data ?? []).filter((p) => !p.activo);

  return (
    <section className="flex flex-col gap-3.5 rounded-panel bg-teal p-6 text-arena">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-slab text-[26px]">Cuentas de proveedor</h2>
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-vino font-slab text-lg">
          {pendientes.length}
        </span>
      </div>
      {pendientes.length === 0 ? (
        <div className="flex items-center gap-3.5 p-1.5">
          <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconCheck className="h-[18px] w-[18px]" />
          </span>
          <span className="font-display text-xl">Todo al día</span>
        </div>
      ) : (
        pendientes.map((p) => (
          <div key={p.id} className="flex flex-col gap-1 rounded-[28px] bg-arena/[0.08] p-3.5">
            <span className="text-[15px] font-bold">{p.razonSocial}</span>
            <span className="font-data text-xs text-salvia">{p.rfc ?? 'Sin RFC'}</span>
          </div>
        ))
      )}
    </section>
  );
}

export function AdminPortal() {
  const { usuario, logout } = useAuth();
  const [tab, setTab] = useState<TabAdmin>('usuarios');
  const [busquedaUsuarios, setBusquedaUsuarios] = useState('');

  const usuarios = useFetch(getUsuarios, []);
  const tiendas = useFetch(getTiendas, []);
  const zonas = useFetch(getZonas, []);
  const proveedores = useFetch(getProveedores, []);

  const proveedoresPendientes = proveedores.data?.filter((p) => !p.activo).length ?? 0;

  const modulos: RailModule[] = MODULOS_POR_ROL.Administrador.map((m) => ({
    key: m.key,
    label: m.label,
    icon: m.icon,
    permiso: m.permiso,
    active: m.key === tab || (m.key === 'zonas' && tab === 'comparar-zonas'),
    badge: m.key === 'proveedores' ? proveedoresPendientes : undefined,
    onClick: () => setTab(m.key as TabAdmin),
  }));

  // Mismo atajo que antes daba `SelectorDePortal`: el Admin recorre
  // todos los portales sin cerrar sesión, ahora desde el menú del Rail.
  const perfiles: RailPerfil[] = PORTALES.map((p) => ({
    rol: p.etiqueta,
    iniciales: inicialesDeTexto(p.etiqueta),
    href: p.ruta,
    actual: p.ruta === '/admin',
  }));

  const iniciales = usuario?.nombre ? inicialesDeTexto(usuario.nombre) : '?';
  const primerNombre = usuario?.nombre?.split(' ')[0] ?? '';

  return (
    <AppShell
      rolLabel="Administrador"
      nombre={primerNombre}
      modulos={modulos}
      iniciales={iniciales}
      perfiles={perfiles}
      onLogout={logout}
      buscador={
        tab === 'usuarios'
          ? { placeholder: 'Buscar por nombre o correo', value: busquedaUsuarios, onChange: setBusquedaUsuarios }
          : undefined
      }
      aside={
        tab === 'usuarios' ? (
          <>
            <ZonasTiendasResumen zonas={zonas} tiendas={tiendas} />
            <ProveedoresPendientesResumen proveedores={proveedores} />
          </>
        ) : undefined
      }
    >
      {tab === 'usuarios' && <UsuariosPanel estado={usuarios} busqueda={busquedaUsuarios} />}
      {tab === 'tiendas' && <TiendasPanel estado={tiendas} />}
      {tab === 'zonas' && <ZonasPanel estado={zonas} onComparar={() => setTab('comparar-zonas')} />}
      {tab === 'comparar-zonas' && <ComparacionZonasPanel estado={zonas} onVolver={() => setTab('zonas')} />}
      {tab === 'proveedores' && <ProveedoresPanel estado={proveedores} />}
      {tab === 'auditoria' && <AuditoriaPanel />}
    </AppShell>
  );
}
