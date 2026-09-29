import { useState } from 'react';
import { AppShell } from '../components/ui/AppShell';
import { RailModule } from '../components/ui/Rail';
import { useFetch } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { getTiendas, getZonas, getProveedores } from '../api/catalogo';
import { getUsuarios } from '../api/usuarios';
import { MODULOS_POR_ROL } from '../routes/modulosPorRol';
import { inicialesDeTexto, perfilesParaAdmin } from '../routes/portalPorRol';
import { UsuariosPanel } from './admin/UsuariosPanel';
import { TiendasPanel } from './admin/TiendasPanel';
import { ZonasPanel } from './admin/ZonasPanel';
import { ComparacionZonasPanel } from './admin/ComparacionZonasPanel';
import { ProveedoresPanel } from './admin/ProveedoresPanel';
import { AuditoriaPanel } from './admin/AuditoriaPanel';

type TabAdmin = 'usuarios' | 'tiendas' | 'zonas' | 'comparar-zonas' | 'proveedores' | 'auditoria';

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
  const perfiles = perfilesParaAdmin('/admin');

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
