import {
  ahorroCrudo,
  CamposPromocion,
  contenido,
  erroresDeTipo,
  importe,
  mensajeIncompatible,
  ordenarComparacion,
  porcentaje,
  PresentacionMedida,
  promocionalCrudo,
  redondear,
  regularCrudo,
} from './calculo';

/** Arroz, presentación 1 kg (kg, factor 1), precio regular $30.00 (contrato §4). */
const ARROZ_1KG: PresentacionMedida = { contenido: 1, unidad: 'kg', tipo: 'masa', factor: 1 };
const REGULAR = 30;

const DESCUENTO: CamposPromocion = { type: 'descuento_porcentual', discountPct: 10 };
const PAQUETE: CamposPromocion = { type: 'paquete', packQuantity: 3, packPrice: 80 };
/** 1,200 g por $30: g tiene factor 0.001 (catalog `GET /v1/units`). */
const EMPAQUE: CamposPromocion = { type: 'tamano_empaque', promoContent: 1200, promoFactor: 0.001, promoPrice: 30 };

function fila(promo: CamposPromocion) {
  const reg = regularCrudo(REGULAR, ARROZ_1KG);
  const p = promocionalCrudo(promo, ARROZ_1KG, REGULAR)!;
  return {
    purchasePrice: importe(p.purchasePrice),
    items: p.items,
    contentBase: contenido(p.contentBase),
    unitPrice: importe(p.unitPrice),
    savingsPct: porcentaje(ahorroCrudo(reg.unitPrice, p.unitPrice)),
  };
}

describe('Caso de control §4 (arroz 1 kg a $30.00)', () => {
  it('regular: 30.00 MXN/kg', () => {
    const r = regularCrudo(REGULAR, ARROZ_1KG);
    expect([importe(r.price), contenido(r.contentBase), importe(r.unitPrice)]).toEqual([30, 1, 30]);
  });

  it('descuento 10 %: compra 27.00, 1 unidad, 1.000 kg → 27.00 MXN/kg, ahorro 10.00 %', () => {
    expect(fila(DESCUENTO)).toEqual({ purchasePrice: 27, items: 1, contentBase: 1, unitPrice: 27, savingsPct: 10 });
  });

  it('paquete 3 por $80: compra 80.00, 3 unidades, 3.000 kg → 26.67 MXN/kg (80/3), ahorro 11.11 %', () => {
    expect(fila(PAQUETE)).toEqual({ purchasePrice: 80, items: 3, contentBase: 3, unitPrice: 26.67, savingsPct: 11.11 });
  });

  it('tamaño de empaque 1,200 g por $30: 1.200 kg → 25.00 MXN/kg, ahorro 16.67 %', () => {
    expect(fila(EMPAQUE)).toEqual({ purchasePrice: 30, items: 1, contentBase: 1.2, unitPrice: 25, savingsPct: 16.67 });
  });

  it('tamaño de empaque 1,200 ml sobre una presentación en kg → unidades incompatibles (mensaje del contrato)', () => {
    expect(mensajeIncompatible('ml', 'volumen', 'kg', 'masa')).toBe(
      'promoUnit: ml (volumen) no se compara con la presentación en kg (masa)',
    );
  });

  it('orden de compare: tamaño (25.00) → paquete (26.67) → descuento (27.00)', () => {
    const reg = regularCrudo(REGULAR, ARROZ_1KG).unitPrice;
    const filas = [
      { id: 'descuento', promo: DESCUENTO },
      { id: 'paquete', promo: PAQUETE },
      { id: 'tamano', promo: EMPAQUE },
    ].map(({ id, promo }) => {
      const p = promocionalCrudo(promo, ARROZ_1KG, REGULAR)!;
      return { id, disponible: true, unitPrice: p.unitPrice, ahorro: ahorroCrudo(reg, p.unitPrice) };
    });
    expect(ordenarComparacion(filas).map((f) => f.id)).toEqual(['tamano', 'paquete', 'descuento']);
  });

  it('el ahorro se calcula con el unitario SIN redondear (redondeo solo al final)', () => {
    // Con 26.67 ya redondeado saldría 11.10 %; con 80/3 exacto sale 11.11 %.
    expect(porcentaje(ahorroCrudo(30, 26.67))).toBe(11.1);
    expect(fila(PAQUETE).savingsPct).toBe(11.11);
  });
});

describe('conversión a unidad base', () => {
  it('presentación de 500 g: paquete 2 por $25 → contenido base 1.000 kg, 25.00 MXN/kg', () => {
    const quinientos: PresentacionMedida = { contenido: 500, unidad: 'g', tipo: 'masa', factor: 0.001 };
    const p = promocionalCrudo({ type: 'paquete', packQuantity: 2, packPrice: 25 }, quinientos, null)!;
    expect([contenido(p.contentBase), importe(p.unitPrice)]).toEqual([1, 25]);
  });

  it('presentación de 600 ml: regular $18 → 30.00 MXN/l', () => {
    const r = regularCrudo(18, { contenido: 600, unidad: 'ml', tipo: 'volumen', factor: 0.001 });
    expect([contenido(r.contentBase), importe(r.unitPrice)]).toEqual([0.6, 30]);
  });

  it('descuento sin precio regular: no se calcula (null, nunca 0)', () => {
    expect(promocionalCrudo(DESCUENTO, ARROZ_1KG, null)).toBeNull();
  });

  it('paquete y tamaño de empaque sí se calculan sin precio regular', () => {
    expect(importe(promocionalCrudo(PAQUETE, ARROZ_1KG, null)!.unitPrice)).toBe(26.67);
    expect(importe(promocionalCrudo(EMPAQUE, ARROZ_1KG, null)!.unitPrice)).toBe(25);
  });
});

describe('redondeo: 2 decimales, mitad hacia arriba (lejos del cero), sin error binario', () => {
  it.each([
    [1.005, 1.01],
    [2.675, 2.68],
    [26.666666, 26.67],
    [11.115, 11.12],
    [10.004999, 10],
    [-2.675, -2.68],
    [-0.004, 0],
  ])('%p → %p', (x, esperado) => {
    expect(redondear(x, 2)).toBe(esperado);
  });

  it('contenido a 3 decimales', () => {
    expect(contenido(1.2345)).toBe(1.235);
    expect(contenido(0.0005)).toBe(0.001);
  });

  it('no deja -0 ni acepta valores no finitos', () => {
    expect(Object.is(redondear(-0.001, 2), 0)).toBe(true);
    expect(() => redondear(Infinity, 2)).toThrow();
    expect(() => redondear(NaN, 2)).toThrow();
  });
});

describe('campos por tipo (§4): obligatorios y prohibidos', () => {
  const base = { name: 'x', productId: 'p', presentationId: 'q', storeId: 's', validFrom: '2026-11-01', validTo: '2026-11-15' };

  it.each([
    ['descuento_porcentual', { discountPct: 10 }],
    ['paquete', { packQuantity: 3, packPrice: 80 }],
    ['tamano_empaque', { promoContent: 1200, promoUnit: 'g', promoPrice: 30 }],
  ])('%s válido', (type, extra) => {
    expect(erroresDeTipo({ ...base, type, ...extra })).toEqual([]);
  });

  it.each([
    ['descuento_porcentual', { discountPct: 10, packPrice: 80 }, ['packPrice no corresponde a una promoción descuento_porcentual']],
    ['descuento_porcentual', { discountPct: 10, promoUnit: 'g' }, ['promoUnit no corresponde a una promoción descuento_porcentual']],
    ['descuento_porcentual', {}, ['discountPct es obligatorio en una promoción descuento_porcentual']],
    ['paquete', { packQuantity: 3, packPrice: 80, discountPct: 5 }, ['discountPct no corresponde a una promoción paquete']],
    ['paquete', { packQuantity: 3, packPrice: 80, promoPrice: 30 }, ['promoPrice no corresponde a una promoción paquete']],
    ['paquete', { packQuantity: 3 }, ['packPrice es obligatorio en una promoción paquete']],
    ['tamano_empaque', { promoContent: 1200, promoUnit: 'g', promoPrice: 30, packQuantity: 2 }, ['packQuantity no corresponde a una promoción tamano_empaque']],
    ['tamano_empaque', { promoContent: 1200, promoUnit: 'g', promoPrice: 30, discountPct: 10 }, ['discountPct no corresponde a una promoción tamano_empaque']],
    ['tamano_empaque', { promoContent: 1200, promoPrice: 30 }, ['promoUnit es obligatorio en una promoción tamano_empaque']],
  ])('%s con %o → %o', (type, extra, errores) => {
    expect(erroresDeTipo({ ...base, type, ...extra })).toEqual(errores);
  });
});

describe('ordenarComparacion', () => {
  it('las no disponibles al final; los empates conservan el orden pedido', () => {
    const filas = [
      { id: 'a', disponible: false, unitPrice: null },
      { id: 'b', disponible: true, unitPrice: 26 },
      { id: 'c', disponible: true, unitPrice: 25 },
      { id: 'd', disponible: true, unitPrice: 25 },
    ];
    expect(ordenarComparacion(filas).map((f) => f.id)).toEqual(['c', 'd', 'b', 'a']);
  });
});
