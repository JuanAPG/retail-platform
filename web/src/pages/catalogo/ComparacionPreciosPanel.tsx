import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { useFetch } from '../../hooks/useFetch';
import { getProductos } from '../../api/catalogo';
import { compararPreciosEntreZonas } from '../../api/precios';

function formatoMoneda(valor: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(valor);
}

/** M08 — Compara el precio VIGENTE de un producto entre las zonas donde se vende. */
export function ComparacionPreciosPanel() {
  const productos = useFetch(getProductos, []);
  const [productoId, setProductoId] = useState('');

  const comparacion = useFetch(
    () => (productoId ? compararPreciosEntreZonas(productoId) : Promise.resolve(null)),
    [productoId],
  );

  const zonas = comparacion.data?.zones ?? [];

  return (
    <section>
      <SectionHeader
        title="Comparación de precios entre zonas"
        description="Precio vigente promedio, mínimo y máximo de un producto en cada zona donde se vende."
      />

      <div className="mb-6 max-w-md">
        <label htmlFor="comparacion-producto" className="mb-1 block text-xs font-medium uppercase text-slate-500">
          Producto
        </label>
        <select
          id="comparacion-producto"
          value={productoId}
          onChange={(e) => setProductoId(e.target.value)}
          className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        >
          <option value="">Selecciona un producto…</option>
          {(productos.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} — {p.nombre}
            </option>
          ))}
        </select>
      </div>

      {!productoId && (
        <EmptyState
          title="Selecciona un producto"
          description="Elige un producto arriba para comparar su precio entre zonas."
        />
      )}

      {productoId && comparacion.loading && (
        <p className="text-sm text-slate-500">Calculando comparación…</p>
      )}
      {productoId && comparacion.error && (
        <p className="text-sm text-rose-600">{comparacion.error}</p>
      )}

      {productoId && comparacion.data && zonas.length === 0 && (
        <EmptyState
          title="Este producto no tiene precios vigentes"
          description="No hay ningún precio activo para este producto en ninguna tienda todavía."
        />
      )}

      {zonas.length > 0 && (
        <DataTable
          rowKey={(z) => z.zoneId}
          rows={zonas}
          columns={[
            { header: 'Zona', render: (z) => z.zoneName },
            { header: 'Precio promedio', render: (z) => formatoMoneda(z.averagePrice) },
            { header: 'Mínimo', render: (z) => formatoMoneda(z.minPrice) },
            { header: 'Máximo', render: (z) => formatoMoneda(z.maxPrice) },
            { header: 'Tiendas', render: (z) => z.storeCount },
          ]}
        />
      )}
    </section>
  );
}
