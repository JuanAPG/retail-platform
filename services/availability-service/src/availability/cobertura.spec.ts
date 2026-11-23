import {
  Basico,
  basicoEnTienda,
  coberturaDeTienda,
  coberturaDeZona,
  diasDeVigencia,
  edadEnDias,
  estadoExistencia,
  estaVigente,
  Existencia,
  faltantes,
  porcentaje,
} from './cobertura';

const AHORA = new Date('2026-10-30T12:00:00.000Z');
const haceDias = (dias: number, horas = 0) => new Date(AHORA.getTime() - (dias * 24 + horas) * 3600 * 1000);

// Canasta básica del caso de control del contrato.
const ARROZ: Basico = { productId: 'arroz', productName: 'Arroz', presentationIds: ['arroz-1kg'] };
const FRIJOL: Basico = { productId: 'frijol', productName: 'Frijol', presentationIds: ['frijol-sierra', 'frijol-costena'] };
const LECHE: Basico = { productId: 'leche', productName: 'Leche', presentationIds: ['leche-1l'] };
const HUEVO: Basico = { productId: 'huevo', productName: 'Huevo', presentationIds: ['huevo-12'] };
const BASICOS = [ARROZ, FRIJOL, LECHE, HUEVO];

const dato = (storeId: string, presentationId: string, stock: number, capturedAt: Date): Existencia => ({
  storeId,
  presentationId,
  stock,
  capturedAt,
});

/** Tienda A del contrato. */
const TIENDA_A = [
  dato('A', 'arroz-1kg', 5, haceDias(0)),
  dato('A', 'frijol-sierra', 0, haceDias(1)),
  dato('A', 'frijol-costena', 3, haceDias(1)),
  dato('A', 'leche-1l', 0, haceDias(0)),
  dato('A', 'huevo-12', 10, haceDias(8)),
];
/** Tienda B del contrato: solo leche. */
const TIENDA_B = [dato('B', 'leche-1l', 8, haceDias(0))];

describe('vigencia de un dato (D-38: 7 días)', () => {
  it('7 días exactos sigue vigente; un minuto más ya venció', () => {
    expect(estaVigente(haceDias(7), AHORA, 7)).toBe(true);
    expect(estaVigente(new Date(haceDias(7).getTime() - 60000), AHORA, 7)).toBe(false);
  });

  it('un dato de hace 8 días está vencido aunque tenga existencia: no disponible', () => {
    expect(estadoExistencia(10, haceDias(8), AHORA, 7)).toBe('vencido');
  });

  it('vigente con existencia → disponible; vigente en 0 → agotado', () => {
    expect(estadoExistencia(5, haceDias(3), AHORA, 7)).toBe('disponible');
    expect(estadoExistencia(0, haceDias(3), AHORA, 7)).toBe('agotado');
  });

  it('edad en días completos, nunca negativa', () => {
    expect(edadEnDias(haceDias(3, 5), AHORA)).toBe(3);
    expect(edadEnDias(haceDias(0, 23), AHORA)).toBe(0);
    expect(edadEnDias(new Date(AHORA.getTime() + 60000), AHORA)).toBe(0);
  });

  it('la vigencia sale del entorno y un valor inválido cae a 7', () => {
    expect(diasDeVigencia({})).toBe(7);
    expect(diasDeVigencia({ AVAILABILITY_VALID_DAYS: '3' })).toBe(3);
    expect(diasDeVigencia({ AVAILABILITY_VALID_DAYS: '0' })).toBe(7);
    expect(diasDeVigencia({ AVAILABILITY_VALID_DAYS: 'siete' })).toBe(7);
  });
});

describe('estado de un básico en una tienda', () => {
  it('se cubre con CUALQUIERA de sus presentaciones (La Sierra en 0, La Costeña con 3)', () => {
    expect(basicoEnTienda(FRIJOL, TIENDA_A, AHORA, 7)).toMatchObject({ status: 'cubierto', presentationsWithStock: 1 });
  });

  it('faltante: dato vigente y todo en 0', () => {
    expect(basicoEnTienda(LECHE, TIENDA_A, AHORA, 7)).toMatchObject({ status: 'faltante', presentationsWithStock: 0 });
  });

  it('solo datos vencidos → vencido (ni cubierto ni faltante)', () => {
    const estado = basicoEnTienda(HUEVO, TIENDA_A, AHORA, 7);
    expect(estado.status).toBe('vencido');
    expect(estado.lastCapturedAt).toEqual(haceDias(8));
  });

  it('nunca capturado → sin_dato', () => {
    expect(basicoEnTienda(ARROZ, [], AHORA, 7)).toMatchObject({ status: 'sin_dato', lastCapturedAt: null });
  });

  it('otro producto no lo cubre: la existencia de arroz no cubre la leche', () => {
    expect(basicoEnTienda(LECHE, [dato('A', 'arroz-1kg', 50, haceDias(0))], AHORA, 7).status).toBe('sin_dato');
  });

  it('un 0 vigente pesa más que una existencia vencida de otra presentación: faltante', () => {
    const datos = [dato('A', 'frijol-sierra', 0, haceDias(1)), dato('A', 'frijol-costena', 9, haceDias(9))];
    expect(basicoEnTienda(FRIJOL, datos, AHORA, 7).status).toBe('faltante');
  });
});

describe('cobertura de una tienda', () => {
  it('CASO DE CONTROL: 4 básicos → 2 cubiertos, 1 faltante, 1 vencido → cobertura 50', () => {
    const c = coberturaDeTienda('A', BASICOS, TIENDA_A, AHORA, 7);
    expect(c).toMatchObject({
      storeId: 'A',
      validDays: 7,
      basics: 4,
      covered: 2,
      missing: 1,
      expired: 1,
      noData: 0,
      disponible: true,
      coverage: 50,
      motivo: null,
    });
    expect(c.items.map((i) => [i.productName, i.status])).toEqual([
      ['Arroz', 'cubierto'],
      ['Frijol', 'cubierto'],
      ['Huevo', 'vencido'],
      ['Leche', 'faltante'],
    ]);
  });

  it('no usa los datos de otra tienda', () => {
    expect(coberturaDeTienda('B', BASICOS, [...TIENDA_A, ...TIENDA_B], AHORA, 7)).toMatchObject({
      covered: 1,
      missing: 0,
      noData: 3,
      coverage: 25,
    });
  });

  it('sin ningún dato vigente: no disponible, con motivo y SIN número (nunca 0)', () => {
    const c = coberturaDeTienda('A', BASICOS, [dato('A', 'huevo-12', 10, haceDias(8))], AHORA, 7);
    expect(c.disponible).toBe(false);
    expect(c.coverage).toBeNull();
    expect(c.motivo).toMatch(/dato vigente/);
    expect(c).toMatchObject({ expired: 1, noData: 3 });
  });

  it('todos faltantes SÍ es un dato: cobertura 0 disponible', () => {
    const c = coberturaDeTienda('A', [LECHE], [dato('A', 'leche-1l', 0, haceDias(0))], AHORA, 7);
    expect(c).toMatchObject({ disponible: true, coverage: 0, missing: 1 });
  });

  it('catálogo sin canasta básica: no disponible', () => {
    const c = coberturaDeTienda('A', [], TIENDA_A, AHORA, 7);
    expect(c).toMatchObject({ basics: 0, disponible: false, coverage: null });
    expect(c.motivo).toMatch(/canasta básica/);
  });

  it('el porcentaje va a 2 decimales', () => {
    expect(porcentaje(1, 3)).toBe(33.33);
    expect(porcentaje(2, 3)).toBe(66.67);
    expect(porcentaje(0, 0)).toBe(0);
  });
});

describe('cobertura de una zona', () => {
  const zona = () => coberturaDeZona('Z', ['A', 'B'], BASICOS, [...TIENDA_A, ...TIENDA_B], AHORA, 7);

  it('CASO DE CONTROL: tiendas A y B → 3 de 4 básicos cubiertos → cobertura 75', () => {
    const { cobertura } = zona();
    expect(cobertura).toMatchObject({ zoneId: 'Z', stores: 2, basics: 4, covered: 3, disponible: true, coverage: 75 });
    expect(cobertura.items).toEqual([
      { productId: 'arroz', productName: 'Arroz', status: 'cubierto', storesWithStock: 1, storeShare: 50 },
      { productId: 'frijol', productName: 'Frijol', status: 'cubierto', storesWithStock: 1, storeShare: 50 },
      { productId: 'huevo', productName: 'Huevo', status: 'vencido', storesWithStock: 0, storeShare: 0 },
      { productId: 'leche', productName: 'Leche', status: 'cubierto', storesWithStock: 1, storeShare: 50 },
    ]);
  });

  it('resume cada tienda', () => {
    expect(zona().cobertura.byStore).toEqual([
      { storeId: 'A', disponible: true, coverage: 50, covered: 2, missing: 1 },
      { storeId: 'B', disponible: true, coverage: 25, covered: 1, missing: 0 },
    ]);
  });

  it('zona sin tiendas, o sin datos vigentes: no disponible y sin número', () => {
    const sinTiendas = coberturaDeZona('Z', [], BASICOS, [], AHORA, 7).cobertura;
    expect(sinTiendas).toMatchObject({ stores: 0, disponible: false, coverage: null });
    expect(sinTiendas.motivo).toMatch(/tiendas activas/);
    const sinDatos = coberturaDeZona('Z', ['A'], BASICOS, [dato('A', 'huevo-12', 4, haceDias(30))], AHORA, 7).cobertura;
    expect(sinDatos).toMatchObject({ disponible: false, coverage: null });
  });

  it('faltantes: una fila por tienda donde el básico falta', () => {
    expect(faltantes(zona().porTienda)).toEqual([
      { productId: 'leche', productName: 'Leche', storeId: 'A', lastCapturedAt: haceDias(0) },
    ]);
  });
});
