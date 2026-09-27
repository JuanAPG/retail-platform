import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { Badge } from '../../components/Badge';
import { useFetch } from '../../hooks/useFetch';
import { getCategorias } from '../../api/catalogo';
import { getPatronesSustitucion } from '../../api/elasticidad';
import { SubstitutionPattern } from '../../types';
import { formatearDia } from './corridaFormato';

const selectCls = 'w-full rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-900';

const TIPO: Record<SubstitutionPattern['type'], { texto: string; tono: 'warning' | 'neutral'; flecha: string }> = {
  // Dirigido: B reemplaza a A cuando A sube de precio.
  precio: { texto: 'Por precio', tono: 'warning', flecha: '→' },
  // Simétrico: se compra uno u otro.
  preferencia: { texto: 'Por preferencia', tono: 'neutral', flecha: '↔' },
};

const dosDecimales = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

/**
 * M11 — Patrones de sustitución (S1-16) de una categoría. El backend los
 * calcula al momento y no los guarda; como el contrato devuelve solo la
 * lista, el método y sus supuestos se explican aquí.
 */
export function SustitucionPanel() {
  const categorias = useFetch(getCategorias, []);
  const [categoria, setCategoria] = useState('');
  const patrones = useFetch(
    () => (categoria ? getPatronesSustitucion(categoria) : Promise.resolve(null)),
    [categoria],
  );

  const nombreCategoria = categorias.data?.find((c) => String(c.id) === categoria)?.nombre ?? '';
  const lista = patrones.data ?? [];

  return (
    <section>
      <SectionHeader
        title="Sustitución"
        description="Productos de una misma categoría que se reemplazan entre sí: la gente compra uno u otro."
        action={
          <button
            type="button"
            onClick={patrones.refetch}
            disabled={!categoria || patrones.loading}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {patrones.loading && categoria ? 'Cargando…' : 'Actualizar'}
          </button>
        }
      />

      <div className="mb-6 max-w-sm">
        <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="sus-categoria">
          Categoría
        </label>
        <select id="sus-categoria" className={selectCls} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="">Elige una categoría</option>
          {(categorias.data ?? []).map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>

      {!categoria && (
        <EmptyState
          title="Elige una categoría"
          description="Se buscan sustitutos entre los productos de esa categoría, con las canastas registradas."
        />
      )}
      {categoria && patrones.loading && <p className="text-sm text-slate-500">Buscando patrones…</p>}
      {categoria && !patrones.loading && patrones.error && (
        <div className="flex items-center gap-3">
          <p className="text-sm text-red-600">{patrones.error}</p>
          <button
            type="button"
            onClick={patrones.refetch}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Reintentar
          </button>
        </div>
      )}
      {categoria && !patrones.loading && !patrones.error && lista.length === 0 && (
        <EmptyState
          title={`No se detectaron sustitutos en ${nombreCategoria}`}
          description="Puede deberse a que sus productos se compran juntos (no se reemplazan), a que alguno aparece en menos de 2 canastas, o a que hay muy pocas ventas para distinguirlo del azar."
        />
      )}
      {categoria && !patrones.loading && !patrones.error && lista.length > 0 && (
        <>
          <DataTable
            rowKey={(p) => `${p.originProductId}-${p.targetProductId}-${p.type}`}
            rows={lista}
            columns={[
              {
                header: 'Producto → Lo reemplaza',
                render: (p) => (
                  <div>
                    <p className="text-slate-900">
                      {p.originProductName} <span className="text-slate-400">{TIPO[p.type].flecha}</span>{' '}
                      {p.targetProductName}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      lift {p.lift.toLocaleString('es-MX', dosDecimales)} · r{' '}
                      {p.priceCorrelation === null ? '—' : p.priceCorrelation.toLocaleString('es-MX', dosDecimales)} ·{' '}
                      {p.observations} canastas
                    </p>
                  </div>
                ),
              },
              { header: 'Tipo', render: (p) => <Badge tone={TIPO[p.type].tono}>{TIPO[p.type].texto}</Badge> },
              {
                header: 'Fuerza',
                className: 'w-56',
                render: (p) => (
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 rounded bg-slate-100">
                      <div className="h-2 rounded bg-slate-700" style={{ width: `${p.score * 100}%` }} />
                    </div>
                    <span className="w-12 text-right tabular-nums">{Math.round(p.score * 100)} %</span>
                  </div>
                ),
              },
            ]}
          />
          <p className="mt-2 text-xs text-slate-500">
            Datos del {formatearDia(lista[0].periodStart)} al {formatearDia(lista[0].periodEnd)}.
          </p>
        </>
      )}

      {/* Umbrales copiados de substitution.service.ts (PRICE_CORRELATION_MIN,
          MIN_BASKETS_PER_PRODUCT, MIN_EXPECTED_TOGETHER): si cambian allá, actualizar aquí. */}
      <details className="mt-6 text-sm text-slate-700">
        <summary className="cursor-pointer text-slate-500">Cómo se detecta (método y supuestos)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Regla: dos productos de la categoría se compran juntos menos de lo esperado (lift &lt; 1), contando solo
            las canastas con productos de esa categoría.
          </li>
          <li>
            Correlación: si además, cuando A está más caro (precio vigente del histórico de precios), las canastas
            llevan más B (r ≥ 0.3), el tipo es «Por precio»; si no, «Por preferencia».
          </li>
          <li>
            Mínimos: cada producto en al menos 2 canastas, y que por azar se esperara verlos juntos al menos una vez.
          </li>
          <li>No detecta sustitución por desabasto: no hay historial de inventario.</li>
          <li>Se calcula al momento con las canastas registradas y no se guarda como corrida.</li>
        </ol>
      </details>
    </section>
  );
}
