import { useState } from 'react';
import { AppShell } from '../components/ui/AppShell';
import { RailModule } from '../components/ui/Rail';
import { SectionHeader } from '../components/SectionHeader';
import { EmptyState } from '../components/EmptyState';
import { useFetch } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { AprobacionesPanel } from './catalogo/AprobacionesPanel';
import { ProductosPanel } from './catalogo/ProductosPanel';
import { PreciosPanel } from './catalogo/PreciosPanel';
import { ComparacionPreciosPanel } from './catalogo/ComparacionPreciosPanel';
import { getProductos, getCategorias, getTiendas, getProveedores } from '../api/catalogo';
import { MODULOS_POR_ROL, ModuloDefinicion } from '../routes/modulosPorRol';
import { Card } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { ApprovalQueue } from '../components/ui/ApprovalQueue';
import { Producto } from '../types';

type Tab =
  | 'catalogo-productos'
  | 'categorias'
  | 'aprobaciones'
  | 'aprobaciones-precio'
  | 'gestion-precios'
  | 'elasticidad'
  | 'reportes'
  | 'reportes-precios'
  | 'tiendas'
  | 'proveedores';

function inicialesDeTexto(texto: string): string {
  const palabras = texto.split(' ').filter(Boolean);
  if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase();
  return texto.slice(0, 2).toUpperCase();
}

/** Los módulos de "Comparar precios" y "Productos" (lectura) llevan al mismo lugar: el catálogo. */
function tabDeModulo(key: string): Tab {
  if (key === 'comparar-precios' || key === 'productos') return 'catalogo-productos';
  return key as Tab;
}

export function CatalogoPortal() {
  const { usuario, logout } = useAuth();

  // Este portal lo comparten dos roles con secciones distintas (dos
  // pantallas separadas en DESIGN.md — Categoria.dc.html y
  // Precios.dc.html — pero una sola ruta en el código, decisión ya
  // tomada). El Administrador entra a las dos, sin recortes.
  const esAdmin = usuario?.rol === 'Administrador';
  const seccionesCatalogo = esAdmin || usuario?.rol === 'Gerente de categoría';
  const seccionesPrecios = esAdmin || usuario?.rol === 'Responsable de precios';

  const [tab, setTab] = useState<Tab>(seccionesCatalogo ? 'catalogo-productos' : 'gestion-precios');
  const [busquedaProductos, setBusquedaProductos] = useState('');
  const [productoComparando, setProductoComparando] = useState<Producto | null>(null);

  const productos = useFetch(getProductos, []);
  const categorias = useFetch(getCategorias, []);
  const tiendas = useFetch(getTiendas, []);
  // GET /providers responde 403 a Responsable de Precios (RBAC del
  // backend, ese rol no tiene este módulo en su Rail): solo se pide
  // cuando el rol que sí lo tiene está mirando.
  const proveedores = useFetch(() => (seccionesCatalogo ? getProveedores() : Promise.resolve([])), [seccionesCatalogo]);

  const modulosFuente: ModuloDefinicion[] = [
    ...(seccionesCatalogo ? MODULOS_POR_ROL['Gerente de categoría'] : []),
    ...(seccionesPrecios ? MODULOS_POR_ROL['Responsable de precios'] : []),
  ];
  // Ambos roles comparten el módulo "Tiendas": no se duplica el ícono en el Rail.
  const modulosVistos = new Set<string>();
  const modulos: RailModule[] = modulosFuente
    .filter((m) => {
      if (modulosVistos.has(m.key)) return false;
      modulosVistos.add(m.key);
      return true;
    })
    .map((m) => {
      const tabDestino = tabDeModulo(m.key);
      return {
        key: m.key,
        label: m.label,
        icon: m.icon,
        permiso: m.permiso,
        active: tab === tabDestino,
        onClick: () => setTab(tabDestino),
      };
    });

  const iniciales = usuario?.nombre ? inicialesDeTexto(usuario.nombre) : '?';
  const primerNombre = usuario?.nombre?.split(' ')[0] ?? '';
  const rolLabel = esAdmin ? 'Administrador' : (usuario?.rol ?? '');

  const mostrandoCatalogo = tab === 'catalogo-productos';

  return (
    <AppShell
      rolLabel={rolLabel}
      nombre={primerNombre}
      modulos={modulos}
      iniciales={iniciales}
      onLogout={logout}
      buscador={
        mostrandoCatalogo
          ? { placeholder: 'Buscar producto o SKU', value: busquedaProductos, onChange: setBusquedaProductos }
          : undefined
      }
      aside={
        mostrandoCatalogo ? (
          <>
            {seccionesCatalogo && <AprobacionesPanel />}
            {(seccionesCatalogo || seccionesPrecios) && (
              <ComparacionPreciosPanel producto={productoComparando} />
            )}
          </>
        ) : undefined
      }
    >
      {tab === 'catalogo-productos' && (
        <ProductosPanel
          estado={productos}
          puedeGestionar={seccionesCatalogo}
          busqueda={busquedaProductos}
          onComparar={setProductoComparando}
        />
      )}

      {tab === 'categorias' && (
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-4xl text-vino">Categorías</h1>
          {categorias.loading && <p className="text-sm text-teal/70">Cargando categorías…</p>}
          {categorias.error && <p className="text-sm text-vino">{categorias.error}</p>}
          {categorias.data && categorias.data.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {categorias.data.map((c) => (
                <article key={c.id} className="flex flex-col gap-1.5 rounded-card bg-arena p-4">
                  <h3 className="font-display text-lg text-tinta">{c.nombre}</h3>
                  <p className="text-sm text-teal">{c.descripcion ?? 'Sin descripción.'}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'aprobaciones' && (
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-4xl text-vino">Aprobaciones</h1>
          <AprobacionesPanel />
        </div>
      )}

      {tab === 'aprobaciones-precio' && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl text-vino">Aprobaciones de precio</h1>
            <StatusPill tone="neutral">Aprueba</StatusPill>
          </div>
          {/* No existe todavía un flujo de propuesta de precio por proveedor en el backend. */}
          <ApprovalQueue items={[]} emptyLabel="Todo al día" />
        </div>
      )}

      {tab === 'gestion-precios' && <PreciosPanel />}

      {tab === 'elasticidad' && (
        <section>
          <SectionHeader title="Elasticidad precio-demanda" />
          <EmptyState
            title="Aún no hay cálculos de elasticidad"
            description="Ejecuta un cálculo por producto y zona para ver los resultados aquí."
          />
        </section>
      )}

      {(tab === 'reportes' || tab === 'reportes-precios') && (
        <section>
          <SectionHeader title="Reportes ejecutivos" />
          <EmptyState
            title="Aún no se ha generado ningún reporte"
            description="Genera un reporte ejecutivo con los hallazgos del análisis comercial."
          />
        </section>
      )}

      {tab === 'tiendas' && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl text-vino">Tiendas</h1>
            <StatusPill tone="neutral">Lectura</StatusPill>
          </div>
          {tiendas.loading && <p className="text-sm text-teal/70">Cargando tiendas…</p>}
          {tiendas.error && <p className="text-sm text-vino">{tiendas.error}</p>}
          {tiendas.data && tiendas.data.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {tiendas.data.map((t) => (
                <Card key={t.id}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-[19px] leading-tight text-tinta">{t.nombre}</span>
                    <StatusPill tone={t.activo ? 'ok' : 'neutral'}>{t.activo ? 'Activa' : 'Inactiva'}</StatusPill>
                  </div>
                  <div className="flex flex-col gap-0.5 font-data text-xs text-teal">
                    <span>
                      {[t.direccion?.calle, t.direccion?.numeroExterior, t.direccion?.colonia].filter(Boolean).join(' ') ||
                        '—'}
                    </span>
                    <span>{t.zona?.nombre ?? 'Sin zona'}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'proveedores' && (
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-4xl text-vino">Proveedores</h1>
            <StatusPill tone="neutral">Lectura</StatusPill>
          </div>
          {proveedores.loading && <p className="text-sm text-teal/70">Cargando proveedores…</p>}
          {proveedores.error && <p className="text-sm text-vino">{proveedores.error}</p>}
          {proveedores.data && proveedores.data.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {proveedores.data.map((p) => (
                <Card key={p.id}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-[19px] leading-tight text-tinta">{p.razonSocial}</span>
                    <StatusPill tone={p.activo ? 'ok' : 'warn'}>{p.activo ? 'Activo' : 'Pendiente'}</StatusPill>
                  </div>
                  <div className="flex flex-col gap-0.5 font-data text-xs text-teal">
                    <span>{p.rfc ?? 'Sin RFC'}</span>
                    <span>{p.email}</span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
