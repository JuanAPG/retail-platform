import { FileCode, FileSpreadsheet } from 'lucide-react';
import { Columna, descargar, toCsv, toXml } from '../utils/exportar';

interface Props<T> {
  nombreArchivo: string;
  raizXml: string;
  filaXml: string;
  columnas: Columna<T>[];
  filas: T[];
}

export default function BotonesExportar<T>({ nombreArchivo, raizXml, filaXml, columnas, filas }: Props<T>) {
  const base = `${nombreArchivo}-${new Date().toISOString().slice(0, 10)}`;
  const sinDatos = filas.length === 0;
  const pista = sinDatos ? 'No hay filas para exportar' : undefined;
  return (
    <>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={sinDatos}
        title={pista}
        onClick={() => descargar(`${base}.csv`, toCsv(columnas, filas), 'text/csv')}
      >
        <FileSpreadsheet size={15} aria-hidden="true" />
        Exportar CSV
      </button>
      <button
        type="button"
        className="btn-secondary btn-sm"
        disabled={sinDatos}
        title={pista}
        onClick={() => descargar(`${base}.xml`, toXml(raizXml, filaXml, columnas, filas), 'application/xml')}
      >
        <FileCode size={15} aria-hidden="true" />
        Exportar XML
      </button>
    </>
  );
}
