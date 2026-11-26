import { useCallback, useEffect, useRef, useState } from 'react';
import {
  abrirDescarga,
  ArchivoReporte,
  emitirUrlDescarga,
  exportarReporte,
  FormatoArchivo,
  getArchivo,
  getArchivos,
  prepararArchivo,
} from '../../api/documentos';
import { esReintentable, mensajeDeError, statusDe } from '../../api/errores';
import { CtaButton } from '../../components/ui/CtaButton';
import { StatusPill } from '../../components/ui/StatusPill';

const FORMATOS: { formato: FormatoArchivo; etiqueta: string }[] = [
  { formato: 'pdf', etiqueta: 'PDF' },
  { formato: 'xlsx', etiqueta: 'Excel' },
  { formato: 'csv', etiqueta: 'CSV' },
];

/** Cada cuánto se consulta un archivo que otro intento está generando (202), y hasta cuándo. */
const SONDEO_MS = 2000;
const SONDEO_MAXIMO = 15;

type Fase =
  | { tipo: 'sin-archivo' }
  | { tipo: 'preparando' }
  | { tipo: 'disponible'; archivo: ArchivoReporte }
  | { tipo: 'descargando'; archivo: ArchivoReporte }
  | { tipo: 'error'; mensaje: string; reintentable: boolean };

function tamano(bytes: number | null): string {
  if (bytes == null) return '';
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function faseDe(a: ArchivoReporte | undefined): Fase {
  if (!a) return { tipo: 'sin-archivo' };
  if (a.estado === 'disponible') return { tipo: 'disponible', archivo: a };
  if (a.estado === 'pendiente') return { tipo: 'preparando' };
  return { tipo: 'error', mensaje: 'La última preparación falló (el almacén no respondió). Puedes reintentar.', reintentable: true };
}

/**
 * Archivo privado del reporte (Parcial 3): se prepara en el almacén del servidor
 * (GCS en staging) y se descarga con una URL firmada que dura minutos.
 * Estados visibles: sin archivo → preparando → disponible, o error recuperable.
 *
 * Compatibilidad: si el documents-service desplegado todavía no tiene la ruta
 * de archivos (404 en la lista), se usa la descarga directa de siempre.
 */
export function ArchivosReporte({ reporteId, creadoEn, alDescargar }: { reporteId: string; creadoEn: string; alDescargar: () => void }) {
  const [fases, setFases] = useState<Record<FormatoArchivo, Fase>>({
    pdf: { tipo: 'sin-archivo' },
    xlsx: { tipo: 'sin-archivo' },
    csv: { tipo: 'sin-archivo' },
  });
  const [sinRutaNueva, setSinRutaNueva] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const vivo = useRef(true);

  const poner = useCallback((formato: FormatoArchivo, fase: Fase) => {
    if (vivo.current) setFases((f) => ({ ...f, [formato]: fase }));
  }, []);

  useEffect(() => {
    vivo.current = true;
    setAviso(null);
    getArchivos(reporteId)
      .then((lista) => {
        if (!vivo.current) return;
        setSinRutaNueva(false);
        setFases({
          pdf: faseDe(lista.find((a) => a.formato === 'pdf')),
          xlsx: faseDe(lista.find((a) => a.formato === 'xlsx')),
          csv: faseDe(lista.find((a) => a.formato === 'csv')),
        });
      })
      .catch((err) => {
        // 404 en la LISTA de un reporte que sí se abrió = servicio sin la ruta nueva.
        if (statusDe(err) === 404) setSinRutaNueva(true);
      });
    return () => {
      vivo.current = false;
    };
  }, [reporteId]);

  async function esperar(formato: FormatoArchivo, archivoId: string) {
    for (let i = 0; i < SONDEO_MAXIMO && vivo.current; i++) {
      await new Promise((ok) => setTimeout(ok, SONDEO_MS));
      try {
        const a = await getArchivo(reporteId, archivoId);
        if (a.estado !== 'pendiente') return a;
      } catch {
        // Un fallo de red al consultar no decide nada: se vuelve a intentar.
      }
    }
    return null;
  }

  async function preparar(formato: FormatoArchivo, etiqueta: string) {
    setAviso(null);
    poner(formato, { tipo: 'preparando' });
    try {
      let a = await prepararArchivo(reporteId, formato);
      if (a.estado === 'pendiente') {
        const listo = await esperar(formato, a.id);
        if (!listo) {
          poner(formato, { tipo: 'error', mensaje: 'Sigue preparándose. Vuelve a intentar en unos segundos.', reintentable: true });
          return;
        }
        a = listo;
      }
      poner(formato, faseDe(a));
      if (a.estado === 'disponible') setAviso(`Tu archivo ${etiqueta} ya se puede descargar.`);
    } catch (err) {
      poner(formato, {
        tipo: 'error',
        mensaje: mensajeDeError(err, `No se pudo preparar el ${etiqueta}.`),
        reintentable: esReintentable(err) || statusDe(err) === 503,
      });
    }
  }

  async function descargar(formato: FormatoArchivo, archivo: ArchivoReporte, etiqueta: string) {
    poner(formato, { tipo: 'descargando', archivo });
    try {
      abrirDescarga(await emitirUrlDescarga(reporteId, archivo.id));
      poner(formato, { tipo: 'disponible', archivo });
      alDescargar();
    } catch (err) {
      // 409: el objeto dejó de estar en el almacén; hay que prepararlo otra vez.
      poner(formato, {
        tipo: 'error',
        mensaje:
          statusDe(err) === 409
            ? `El ${etiqueta} ya no está en el almacén. Prepáralo de nuevo.`
            : mensajeDeError(err, `No se pudo descargar el ${etiqueta}.`),
        reintentable: true,
      });
    }
  }

  if (sinRutaNueva) {
    return <DescargaDirecta reporteId={reporteId} creadoEn={creadoEn} alDescargar={alDescargar} />;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="archivos-reporte">
      <h3 className="text-[13px] font-semibold text-teal">Archivos para descargar</h3>
      {aviso && (
        <p role="status" className="rounded-full bg-salvia/20 px-4 py-2 text-sm text-tinta">
          {aviso}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {FORMATOS.map(({ formato, etiqueta }) => {
          const fase = fases[formato];
          return (
            <div key={formato} className="flex min-w-[200px] flex-col gap-2 rounded-[22px] bg-arena p-3" data-formato={formato}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-tinta">{etiqueta}</span>
                {fase.tipo === 'preparando' && <StatusPill tone="neutral">Preparando…</StatusPill>}
                {(fase.tipo === 'disponible' || fase.tipo === 'descargando') && <StatusPill tone="ok">Disponible</StatusPill>}
                {fase.tipo === 'error' && <StatusPill tone="warn">Error</StatusPill>}
              </div>
              {(fase.tipo === 'disponible' || fase.tipo === 'descargando') && (
                <span className="text-[11px] text-teal/70">{tamano(fase.archivo.tamanoBytes)} · enlace privado de pocos minutos</span>
              )}
              {fase.tipo === 'error' && <span className="text-xs text-vino">{fase.mensaje}</span>}

              {fase.tipo === 'sin-archivo' && <CtaButton onClick={() => preparar(formato, etiqueta)}>Preparar {etiqueta}</CtaButton>}
              {fase.tipo === 'preparando' && <CtaButton disabled>Preparando…</CtaButton>}
              {fase.tipo === 'disponible' && <CtaButton onClick={() => descargar(formato, fase.archivo, etiqueta)}>Descargar {etiqueta}</CtaButton>}
              {fase.tipo === 'descargando' && <CtaButton disabled>Abriendo descarga…</CtaButton>}
              {fase.tipo === 'error' && fase.reintentable && <CtaButton onClick={() => preparar(formato, etiqueta)}>Reintentar</CtaButton>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** La descarga de antes (`/export`), para un documents-service sin la ruta de archivos. */
function DescargaDirecta({ reporteId, creadoEn, alDescargar }: { reporteId: string; creadoEn: string; alDescargar: () => void }) {
  const [exportando, setExportando] = useState<FormatoArchivo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function exportar(formato: FormatoArchivo) {
    setError(null);
    setExportando(formato);
    try {
      await exportarReporte(reporteId, formato, creadoEn);
      alDescargar();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo exportar el reporte.'));
    } finally {
      setExportando(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <span className="text-sm text-vino">{error}</span>}
      <div className="flex flex-wrap gap-3">
        {FORMATOS.map(({ formato, etiqueta }) => (
          <CtaButton key={formato} onClick={() => exportar(formato)} disabled={exportando !== null}>
            {exportando === formato ? `Generando ${etiqueta}…` : `Descargar ${etiqueta}`}
          </CtaButton>
        ))}
      </div>
    </div>
  );
}
