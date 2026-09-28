import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { DataTable } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { Badge } from '../../components/Badge';
import { Select } from '../../components/ui/Select';
import { ErrorText } from '../../components/ui/ErrorText';
import { useFetch } from '../../hooks/useFetch';
import { getCategorias } from '../../api/catalogo';
import { getPatronesSustitucion } from '../../api/elasticidad';
import { SubstitutionPattern } from '../../types';
import { formatearDia } from './corridaFormato';

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
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="Sustitución"
        description="Productos de una misma categoría que se reemplazan entre sí: la gente compra uno u otro."
        action={
          <button
            type="button"
            onClick={patrones.refetch}
            disabled={!categoria || patrones.loading}
            className="flex h-11 items-center rounded-full border-2 border-salvia/60 px-4 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta disabled:cursor-not-allowed disabled:opacity-50"
          >
            {patrones.loading && categoria ? 'Cargando…' : 'Actualizar'}
          </button>
        }
      />

      <div className="max-w-sm">
        <Select id="sus-categoria" label="Categoría" value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Elige una categoría">
          {(categorias.data ?? []).map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.nombre}
            </option>
          ))}
        </Select>
      </div>

      {!categoria && (
        <EmptyState
          title="Elige una categoría"
          description="Se buscan sustitutos entre los productos de esa categoría, con las canastas registradas."
        />
      )}
      {categoria && patrones.loading && <p className="text-sm text-teal/70">Buscando patrones…</p>}
      {categoria && !patrones.loading && patrones.error && (
        <div className="flex items-center gap-3">
          <ErrorText>{patrones.error}</ErrorText>
          <button
            type="button"
            onClick={patrones.refetch}
            className="flex h-11 shrink-0 items-center rounded-full border-2 border-salvia/60 px-4 text-sm font-bold text-teal transition hover:bg-salvia hover:text-tinta"
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
        <div className="flex flex-col gap-2">
          <DataTable
            rowKey={(p) => `${p.originProductId}-${p.targetProductId}-${p.type}`}
            rows={lista}
            columns={[
              {
                header: 'Producto → Lo reemplaza',
                render: (p) => (
                  <div>
                    <p className="text-tinta">
                      {p.originProductName} <span className="text-teal/50">{TIPO[p.type].flecha}</span> {p.targetProductName}
                    </p>
                    <p className="mt-0.5 font-data text-xs text-teal/70">
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
                    <div className="h-2 flex-1 rounded-full bg-marfil">
                      <div className="h-2 rounded-full bg-vino" style={{ width: `${p.score * 100}%` }} />
                    </div>
                    <span className="w-12 text-right font-data text-xs tabular-nums text-teal">{Math.round(p.score * 100)} %</span>
                  </div>
                ),
              },
            ]}
          />
          <p className="text-xs text-teal/70">
            Datos del {formatearDia(lista[0].periodStart)} al {formatearDia(lista[0].periodEnd)}.
          </p>
        </div>
      )}

      {/* Umbrales copiados de substitution.service.ts (PRICE_CORRELATION_MIN,
          MIN_BASKETS_PER_PRODUCT, MIN_EXPECTED_TOGETHER): si cambian allá, actualizar aquí. */}
      <details className="text-sm text-teal">
        <summary className="cursor-pointer font-semibold text-teal/70">Cómo se detecta (método y supuestos)</summary>
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
