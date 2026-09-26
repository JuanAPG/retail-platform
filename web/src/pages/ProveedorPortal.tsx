import { FormEvent, useState } from 'react';
import { AppShell } from '../components/ui/AppShell';
import { useFetch } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { getProductos, getCategorias, getUnidadesMedida, proponerProducto } from '../api/catalogo';
import { mensajeDeError } from '../api/errores';
import { EstatusProducto, UnidadMedida } from '../types';
import { MODULOS_POR_ROL } from '../routes/modulosPorRol';
import { RailModule } from '../components/ui/Rail';
import { Hero } from '../components/ui/Hero';
import { Chip } from '../components/ui/Chip';
import { Card } from '../components/ui/Card';
import { StatusPill } from '../components/ui/StatusPill';
import { IconCanastas, IconCheck, IconMas, IconPrecios, IconProductos } from '../components/ui/icons';

type Tab = 'mis-productos' | 'proponer-alta' | 'mis-solicitudes' | 'cambio-precio' | 'mi-perfil';

const ESTATUS_TONE: Record<EstatusProducto, 'ok' | 'warn' | 'neutral'> = {
  activo: 'ok',
  pendiente_aprobacion: 'warn',
  rechazado: 'warn',
  inactivo: 'neutral',
};
const ESTATUS_LABEL: Record<EstatusProducto, string> = {
  activo: 'Aprobada',
  pendiente_aprobacion: 'En revisión',
  rechazado: 'Rechazada',
  inactivo: 'Inactiva',
};

function inicialesDeTexto(texto: string): string {
  const palabras = texto.split(' ').filter(Boolean);
  if (palabras.length >= 2) return (palabras[0][0] + palabras[1][0]).toUpperCase();
  return texto.slice(0, 2).toUpperCase();
}

/** Círculos del tracker: 3 pasos reales (Enviada → En revisión → Aprobada/Rechazada). */
function Tracker({ estatus }: { estatus: EstatusProducto }) {
  const rechazada = estatus === 'rechazado';
  const aprobada = estatus === 'activo';
  const dot = (activo: boolean, variante: 'ok' | 'warn' | 'neutral') =>
    `flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full ${
      !activo ? 'bg-salvia/30' : variante === 'ok' ? 'bg-salvia' : variante === 'warn' ? 'bg-vino' : 'bg-teal ring-2 ring-salvia'
    }`;
  const line = (activo: boolean) => `h-1.5 flex-1 rounded-full ${activo ? 'bg-salvia' : 'bg-salvia/30'}`;

  return (
    <div className="flex items-center gap-0">
      <span className={dot(true, 'neutral')} />
      <span className={line(true)} />
      <span className={dot(true, rechazada ? 'warn' : aprobada ? 'ok' : 'neutral')} />
      <span className={line(aprobada || rechazada)} />
      <span className={dot(aprobada || rechazada, rechazada ? 'warn' : 'ok')} />
    </div>
  );
}

export function ProveedorPortal() {
  const { usuario, logout } = useAuth();

  // El Administrador puede entrar aquí para revisar el portal, pero su
  // cuenta no está ligada a ninguna empresa proveedora: el backend no
  // le recorta el catálogo (el recorte solo aplica al rol Proveedor) y
  // no puede proponer altas.
  const esProveedor = usuario?.rol === 'Proveedor';
  const [tab, setTab] = useState<Tab>('mis-productos');

  const productos = useFetch(getProductos, []);
  const categorias = useFetch(getCategorias, []);
  const unidades = useFetch(getUnidadesMedida, []);

  const misProductos = productos.data ?? [];
  const enCatalogo = misProductos.filter((p) => p.estatus === 'activo');
  const enRevision = misProductos.filter((p) => p.estatus === 'pendiente_aprobacion');
  const solicitudes = misProductos.filter((p) => p.estatus !== 'activo');
  const empresa = misProductos.find((p) => p.proveedor)?.proveedor?.razonSocial ?? 'Proveedor Externo';

  const modulos: RailModule[] = MODULOS_POR_ROL.Proveedor.map((m) => ({
    key: m.key,
    label: m.label,
    icon: m.icon,
    permiso: m.permiso,
    active: tab === m.key,
    badge: m.key === 'mis-solicitudes' ? solicitudes.length : undefined,
    onClick: () => setTab(m.key as Tab),
  }));

  const iniciales = usuario?.nombre ? inicialesDeTexto(usuario.nombre) : '?';
  const primerNombre = usuario?.nombre?.split(' ')[0] ?? '';

  return (
    <AppShell
      rolLabel={esProveedor ? empresa : `Portal del Proveedor — vista de ${usuario?.rol}`}
      nombre={primerNombre}
      modulos={modulos}
      iniciales={iniciales}
      onLogout={logout}
    >
      {!esProveedor && (
        <div className="mb-2 rounded-full bg-vino/10 px-5 py-3">
          <p className="text-sm font-semibold text-vino">
            Estás viendo el portal del Proveedor con una cuenta de {usuario?.rol}. El catálogo se muestra completo (no
            acotado a una empresa) y no puedes enviar propuestas.
          </p>
        </div>
      )}

      {tab === 'mis-productos' && (
        <div className="flex flex-col gap-6">
          <Hero
            title="Tu vitrina"
            className="!bg-salvia !text-tinta"
            action={
              <div className="flex gap-2">
                <StatusPill tone="ok" icon={<IconCheck className="h-3.5 w-3.5" />}>
                  Verificada
                </StatusPill>
              </div>
            }
            decorations={
              <>
                <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-tinta text-arena">
                  <IconProductos className="mt-8 h-[74px] w-[74px]" />
                </div>
                <div className="absolute right-[22px] top-[18px] flex h-[108px] w-[108px] flex-col items-center justify-center gap-0.5 rounded-full bg-arena text-teal">
                  <span className="font-display text-[30px] leading-none">{enCatalogo.length}</span>
                  <span className="text-[10px] font-semibold">activos</span>
                </div>
                <div className="absolute right-[190px] top-[130px] flex h-[92px] w-[92px] flex-col items-center justify-center gap-0.5 rounded-full bg-vino text-arena">
                  <span className="font-display text-2xl leading-none">{enRevision.length}</span>
                  <span className="text-[10px] font-semibold">en revisión</span>
                </div>
              </>
            }
          />

          {productos.error && <p className="text-sm font-semibold text-vino">{productos.error}</p>}

          {productos.data && enCatalogo.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
                <IconProductos className="h-6 w-6" />
              </span>
              <p className="font-display text-2xl text-teal">Aún no tienes productos en el catálogo</p>
              <p className="max-w-sm text-sm text-teal/70">
                Cuando propongas un producto y el Gerente de categoría lo apruebe, aparecerá aquí.
              </p>
            </div>
          )}

          {enCatalogo.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {enCatalogo.map((p) => (
                <Card key={p.id}>
                  <div className="relative flex h-[100px] items-center justify-center rounded-[24px] bg-marfil text-teal transition group-hover:bg-teal group-hover:text-arena">
                    <IconProductos className="h-[46px] w-[46px]" />
                    {p.esCanastaBasica && (
                      <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-vino text-arena">
                        <IconCanastas className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 px-1">
                    <span className="font-display text-lg leading-tight text-tinta">{p.nombre}</span>
                    <span className="text-xs text-teal">{p.categoria?.nombre}</span>
                  </div>
                  <span className="font-data px-1 text-xs text-teal">{p.sku}</span>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'proponer-alta' && esProveedor && (
        <FormularioPropuesta
          categorias={categorias.data ?? []}
          unidades={unidades.data ?? []}
          cargandoCategorias={categorias.loading}
          alGuardar={() => {
            productos.refetch();
            setTab('mis-solicitudes');
          }}
        />
      )}

      {tab === 'proponer-alta' && !esProveedor && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-2xl text-teal">Solo un Proveedor puede enviar propuestas</p>
          <p className="max-w-sm text-sm text-teal/70">
            El alta queda ligada a la empresa proveedora del usuario que la envía.
          </p>
        </div>
      )}

      {tab === 'mis-solicitudes' && (
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-4xl text-vino">Mis solicitudes</h1>
          {productos.loading && <p className="text-sm text-teal/70">Cargando…</p>}
          {productos.data && solicitudes.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
              <p className="font-display text-2xl text-teal">No tienes solicitudes registradas</p>
              <p className="text-sm text-teal/70">Usa «Proponer alta de producto» para enviar una propuesta.</p>
            </div>
          )}
          {solicitudes.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {solicitudes.map((p) => (
                <Card key={p.id}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-[19px] leading-tight text-tinta">{p.nombre}</span>
                    <StatusPill tone={ESTATUS_TONE[p.estatus]}>{ESTATUS_LABEL[p.estatus]}</StatusPill>
                  </div>
                  <Tracker estatus={p.estatus} />
                  <div className="flex items-center justify-between font-data text-xs text-teal">
                    <span>{p.sku}</span>
                    {p.estatus === 'rechazado' && p.motivoRechazo && (
                      <span className="text-vino">{p.motivoRechazo}</span>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'cambio-precio' && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-salvia text-tinta">
            <IconPrecios className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">Aún no disponible</p>
          <p className="max-w-sm text-sm text-teal/70">
            Proponer un cambio de precio directamente todavía no está construido. Mientras tanto, contacta a
            Responsable de Precios.
          </p>
        </div>
      )}

      {tab === 'mi-perfil' && (
        <div className="flex flex-col gap-6">
          <h1 className="font-display text-4xl text-vino">Mi perfil</h1>
          <Card className="max-w-md">
            <div className="flex flex-col gap-3">
              <div className="flex justify-between border-b border-salvia/25 pb-2.5 text-sm">
                <span className="text-teal">Nombre de contacto</span>
                <span className="font-semibold text-tinta">{usuario?.nombre}</span>
              </div>
              <div className="flex justify-between border-b border-salvia/25 pb-2.5 text-sm">
                <span className="text-teal">Correo</span>
                <span className="font-semibold text-tinta">{usuario?.email}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-teal">Rol</span>
                <span className="font-semibold text-tinta">{usuario?.rol}</span>
              </div>
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}

interface FormularioPropuestaProps {
  categorias: { id: number; nombre: string }[];
  unidades: UnidadMedida[];
  cargandoCategorias: boolean;
  alGuardar: () => void;
}

function FormularioPropuesta({ categorias, unidades, cargandoCategorias, alGuardar }: FormularioPropuestaProps) {
  const [sku, setSku] = useState('');
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoriaId, setCategoriaId] = useState<number | null>(null);
  const [presentacion, setPresentacion] = useState('');
  const [contenido, setContenido] = useState('');
  const [unidadMedida, setUnidadMedida] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!categoriaId) {
      setError('Selecciona una categoría.');
      return;
    }
    if (!unidadMedida) {
      setError('Selecciona una unidad de medida.');
      return;
    }
    if (!(Number(contenido) > 0)) {
      setError('El contenido de la presentación debe ser mayor que cero.');
      return;
    }

    setEnviando(true);
    try {
      // Nótese que NO se manda proveedorId ni estatus: los pone el
      // backend a partir del token. Mandarlos sería rechazado por el
      // ValidationPipe (forbidNonWhitelisted).
      await proponerProducto({
        sku: sku.trim(),
        nombre: nombre.trim(),
        descripcion: descripcion.trim() || undefined,
        categoriaId,
        presentacion: presentacion.trim(),
        contenido: Number(contenido),
        unidadMedida,
      });
      alGuardar();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo enviar la propuesta.'));
    } finally {
      setEnviando(false);
    }
  }

  const fieldClass =
    'h-14 rounded-full border-2 border-transparent bg-arena px-5 text-[15px] text-tinta outline-none transition focus:border-vino focus:bg-marfil hover:border-salvia/60';
  const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl text-vino">Proponer alta de producto</h1>
      <p className="max-w-2xl text-sm text-teal/80">
        La propuesta queda en revisión del Gerente de categoría. No aparece en el catálogo hasta que la apruebe.
      </p>

      <form onSubmit={enviar} className="flex max-w-2xl flex-col gap-4 rounded-panel bg-arena p-6">
        {error && <p className="rounded-full bg-vino/10 px-5 py-3 text-sm font-semibold text-vino">{error}</p>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={labelClass} htmlFor="sku">
            SKU
            <input
              id="sku"
              className={fieldClass}
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="BIO-QUI-500"
              maxLength={40}
              required
            />
          </label>
          <label className={labelClass} htmlFor="nombre">
            Nombre del producto
            <input
              id="nombre"
              className={fieldClass}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={150}
              required
            />
          </label>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-[13px] font-semibold text-teal">Categoría</span>
          <div className="flex flex-wrap gap-2">
            {cargandoCategorias && <span className="text-sm text-teal/60">Cargando…</span>}
            {categorias.map((c) => (
              <Chip key={c.id} active={categoriaId === c.id} onClick={() => setCategoriaId(c.id)}>
                {c.nombre}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 rounded-[28px] bg-marfil p-4">
          <span className="text-[13px] font-semibold text-teal">
            Primera presentación — un producto se vende por presentación (500 g, 1 L…); después podrás agregar más
          </span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className={`${labelClass} sm:col-span-3`} htmlFor="presentacion">
              Nombre
              <input
                id="presentacion"
                className={fieldClass}
                value={presentacion}
                onChange={(e) => setPresentacion(e.target.value)}
                placeholder="500 g"
                maxLength={60}
                required
              />
            </label>
            <label className={`${labelClass} sm:col-span-2`} htmlFor="contenido">
              Contenido
              <input
                id="contenido"
                type="number"
                step="0.001"
                min="0"
                className={fieldClass}
                value={contenido}
                onChange={(e) => setContenido(e.target.value)}
                placeholder="500"
                required
              />
            </label>
            <label className={labelClass} htmlFor="unidad">
              Unidad
              <select
                id="unidad"
                className={fieldClass}
                value={unidadMedida}
                onChange={(e) => setUnidadMedida(e.target.value)}
                required
              >
                <option value="">—</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.clave}>
                    {u.clave}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <label className={labelClass} htmlFor="descripcion">
          Descripción (opcional)
          <textarea
            id="descripcion"
            rows={3}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            className="rounded-[28px] border-2 border-transparent bg-arena px-5 py-4 text-[15px] text-tinta outline-none transition focus:border-vino focus:bg-marfil hover:border-salvia/60"
          />
        </label>

        <button
          type="submit"
          disabled={enviando}
          className="group flex h-[56px] w-fit items-center gap-2.5 rounded-full bg-teal py-0 pl-6 pr-3 text-[15px] font-bold text-arena transition hover:bg-vino disabled:opacity-50"
        >
          {enviando ? 'Enviando…' : 'Enviar propuesta'}
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-arena text-teal transition group-hover:translate-x-0.5">
            <IconMas className="h-4 w-4 rotate-45" />
          </span>
        </button>
      </form>
    </div>
  );
}
