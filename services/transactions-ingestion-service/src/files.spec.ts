import { readFile } from './files';

const header = 'folio,fecha,tienda,sku,presentacion,cantidad,precio\n';

it('admite más de 5.000 filas lógicas y respeta el límite del contrato', () => {
  const row = 'folio,2026-01-01,tienda,sku,pieza,1,15\n';
  expect(readFile(Buffer.from(header + row.repeat(5001))).rows).toHaveLength(5001);
  expect(() => readFile(Buffer.from(header + row.repeat(10001)))).toThrow('10000 filas');
});

it('permite delimitadores en celdas entrecomilladas', () => {
  const row = 'folio,2026-01-01,"Tienda, Centro",sku,pieza,1,15';
  expect(readFile(Buffer.from(header + row)).rows[0]).toMatchObject({ tienda: 'Tienda, Centro' });
});
