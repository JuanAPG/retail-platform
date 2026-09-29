import { useFetch } from '../../hooks/useFetch';
import { compararPreciosEntreZonas } from '../../api/precios';
import { Producto } from '../../types';
import { IconPrecios } from '../../components/ui/icons';

interface ComparacionPreciosPanelProps {
  producto: Producto | null;
}

function formatoMoneda(valor: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(valor);
}

/**
 * M08 — Compara el precio vigente de un producto entre zonas.
 *
 * Nota de fidelidad: Categoria.dc.html muestra esta tarjeta comparando
 * PRECIO POR TIENDA Y PRESENTACIÓN (con chips de 500 g/1 kg), pero el
 * endpoint real (`compararPreciosEntreZonas`) agrega por ZONA, no por
 * tienda ni presentación — se mantiene la receta visual (tarjeta vino,
 * fila con círculo + nombre + precio, la más barata resaltada) sobre
 * los datos que el backend sí entrega.
 */
export function ComparacionPreciosPanel({ producto }: ComparacionPreciosPanelProps) {
  const comparacion = useFetch(
    () => (producto ? compararPreciosEntreZonas(producto.id) : Promise.resolve(null)),
    [producto?.id],
  );

  const zonas = comparacion.data?.zones ?? [];
  const min = zonas.length > 0 ? Math.min(...zonas.map((z) => z.averagePrice)) : null;
  const max = zonas.length > 0 ? Math.max(...zonas.map((z) => z.averagePrice)) : null;
  const promedio = zonas.length > 0 ? zonas.reduce((acc, z) => acc + z.averagePrice, 0) / zonas.length : null;
  const variacion = min && max && min > 0 ? (((max - min) / min) * 100).toFixed(1) : null;

  return (
    <section className="flex flex-col gap-4 rounded-panel bg-vino p-6 text-arena">
      <div className="flex items-center gap-3 px-1">
        <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-arena text-vino">
          <IconPrecios className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-display text-xl leading-tight">
            {producto ? producto.nombre : 'Comparar precios'}
          </span>
          <span className="font-data text-xs opacity-80">
            {producto ? producto.sku : 'Elige un producto del catálogo'}
          </span>
        </div>
      </div>

      {!producto && (
        <p className="px-1 text-sm leading-relaxed opacity-90">
          Usa el ícono de precio en cualquier tarjeta del catálogo para comparar sus precios entre zonas.
        </p>
      )}

      {producto && comparacion.loading && <p className="px-1 text-sm">Calculando…</p>}
      {producto && comparacion.error && <p className="px-1 text-sm">{comparacion.error}</p>}
      {producto && comparacion.data && zonas.length === 0 && (
        <p className="px-1 text-sm opacity-90">Este producto no tiene precios vigentes todavía.</p>
      )}

      {zonas.length > 0 && (
        <div className="flex flex-col gap-2">
          {zonas.map((z) => (
            <div
              key={z.zoneId}
              className={`flex items-center gap-3 rounded-full px-2.5 py-2 pr-4 transition hover:translate-x-1 ${
                z.averagePrice === min ? 'bg-salvia text-tinta' : 'bg-arena/10'
              }`}
            >
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-arena text-sm font-bold text-vino">
                {z.zoneName.slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 truncate text-[15px] font-semibold">{z.zoneName}</span>
              <span className="font-data text-[15px]">{formatoMoneda(z.averagePrice)}</span>
            </div>
          ))}
        </div>
      )}

      {promedio !== null && variacion !== null && (
        <div className="flex gap-2">
          <div className="flex flex-1 flex-col rounded-full bg-teal px-4 py-2.5">
            <span className="text-[11px] font-semibold opacity-75">Promedio</span>
            <span className="font-data text-base">{formatoMoneda(promedio)}</span>
          </div>
          <div className="flex flex-1 flex-col rounded-full bg-tinta px-4 py-2.5">
            <span className="text-[11px] font-semibold opacity-75">Variación</span>
            <span className="font-data text-base">+{variacion}%</span>
          </div>
        </div>
      )}
    </section>
  );
}
