import { useState } from 'react';
import { SectionHeader } from '../../components/SectionHeader';
import { Select } from '../../components/ui/Select';
import { Field } from '../../components/ui/Field';
import { ErrorText } from '../../components/ui/ErrorText';
import { DataTable } from '../../components/DataTable';
import { useFetch } from '../../hooks/useFetch';
import { getCanastas } from '../../api/canastas';
import { IncomeSegment, Zona } from '../../types';

const formatoMoneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const formatoFecha = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' });

/**
 * M07 — Canastas: una por transacción registrada (RN-03), se construyen
 * solas al guardar la venta. Aquí solo se consultan; no hay alta manual.
 */
export function CanastasPanel({ zonas, segmentos }: { zonas: Zona[]; segmentos: IncomeSegment[] }) {
  const [zonaId, setZonaId] = useState('');
  const [segmentId, setSegmentId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fechasInvertidas = Boolean(dateFrom && dateTo && dateTo < dateFrom);

  const canastas = useFetch(
    () =>
      getCanastas({
        zoneId: zonaId || undefined,
        segmentId: segmentId ? Number(segmentId) : undefined,
        dateFrom: dateFrom || undefined,
        dateTo: fechasInvertidas ? undefined : dateTo || undefined,
      }),
    [zonaId, segmentId, dateFrom, dateTo],
  );

  const filas = canastas.data ?? [];

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader title="Canastas" description="Una canasta por transacción registrada. Se construyen solas al guardar la venta." />

      <div className="grid grid-cols-1 gap-3.5 rounded-panel bg-arena p-6 sm:grid-cols-2 lg:grid-cols-4">
        <Select id="canastas-zona" label="Zona" value={zonaId} onChange={(e) => setZonaId(e.target.value)} placeholder="Todas">
          {zonas.map((z) => (
            <option key={z.id} value={z.id}>{z.nombre}</option>
          ))}
        </Select>
        <Select
          id="canastas-segmento"
          label="Segmento de ingreso"
          value={segmentId}
          onChange={(e) => setSegmentId(e.target.value)}
          placeholder="Todos"
        >
          {segmentos.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
        <Field id="canastas-desde" label="Desde" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        <Field id="canastas-hasta" label="Hasta" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>

      {fechasInvertidas && <p className="px-1 text-xs font-semibold text-vino">La fecha final no puede ser anterior a la inicial.</p>}
      {canastas.loading && <p className="px-1 text-sm text-teal/70">Cargando…</p>}
      {canastas.error && <ErrorText>{canastas.error}</ErrorText>}

      {canastas.data && filas.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-2xl text-teal">Sin canastas con estos filtros</p>
          <p className="max-w-sm text-sm text-teal/70">
            Las canastas se construyen a partir de las transacciones registradas; prueba con otra zona, segmento o periodo.
          </p>
        </div>
      )}

      {filas.length > 0 && (
        <>
          <p className="px-1 text-sm text-teal/70">{filas.length} {filas.length === 1 ? 'canasta' : 'canastas'}</p>
          <DataTable
            rowKey={(c) => c.id}
            rows={filas}
            columns={[
              { header: 'Fecha', render: (c) => formatoFecha.format(new Date(c.date)) },
              { header: 'Zona', render: (c) => c.zone?.nombre ?? '—' },
              { header: 'Total', render: (c) => formatoMoneda.format(Number(c.totalValue)) },
              { header: 'Productos', render: (c) => c.productCount },
              { header: 'Unidades', render: (c) => Number(c.unitsTotal) },
              { header: 'Básicos', render: (c) => c.basicProductsCount },
            ]}
          />
        </>
      )}
    </section>
  );
}
