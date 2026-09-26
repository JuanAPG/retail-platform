import { useState } from 'react';
import { useFetch } from '../../hooks/useFetch';
import { getTransacciones } from '../../api/transacciones';
import { getProductos, getTiendas } from '../../api/catalogo';
import { Hero } from '../../components/ui/Hero';
import { IconMas, IconTransacciones } from '../../components/ui/icons';
import { TransaccionFormModal } from './TransaccionFormModal';
import { ImportarCsvPanel } from './ImportarCsvPanel';

interface TransaccionesPanelProps {
  busqueda: string;
}

/**
 * M06 — Transacciones. Lista lo registrado, da de alta manual y recibe
 * el CSV (preview → confirm). Cada guardado construye su canasta en el
 * backend (M07), así que aquí no hay que hacer nada más tras guardar.
 */
export function TransaccionesPanel({ busqueda }: TransaccionesPanelProps) {
  const transacciones = useFetch(getTransacciones, []);
  const tiendas = useFetch(getTiendas, []);
  const productos = useFetch(getProductos, []);

  const [formAbierto, setFormAbierto] = useState(false);
  const [importacionAbierta, setImportacionAbierta] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const todas = transacciones.data ?? [];
  const texto = busqueda.trim().toLowerCase();
  const filas = texto
    ? todas.filter(
        (t) =>
          t.folio.toLowerCase().includes(texto) ||
          (t.store?.nombre ?? '').toLowerCase().includes(texto) ||
          t.details?.some((d) => d.presentation?.producto?.nombre?.toLowerCase().includes(texto)),
      )
    : todas;
  const tiendasConVentas = new Set(todas.map((t) => t.storeId)).size;

  function trasGuardar(mensaje: string) {
    setFormAbierto(false);
    setAviso(mensaje);
    transacciones.refetch();
  }

  return (
    <div className="flex flex-col gap-6">
      <Hero
        title="Transacciones"
        subtitle="Cada registro construye su canasta al guardarse"
        action={
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setImportacionAbierta((v) => !v)}
              className="flex h-[52px] items-center rounded-full border-2 border-arena/40 px-5 text-sm font-bold text-arena transition hover:bg-salvia hover:text-tinta"
            >
              Importar CSV
            </button>
            <button
              type="button"
              onClick={() => setFormAbierto(true)}
              className="group flex h-[52px] items-center gap-2.5 rounded-full bg-vino py-0 pl-4.5 pr-6 text-[15px] font-bold text-arena transition hover:bg-arena hover:text-vino"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-arena text-vino transition duration-300 group-hover:rotate-90 group-hover:bg-vino group-hover:text-arena">
                <IconMas className="h-[18px] w-[18px]" />
              </span>
              Nueva transacción
            </button>
          </div>
        }
        decorations={
          <>
            <div className="absolute -top-[54px] right-[100px] flex h-[184px] w-[184px] items-center justify-center rounded-full bg-salvia text-tinta">
              <IconTransacciones className="mt-8 h-[74px] w-[74px]" />
            </div>
            <div className="absolute right-[22px] top-[18px] flex h-[108px] w-[108px] flex-col items-center justify-center gap-0.5 rounded-full bg-arena text-teal">
              <span className="font-display text-[30px] leading-none">{todas.length}</span>
              <span className="text-[10px] font-semibold">registradas</span>
            </div>
            <div className="absolute right-[190px] top-[130px] flex h-[92px] w-[92px] flex-col items-center justify-center gap-0.5 rounded-full bg-marfil text-teal">
              <span className="font-display text-xl leading-none">
                {tiendasConVentas}/{tiendas.data?.length ?? '—'}
              </span>
              <span className="text-[10px] font-semibold">tiendas</span>
            </div>
          </>
        }
      />

      {aviso && (
        <div className="flex items-center justify-between gap-4 rounded-full bg-salvia/25 px-5 py-3">
          <p className="text-sm font-semibold text-teal">{aviso}</p>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="text-sm text-teal">
            ✕
          </button>
        </div>
      )}

      {importacionAbierta && (
        <div className="rounded-panel bg-teal p-6">
          <ImportarCsvPanel
            onImportado={(mensaje) => {
              setAviso(mensaje);
              transacciones.refetch();
            }}
          />
        </div>
      )}

      {transacciones.error && <p className="px-1 text-sm font-semibold text-vino">{transacciones.error}</p>}

      {!transacciones.loading && !transacciones.error && todas.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-2xl text-teal">Aún no hay transacciones registradas</p>
          <p className="max-w-sm text-sm text-teal/70">
            Importa un lote de transacciones o registra una manualmente para empezar a construir canastas e
            indicadores.
          </p>
        </div>
      )}

      {!transacciones.loading && todas.length > 0 && filas.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-salvia py-14 text-center">
          <p className="font-display text-2xl text-teal">Ninguna transacción coincide con la búsqueda</p>
        </div>
      )}

      {filas.length > 0 && (
        <div className="flex flex-col gap-2">
          {filas.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3.5 rounded-full bg-arena p-2 pr-4 transition hover:translate-x-1 hover:border-salvia border-2 border-transparent"
            >
              <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-salvia text-sm font-bold text-tinta">
                {t.details?.length ?? 0}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-bold text-tinta">{t.store?.nombre ?? '—'}</span>
                <span className="font-data text-xs text-teal">
                  {t.folio} · {new Date(t.date).toLocaleDateString('es-MX')} · {t.importacionId ? 'CSV' : 'Manual'}
                </span>
              </div>
              <span className="font-data text-[15px] font-semibold text-tinta">${Number(t.total).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {formAbierto && (
        <TransaccionFormModal
          tiendas={tiendas.data ?? []}
          productos={productos.data ?? []}
          onCerrar={() => setFormAbierto(false)}
          onGuardado={trasGuardar}
        />
      )}
    </div>
  );
}
