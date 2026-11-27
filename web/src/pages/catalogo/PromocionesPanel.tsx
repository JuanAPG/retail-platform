import { FormEvent, useState } from 'react';
import { getZonas } from '../../api/catalogo';
import { mensajeDeError } from '../../api/errores';
import { getPromociones, proponerPromocion, Promocion, PropuestaPromocion, TipoPromocion } from '../../api/promociones';
import { listaSegura } from '../../api/seguro';
import { Cargando } from '../../components/Cargando';
import { EstadoError } from '../../components/EstadoError';
import { SectionHeader } from '../../components/SectionHeader';
import { CtaButton } from '../../components/ui/CtaButton';
import { ErrorText } from '../../components/ui/ErrorText';
import { StatusPill } from '../../components/ui/StatusPill';
import { useFetch } from '../../hooks/useFetch';
import { Producto, Tienda, Zona } from '../../types';

const TIPOS: { valor: TipoPromocion; etiqueta: string }[] = [
  { valor: 'descuento_porcentual', etiqueta: 'Descuento %' },
  { valor: 'paquete', etiqueta: 'Paquete (n por $)' },
  { valor: 'tamano_empaque', etiqueta: 'Tamaño de empaque' },
];

const input =
  'h-12 rounded-full border-2 border-transparent bg-arena px-4 text-[15px] text-tinta outline-none focus:border-vino focus:bg-marfil disabled:opacity-50';
const etiqueta = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

const hoy = () => new Date().toISOString().slice(0, 10);

function detalle(p: Promocion): string {
  if (p.type === 'descuento_porcentual') return `${p.discountPct} % de descuento`;
  if (p.type === 'paquete') return `${p.packQuantity} por $${p.packPrice}`;
  return `${p.promoContent} ${p.promoUnit} por $${p.promoPrice}`;
}

/**
 * D-39 — El Gerente de categoría propone promociones (nacen `pendiente`); las aprueba o rechaza
 * el Responsable de precios en el escritorio. La promoción no toca el histórico de precios.
 */
export function PromocionesPanel({ productos, tiendas }: { productos: Producto[]; tiendas: Tienda[] }) {
  const lista = useFetch(() => getPromociones(), []);
  const zonas = useFetch(getZonas, []);

  const [tipo, setTipo] = useState<TipoPromocion>('descuento_porcentual');
  const [nombre, setNombre] = useState('');
  const [productoId, setProductoId] = useState('');
  const [presentacionId, setPresentacionId] = useState('');
  const [ambito, setAmbito] = useState<'zona' | 'tienda'>('zona');
  const [lugarId, setLugarId] = useState('');
  const [descuento, setDescuento] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [precioPaquete, setPrecioPaquete] = useState('');
  const [contenido, setContenido] = useState('');
  const [unidad, setUnidad] = useState('');
  const [precioEmpaque, setPrecioEmpaque] = useState('');
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const activos = productos.filter((p) => (p.presentaciones ?? []).some((pr) => pr.activo !== false));
  const presentaciones = (activos.find((p) => p.id === productoId)?.presentaciones ?? []).filter((pr) => pr.activo !== false);
  const lugares = ambito === 'zona' ? listaSegura<Zona>(zonas.data) : tiendas;

  function armar(): PropuestaPromocion | string {
    if (nombre.trim().length < 3) return 'El nombre debe tener al menos 3 caracteres.';
    if (!productoId || !presentacionId) return 'Elige el producto y la presentación.';
    if (!lugarId) return ambito === 'zona' ? 'Elige la zona.' : 'Elige la tienda.';
    if (!desde || !hasta) return 'Indica la vigencia (desde y hasta).';
    if (hasta < desde) return 'La fecha «hasta» no puede ser anterior a «desde».';
    const base: PropuestaPromocion = {
      name: nombre.trim(),
      type: tipo,
      productId: productoId,
      presentationId: presentacionId,
      ...(ambito === 'zona' ? { zoneId: lugarId } : { storeId: lugarId }),
      validFrom: desde,
      validTo: hasta,
    };
    // Solo los campos del tipo elegido: el servicio rechaza los de otros tipos (D-39, §4).
    if (tipo === 'descuento_porcentual') return { ...base, discountPct: Number(descuento) };
    if (tipo === 'paquete') return { ...base, packQuantity: Number(cantidad), packPrice: Number(precioPaquete) };
    return { ...base, promoContent: Number(contenido), promoUnit: unidad.trim(), promoPrice: Number(precioEmpaque) };
  }

  async function proponer(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);
    const cuerpo = armar();
    if (typeof cuerpo === 'string') return setError(cuerpo);
    setEnviando(true);
    try {
      const p = await proponerPromocion(cuerpo);
      setAviso(`Promoción «${p.name}» propuesta: queda pendiente de que el Responsable de precios la apruebe.`);
      setNombre('');
      lista.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo proponer la promoción.'));
    } finally {
      setEnviando(false);
    }
  }

  const filas = listaSegura<Promocion>(lista.data?.data);
  const nombreProducto = (id: string) => productos.find((p) => p.id === id)?.nombre ?? 'Producto';

  return (
    <section className="flex flex-col gap-6" data-testid="panel-promociones">
      <SectionHeader
        title="Promociones"
        description="Propón descuentos, paquetes o tamaños de empaque. Las aprueba el Responsable de precios; no cambian el histórico de precios (D-39)."
      />

      <form noValidate onSubmit={proponer} className="flex flex-col gap-4 px-6">
        <div className="flex w-fit gap-1 rounded-full bg-marfil p-1.5">
          {TIPOS.map((t) => (
            <button
              key={t.valor}
              type="button"
              onClick={() => setTipo(t.valor)}
              className={`h-10 rounded-full px-4 text-sm font-bold ${tipo === t.valor ? 'bg-teal text-arena' : 'text-teal hover:bg-salvia/25'}`}
            >
              {t.etiqueta}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className={etiqueta}>
            Nombre
            <input className={input} value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} placeholder="Arroz 1 kg con 10 % en Zona Centro" />
          </label>
          <label className={etiqueta}>
            Producto
            <select className={input} value={productoId} onChange={(e) => { setProductoId(e.target.value); setPresentacionId(''); }}>
              <option value="">Elige…</option>
              {activos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </label>
          <label className={etiqueta}>
            Presentación
            <select className={input} value={presentacionId} onChange={(e) => setPresentacionId(e.target.value)} disabled={!productoId}>
              <option value="">Elige…</option>
              {presentaciones.map((pr) => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
            </select>
          </label>
          <label className={etiqueta}>
            Aplica en
            <select className={input} value={ambito} onChange={(e) => { setAmbito(e.target.value as 'zona' | 'tienda'); setLugarId(''); }}>
              <option value="zona">Una zona (sus tiendas activas)</option>
              <option value="tienda">Una tienda</option>
            </select>
          </label>
          <label className={etiqueta}>
            {ambito === 'zona' ? 'Zona' : 'Tienda'}
            <select className={input} value={lugarId} onChange={(e) => setLugarId(e.target.value)}>
              <option value="">Elige…</option>
              {lugares.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </label>
          {tipo === 'descuento_porcentual' && (
            <label className={etiqueta}>
              Descuento (%)
              <input className={input} type="number" min="0.01" max="99.99" step="0.01" value={descuento} onChange={(e) => setDescuento(e.target.value)} />
            </label>
          )}
          {tipo === 'paquete' && (
            <>
              <label className={etiqueta}>
                Piezas del paquete (2 a 99)
                <input className={input} type="number" min="2" max="99" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
              </label>
              <label className={etiqueta}>
                Precio del paquete (MXN)
                <input className={input} type="number" min="0.01" step="0.01" value={precioPaquete} onChange={(e) => setPrecioPaquete(e.target.value)} />
              </label>
            </>
          )}
          {tipo === 'tamano_empaque' && (
            <>
              <label className={etiqueta}>
                Contenido del empaque
                <input className={input} type="number" min="0.01" step="0.01" value={contenido} onChange={(e) => setContenido(e.target.value)} />
              </label>
              <label className={etiqueta}>
                Unidad (misma familia: masa con masa, volumen con volumen)
                <input className={input} value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="kg, g, l, ml, pza" />
              </label>
              <label className={etiqueta}>
                Precio del empaque (MXN)
                <input className={input} type="number" min="0.01" step="0.01" value={precioEmpaque} onChange={(e) => setPrecioEmpaque(e.target.value)} />
              </label>
            </>
          )}
          <label className={etiqueta}>
            Vigente desde
            <input className={input} type="date" min={hoy()} value={desde} onChange={(e) => setDesde(e.target.value)} />
          </label>
          <label className={etiqueta}>
            Vigente hasta
            <input className={input} type="date" min={desde || hoy()} value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </label>
        </div>
        {error && <ErrorText>{error}</ErrorText>}
        {aviso && <p role="status" className="rounded-full bg-salvia/20 px-4 py-2 text-sm text-tinta">{aviso}</p>}
        <div>
          <CtaButton type="submit" disabled={enviando}>{enviando ? 'Enviando…' : 'Proponer promoción'}</CtaButton>
        </div>
      </form>

      <div className="flex flex-col gap-3 px-6">
        <h2 className="font-display text-2xl text-vino">Promociones propuestas</h2>
        {lista.loading && !lista.data && <Cargando etiqueta="Cargando promociones…" />}
        {lista.error && <EstadoError mensaje={lista.error} onReintentar={lista.reintentable ? lista.refetch : undefined} />}
        {lista.data && filas.length === 0 && <p className="text-sm text-teal/70">Todavía no hay promociones.</p>}
        {filas.map((p) => (
          <div key={p.id} className="flex flex-col gap-1 rounded-[22px] bg-arena p-4" data-promocion={p.id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-tinta">{p.name}</span>
              <StatusPill tone={p.status === 'aprobada' ? 'ok' : p.status === 'rechazada' ? 'warn' : 'neutral'}>
                {p.status === 'aprobada' ? 'Aprobada' : p.status === 'rechazada' ? 'Rechazada' : 'Pendiente'}
              </StatusPill>
            </div>
            <span className="text-xs text-teal/80">
              {nombreProducto(p.productId)} · {detalle(p)} · {p.validFrom} a {p.validTo} · {p.validity}
            </span>
            {p.rejectionReason && <span className="text-xs text-vino">Motivo del rechazo: {p.rejectionReason}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
