import { FormEvent, useMemo, useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { Badge } from '../../components/Badge';
import { EmptyState } from '../../components/EmptyState';
import { useFetch } from '../../hooks/useFetch';
import { mensajeDeError } from '../../api/errores';
import { getProductos, getTiendas } from '../../api/catalogo';
import { getHistorialPrecios, registrarPrecio } from '../../api/precios';

function formatoMoneda(valor: string | number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(
    Number(valor),
  );
}

function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const fecha = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(fecha);
}

/**
 * M08 — Registrar un precio nuevo y ver el histórico de un producto.
 *
 * No hay "editar" ni "borrar" un precio: RN-06 lo pide versionado. Un
 * precio nuevo cierra automáticamente el vigente anterior (lo hace el
 * backend en una transacción); esta pantalla solo captura y muestra,
 * nunca reescribe una fila del histórico.
 */
export function PreciosPanel() {
  const productos = useFetch(getProductos, []);
  const tiendas = useFetch(getTiendas, []);

  const [productoId, setProductoId] = useState('');
  const [presentacionId, setPresentacionId] = useState('');
  const [tiendaId, setTiendaId] = useState('');
  const [precio, setPrecio] = useState('');
  const [fecha, setFecha] = useState('');
  const [soloEstaPresentacion, setSoloEstaPresentacion] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const productoSeleccionado = useMemo(
    () => productos.data?.find((p) => p.id === productoId),
    [productos.data, productoId],
  );

  const historial = useFetch(
    () =>
      productoId
        ? getHistorialPrecios(productoId, soloEstaPresentacion ? presentacionId : undefined)
        : Promise.resolve([]),
    [productoId, presentacionId, soloEstaPresentacion],
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
    <section>
      <SectionHeader
        title="Gestión de precios"
        description="Histórico versionado por presentación y tienda (RN-06). Registrar un precio nuevo cierra el vigente anterior."
      />

      <div className="mb-6 rounded border border-slate-200 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Registrar precio</h2>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label htmlFor="precio-producto" className={labelClass}>
              Producto
            </label>
            <select
              id="precio-producto"
              value={productoId}
              onChange={(e) => elegirProducto(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecciona…</option>
              {(productos.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} — {p.nombre}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="precio-presentacion" className={labelClass}>
              Presentación
            </label>
            <select
              id="precio-presentacion"
              value={presentacionId}
              onChange={(e) => setPresentacionId(e.target.value)}
              disabled={!productoSeleccionado}
              className={inputClass}
            >
              <option value="">Selecciona…</option>
              {(productoSeleccionado?.presentaciones ?? []).map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.nombre} ({pr.contenido} {pr.unidadMedida?.clave})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="precio-tienda" className={labelClass}>
              Tienda
            </label>
            <select
              id="precio-tienda"
              value={tiendaId}
              onChange={(e) => setTiendaId(e.target.value)}
              className={inputClass}
            >
              <option value="">Selecciona…</option>
              {(tiendas.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre} — {t.zona?.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="precio-monto" className={labelClass}>
                Precio (MXN)
              </label>
              <input
                id="precio-monto"
                type="number"
                min={0}
                step="0.01"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex-1">
              <label htmlFor="precio-fecha" className={labelClass}>
                Vigente desde
              </label>
              <input
                id="precio-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex items-end sm:col-span-2 lg:col-span-5">
            <button
              type="submit"
              disabled={guardando}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {guardando ? 'Registrando…' : 'Registrar precio'}
            </button>
          </div>
        </form>

        {error && (
          <p role="alert" className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}
        {aviso && (
          <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{aviso}</p>
        )}
      </div>

      <h2 className="mb-3 text-sm font-semibold text-slate-800">Histórico</h2>

      {!productoId && (
        <EmptyState
          title="Selecciona un producto"
          description="Elige un producto arriba para ver su histórico de precios."
        />
      )}

      {productoId && (
        <>
          <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={soloEstaPresentacion}
              disabled={!presentacionId}
              onChange={(e) => setSoloEstaPresentacion(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Mostrar solo la presentación seleccionada
          </label>

          {historial.loading && <p className="text-sm text-slate-500">Cargando histórico…</p>}
          {historial.error && <p className="text-sm text-rose-600">{historial.error}</p>}

          {historial.data && filas.length === 0 && (
            <EmptyState
              title="Este producto no tiene precios registrados"
              description="Usa el formulario de arriba para capturar el primero."
            />
          )}

          {filas.length > 0 && (
            <DataTable
              rowKey={(f) => f.id}
              rows={filas}
              columns={[
                { header: 'Presentación', render: (f) => f.presentation?.nombre ?? '—' },
                { header: 'Tienda', render: (f) => f.store?.nombre ?? '—' },
                { header: 'Zona', render: (f) => f.store?.zona?.nombre ?? '—' },
                { header: 'Precio', render: (f) => formatoMoneda(f.price) },
                { header: 'Desde', render: (f) => fechaCorta(f.effectiveDate) },
                { header: 'Hasta', render: (f) => fechaCorta(f.effectiveUntil) },
                {
                  header: 'Estado',
                  render: (f) => (
                    <Badge tone={f.vigente ? 'positive' : 'neutral'}>
                      {f.vigente ? 'Vigente' : 'Histórico'}
                    </Badge>
                  ),
                },
              ]}
            />
          )}
        </>
      )}
    </section>
  );
}

const inputClass =
  'w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';
const labelClass = 'mb-1 block text-xs font-medium uppercase text-slate-500';
