import { aCanastaRespuesta, aTransaccionRespuesta } from './respuestas';

/**
 * La forma de la respuesta ES el contrato. Estas pruebas fijan que NO se
 * filtre nada de las tablas de catalog-service: devolver la entidad cruda
 * arrastraba `store.direccion.codigoPostal.municipio`, `zone.municipioId`,
 * `activo`, `updatedAt`… y el XML dejaba de validar contra el XSD en
 * cuanto el catálogo agregaba una columna.
 */

/** Entidad de zona como la trae TypeORM, con su relación eager. */
const ZONA = {
  id: 'z1',
  nombre: 'Centro',
  municipioId: 7,
  descripcion: 'Zona centro',
  activo: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-02-01T00:00:00Z'),
  municipio: { id: 7, nombre: 'Monterrey' },
};

const TIENDA = {
  id: 't1',
  nombre: 'Super Valle Centro',
  zonaId: 'z1',
  zona: ZONA,
  activo: true,
  direccion: { id: 'd1', calle: 'Morelos 100', codigoPostal: { codigo: '64000' } },
  proveedor: { id: 'pv1', nombre: 'Lácteos del Norte' },
};

const TRANSACCION = {
  id: 'tx1',
  folio: 'T-1',
  storeId: 't1',
  store: TIENDA,
  fecha: new Date('2026-09-02T10:15:00Z'),
  total: '113.50',
  canal: 'punto_venta',
  importacionId: null,
  capturadaPor: 'u1',
  createdAt: new Date('2026-09-02T10:16:00Z'),
  details: [
    {
      id: 'd2',
      transactionId: 'tx1',
      presentationId: 'pr2',
      quantity: '1.00',
      unitPrice: '28.50',
      subtotal: '28.50',
      presentation: {
        id: 'pr2',
        nombre: '500 g',
        productoId: 'p2',
        activo: true,
        producto: { id: 'p2', sku: 'P-002', nombre: 'Pan', esCanastaBasica: false },
      },
    },
    {
      id: 'd1',
      transactionId: 'tx1',
      presentationId: 'pr1',
      quantity: '2.00',
      unitPrice: '42.50',
      subtotal: '85.00',
      presentation: {
        id: 'pr1',
        nombre: '1 kg',
        productoId: 'p1',
        activo: true,
        producto: { id: 'p1', sku: 'P-001', nombre: 'Leche', esCanastaBasica: true },
      },
    },
  ],
};

const CANASTA = {
  id: 'k1',
  transactionId: 'tx1',
  transaction: TRANSACCION,
  zoneId: 'z1',
  zone: ZONA,
  segmentId: 2,
  date: new Date('2026-09-02T10:15:00Z'),
  totalValue: '113.50',
  productCount: 2,
  unitsTotal: '3.00',
  basicProductsCount: 1,
  builtAt: new Date('2026-09-02T10:16:00Z'),
};

describe('aTransaccionRespuesta', () => {
  it('expone exactamente los campos del contrato, ni uno más', () => {
    const r = aTransaccionRespuesta(TRANSACCION as never);
    expect(Object.keys(r).sort()).toEqual(
      [
        'canal',
        'capturadaPor',
        'createdAt',
        'details',
        'fecha',
        'folio',
        'id',
        'importacionId',
        'store',
        'storeId',
        'total',
      ].sort(),
    );
  });

  it('la tienda se reduce a id y nombre: no filtra dirección ni proveedor', () => {
    const r = aTransaccionRespuesta(TRANSACCION as never);
    expect(r.store).toEqual({ id: 't1', nombre: 'Super Valle Centro' });
    const plano = JSON.stringify(r);
    for (const fuga of ['direccion', 'codigoPostal', 'proveedor', 'zona', 'municipio', 'activo']) {
      expect(plano).not.toContain(fuga);
    }
  });

  it('el detalle expone productId plano y los nombres de catálogo', () => {
    const r = aTransaccionRespuesta(TRANSACCION as never);
    expect(r.details[0]).toEqual({
      id: 'd1',
      presentationId: 'pr1',
      productId: 'p1',
      presentationName: '1 kg',
      productSku: 'P-001',
      quantity: '2.00',
      unitPrice: '42.50',
      subtotal: '85.00',
    });
  });

  it('el detalle sale en orden estable aunque la base lo devuelva al revés', () => {
    const r = aTransaccionRespuesta(TRANSACCION as never);
    expect(r.details.map((d) => d.presentationId)).toEqual(['pr1', 'pr2']);
  });

  it('sin relaciones cargadas no truena: deja la referencia con nombre nulo', () => {
    const r = aTransaccionRespuesta({
      ...TRANSACCION,
      store: undefined,
      details: undefined,
    } as never);
    expect(r.store).toEqual({ id: 't1', nombre: null });
    expect(r.details).toEqual([]);
  });

  it('un detalle sin presentación cargada deja los campos de catálogo nulos', () => {
    const r = aTransaccionRespuesta({
      ...TRANSACCION,
      details: [{ ...TRANSACCION.details[1], presentation: undefined }],
    } as never);
    expect(r.details[0]).toMatchObject({
      presentationId: 'pr1',
      productId: null,
      presentationName: null,
      productSku: null,
    });
  });
});

describe('aCanastaRespuesta', () => {
  it('expone exactamente los campos del contrato, ni uno más', () => {
    const r = aCanastaRespuesta(CANASTA as never);
    expect(Object.keys(r).sort()).toEqual(
      [
        'basicProductsCount',
        'builtAt',
        'date',
        'hasBasicProducts',
        'id',
        'productCount',
        'segmentId',
        'storeId',
        'totalValue',
        'transactionId',
        'unitsTotal',
        'zone',
        'zoneId',
      ].sort(),
    );
  });

  it('la zona se reduce a id y nombre: no filtra municipio ni timestamps', () => {
    const r = aCanastaRespuesta(CANASTA as never);
    expect(r.zone).toEqual({ id: 'z1', nombre: 'Centro' });
    const plano = JSON.stringify(r);
    for (const fuga of ['municipioId', 'municipio', 'descripcion', 'activo', 'updatedAt']) {
      expect(plano).not.toContain(fuga);
    }
  });

  it('storeId sale de la transacción unida, y es nulo si no se trajo', () => {
    expect(aCanastaRespuesta(CANASTA as never).storeId).toBe('t1');
    expect(aCanastaRespuesta({ ...CANASTA, transaction: undefined } as never).storeId).toBeNull();
  });

  it('hasBasicProducts se deriva de basicProductsCount', () => {
    expect(aCanastaRespuesta(CANASTA as never).hasBasicProducts).toBe(true);
    expect(
      aCanastaRespuesta({ ...CANASTA, basicProductsCount: 0 } as never).hasBasicProducts,
    ).toBe(false);
  });

  it('segmento nulo se conserva como null (zona sin clasificación vigente)', () => {
    expect(aCanastaRespuesta({ ...CANASTA, segmentId: null } as never).segmentId).toBeNull();
  });

  it('findAll y findOne devuelven la MISMA forma', () => {
    // findAll une zone y transaction; findOne usa relations y además aplica
    // los eager en cascada. Con el mapeador las dos formas coinciden.
    const comoFindAll = aCanastaRespuesta({
      ...CANASTA,
      zone: { id: 'z1', nombre: 'Centro' },
      transaction: { id: 'tx1', storeId: 't1' },
    } as never);
    const comoFindOne = aCanastaRespuesta(CANASTA as never);
    expect(Object.keys(comoFindAll).sort()).toEqual(Object.keys(comoFindOne).sort());
    expect(comoFindAll).toEqual(comoFindOne);
  });
});
