import { parsearCsv } from './csv.util';

const ENCABEZADO = 'folio,fecha,tienda,sku,presentacion,cantidad,precio';

function csv(lineas: string[]): Buffer {
  return Buffer.from([ENCABEZADO, ...lineas].join('\n'), 'utf-8');
}

describe('parsearCsv (M06)', () => {
  it('acepta encabezados reordenados e insensible a mayúsculas', () => {
    const { mapa, tabla } = parsearCsv(
      Buffer.from(
        'TIENDA, folio ,SKU,Precio, PRESENTACION ,Fecha ,Cantidad\n' +
          'T1,2026-09-01,Mi Tienda,P-001,1 kg,2,42.5',
        'utf-8',
      ),
    );
    expect(tabla.filas).toHaveLength(1);
    expect(mapa.tienda).toBe(0);
    expect(mapa.folio).toBe(1);
  });

  it('acepta delimitador punto y coma', () => {
    const { tabla } = parsearCsv(
      Buffer.from('folio;fecha;tienda;sku;presentacion;cantidad;precio\nT1;2026-09-01;T;P;1 kg;1;10', 'utf-8'),
    );
    expect(tabla.filas[0]).toHaveLength(7);
  });

  it('rechaza archivo sin datos', () => {
    expect(() => parsearCsv(Buffer.from(ENCABEZADO, 'utf-8'))).toThrow();
  });

  it('rechaza encabezado incompleto indicando qué falta', () => {
    expect(() => parsearCsv(Buffer.from('folio,fecha\nT1,2026-09-01', 'utf-8'))).toThrow(
      /tienda/,
    );
  });

  it('ignora líneas vacías y respeta comillas', () => {
    const { tabla } = parsearCsv(
      csv(['', 'T1,2026-09-01,"Tienda, Centro",P-001,1 kg,2,42.5', '']),
    );
    expect(tabla.filas).toHaveLength(1);
    expect(tabla.filas[0][2]).toBe('Tienda, Centro');
  });
});
