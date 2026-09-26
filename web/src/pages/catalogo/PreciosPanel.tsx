import { FormEvent, useMemo, useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { getProductos, getTiendas } from '../../api/catalogo';
import { getHistorialPrecios, registrarPrecio } from '../../api/precios';
import { Hero } from '../../components/ui/Hero';
import { StatusPill } from '../../components/ui/StatusPill';
import { CircleButton } from '../../components/ui/CircleButton';
import { IconMas, IconPrecios } from '../../components/ui/icons';

function formatoMoneda(valor: string | number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(valor));
}

function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const fecha = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(fecha);
}

const selectClass =
  'h-14 rounded-full border-2 border-transparent bg-arena px-5 text-[15px] text-tinta outline-none transition focus:border-vino focus:bg-marfil hover:border-salvia/60 disabled:opacity-50';
const labelClass = 'flex flex-col gap-1.5 text-[13px] font-semibold text-teal';

/**
 * M08 — Registrar un precio nuevo y ver el histórico de un producto.
 *
 * No hay "editar" ni "borrar" un precio: RN-06 lo pide versionado. Un
 * precio nuevo cierra automáticamente el vigente anterior (lo hace el
 * backend en una transacción); esta pantalla solo captura y muestra,
 * nunca reescribe una fila del histórico.
 *
 * Nota de fidelidad: Precios.dc.html muestra un grid de "etiquetas de
 * precio" con TODOS los precios vigentes del sistema y segmentos
 * Todos/Vigentes/Por vencer/Vencidos, pero el backend no tiene un
 * endpoint de listado global — solo histórico de un producto ya
 * elegido. Se mantiene la receta visual de la etiqueta (recorte
 * redondo, gira al hover) aplicada al histórico real del producto
 * seleccionado.
 */
export function PreciosPanel() {
  const productos = useFetch(getProductos, []);
  const tiendas = useFetch(getTiendas, []);

  const [productoId, setProductoId] = useState('');
  const [presentacionId, setPresentacionId] = useState('');
  const [tiendaId, setTiendaId] = useState('');
  const [precio, setPrecio] = useState('');
  const [fecha, setFecha] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const productoSeleccionado = useMemo(
    () => productos.data?.find((p) => p.id === productoId),
    [productos.data, productoId],
  );

  const historial = useFetch(
    () => (productoId ? getHistorialPrecios(productoId) : Promise.resolve([])),
    [productoId],
  );

  function elegirProducto(id: string) {
    setProductoId(id);
    setPresentacionId('');
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setAviso(null);

    if (!presentacionId || !tiendaId || !precio) {
      setError('Selecciona presentación, tienda y captura un precio.');
      return;
    }

    setGuardando(true);
    try {
      await registrarPrecio({
        presentationId: presentacionId,
        storeId: tiendaId,
        price: Number(precio),
        effectiveDate: fecha || undefined,
      });
      setAviso('Precio registrado. Si ya había uno vigente, se cerró automáticamente.');
      setPrecio('');
      setFecha('');
      historial.refetch();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo registrar el precio.'));
    } finally {
      setGuardando(false);
    }
  }

  const filas = historial.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Precios"
        subtitle="Histórico versionado por presentación y tienda"
        decorations={
          <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
            <IconPrecios className="mt-8 h-[74px] w-[74px]" />
          </div>
        }
      />

      <section className="flex flex-col gap-4 rounded-panel bg-arena p-6">
        <h2 className="font-slab text-[22px] text-vino">Registrar precio</h2>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-6">
          <label className={`${labelClass} lg:col-span-2`} htmlFor="precio-producto">
            Producto
            <select
              id="precio-producto"
              value={productoId}
              onChange={(e) => elegirProducto(e.target.value)}
              className={selectClass}
            >
              <option value="">Selecciona…</option>
              {(productos.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass} htmlFor="precio-presentacion">
            Presentación
            <select
              id="precio-presentacion"
              value={presentacionId}
              onChange={(e) => setPresentacionId(e.target.value)}
              disabled={!productoSeleccionado}
              className={selectClass}
            >
              <option value="">Selecciona…</option>
              {(productoSeleccionado?.presentaciones ?? []).map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.nombre} ({pr.contenido} {pr.unidadMedida?.clave})
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass} htmlFor="precio-tienda">
            Tienda
            <select
              id="precio-tienda"
              value={tiendaId}
              onChange={(e) => setTiendaId(e.target.value)}
              className={selectClass}
            >
              <option value="">Selecciona…</option>
              {(tiendas.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre} — {t.zona?.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className={labelClass} htmlFor="precio-monto">
            Precio (MXN)
            <input
              id="precio-monto"
              type="number"
              min={0}
              step="0.01"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              className={selectClass}
            />
          </label>

          <label className={labelClass} htmlFor="precio-fecha">
            Vigente desde
            <input
              id="precio-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className={selectClass}
            />
          </label>

          <div className="flex items-end sm:col-span-2 lg:col-span-6">
            <button
              type="submit"
              disabled={guardando}
              className="group flex h-[52px] items-center gap-2.5 rounded-full bg-vino py-0 pl-4.5 pr-6 text-[15px] font-bold text-arena transition hover:bg-teal disabled:opacity-50"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-arena text-vino transition duration-300 group-hover:rotate-90">
                <IconMas className="h-[18px] w-[18px]" />
              </span>
              {guardando ? 'Registrando…' : 'Registrar precio'}
            </button>
          </div>
        </form>

        {error && <p className="rounded-full bg-vino/10 px-5 py-3 text-sm font-semibold text-vino">{error}</p>}
        {aviso && <p className="rounded-full bg-salvia/25 px-5 py-3 text-sm font-semibold text-teal">{aviso}</p>}
      </section>

      <h2 className="px-1 font-display text-[28px] text-vino">Histórico</h2>

      {!productoId && (
        <div className="flex h-[220px] flex-col items-center justify-center gap-3 rounded-panel border-2 border-dashed border-salvia text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-arena text-teal">
            <IconPrecios className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">Elige un producto arriba</p>
        </div>
      )}

      {productoId && historial.loading && <p className="px-1 text-sm text-teal/70">Cargando histórico…</p>}
      {productoId && historial.error && <p className="px-1 text-sm font-semibold text-vino">{historial.error}</p>}

      {productoId && historial.data && filas.length === 0 && (
        <div className="flex h-[220px] flex-col items-center justify-center gap-3 rounded-panel border-2 border-dashed border-salvia text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-arena text-teal">
            <IconPrecios className="h-6 w-6" />
          </span>
          <p className="font-display text-2xl text-teal">Sin precios registrados todavía</p>
        </div>
      )}

      {filas.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filas.map((f) => (
            <article
              key={f.id}
              className="group relative flex origin-top flex-col gap-2.5 rounded-[34px] bg-arena px-5 pb-4 pt-8 text-tinta transition duration-300 hover:-rotate-2 hover:bg-vino hover:text-arena hover:shadow-lift"
            >
              <span className="absolute left-1/2 top-3 h-[18px] w-[18px] -translate-x-1/2 rounded-full bg-marfil shadow-[inset_0_0_0_4px_#8E0A0A]" />
              <div className="flex items-center justify-between gap-2">
                <StatusPill tone={f.vigente ? 'ok' : 'neutral'}>{f.vigente ? 'Vigente' : 'Histórico'}</StatusPill>
              </div>
              <span className="font-display text-[46px] font-extrabold leading-none">{formatoMoneda(f.price)}</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold leading-tight">{f.presentation?.nombre ?? 'Presentación'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-vino text-[12px] font-bold text-arena transition group-hover:bg-arena group-hover:text-vino">
                    {(f.store?.nombre ?? '?')[0]}
                  </span>
                  {f.store?.nombre ?? 'Tienda'}
                </span>
                {productoSeleccionado && (
                  <CircleButton
                    icon={<IconPrecios className="h-[17px] w-[17px]" />}
                    label="Volver a registrar"
                    size="sm"
                    onClick={() => {
                      setPresentacionId(f.presentationId);
                      setTiendaId(f.storeId);
                    }}
                  />
                )}
              </div>
              <span className="font-data text-xs opacity-80">
                {fechaCorta(f.effectiveDate)} — {fechaCorta(f.effectiveUntil)}
              </span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
