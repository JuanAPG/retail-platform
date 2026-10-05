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
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={sinDatos}
        onClick={() => descargar(`${base}.csv`, toCsv(columnas, filas), 'text/csv')}
      >
        Exportar CSV
      </button>
      <button
        type="button"
        className="btn-secondary"
        disabled={sinDatos}
        onClick={() => descargar(`${base}.xml`, toXml(raizXml, filaXml, columnas, filas), 'application/xml')}
      >
        Exportar XML
      </button>
    </>
  );
}