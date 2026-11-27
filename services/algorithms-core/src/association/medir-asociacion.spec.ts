import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { foto, leerCanastas } from '../../scripts/medir-asociacion';
import { fotoDe } from './association.service';

/** El script de medición (scripts/medir-asociacion.ts) arma las canastas como el servicio. */
describe('medir-asociacion: canastas y foto como el servicio', () => {
  let carpeta: string;

  beforeAll(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'medir-'));
    const encabezado = 'folio,fecha,tienda,sku,presentacion,cantidad,precio\n';
    writeFileSync(join(carpeta, 'ventas-0001.csv'),
      encabezado +
      'F1,2026-11-02 10:00:00-06,T1,ARROZ,1 kg,2,32.00\n' +
      'F1,2026-11-02 10:00:00-06,T1,ARROZ,500 g,1,18.00\n' +      // otra presentación: el mismo producto
      'F1,2026-11-02 10:00:00-06,T1,FRIJOL,1 kg,1,42.50\n' +
      'F2,2026-11-03 11:00:00-06,T1,LECHE,1 L,3,27.50\n');
    writeFileSync(join(carpeta, 'ventas-0002.csv'), encabezado + 'F3,2026-11-04 12:00:00-06,T2,FRIJOL,1 kg,1,42.50\n');
    writeFileSync(join(carpeta, 'otro.csv'), encabezado + 'X,2026-11-04 12:00:00-06,T2,NO,1 kg,1,1.00\n');
  });

  afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

  it('una canasta por folio, cada producto una vez, solo de los ventas-*.csv', () => {
    expect(leerCanastas(carpeta)).toEqual([['ARROZ', 'FRIJOL'], ['LECHE'], ['FRIJOL']]);
  });

  it('el hash de la foto es el mismo que guarda el servicio (D-15)', () => {
    const canastas = leerCanastas(carpeta);
    expect(foto(canastas)).toBe(fotoDe(canastas).hash);
    expect(foto([...canastas].reverse())).toBe(foto(canastas));   // no depende del orden
  });
});
