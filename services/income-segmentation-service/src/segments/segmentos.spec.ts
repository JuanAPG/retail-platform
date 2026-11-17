import { BadRequestException } from '@nestjs/common';
import { aplicarCambios, decimal, seEnciman, validarRango, ValoresSegmento } from './segmentos';

/** Los tres segmentos del seed: 0–15 000, 15 000.01–40 000 y 40 000.01 sin tope. */
const SEED = [
  { code: 'ING_1', min: 0, max: 15000 },
  { code: 'ING_2', min: 15000.01, max: 40000 },
  { code: 'ING_3', min: 40000.01, max: null },
];

const vigente: ValoresSegmento = {
  name: 'Ingreso bajo',
  incomeRangeMin: '0.00',
  incomeRangeMax: '15000.00',
  source: 'INEGI - ENIGH 2022',
  updateFrequency: 'Anual',
  zoneRelation: 'Zona agregada (RN-02)',
  limitations: 'No captura variación dentro de la zona',
  description: null,
};

describe('rangos de ingreso (D-10)', () => {
  it('dos rangos que comparten un extremo se enciman', () => {
    expect(seEnciman({ min: 0, max: 15000 }, { min: 15000, max: 20000 })).toBe(true);
  });

  it('rangos contiguos sin tocarse no se enciman', () => {
    expect(seEnciman({ min: 0, max: 15000 }, { min: 15000.01, max: 40000 })).toBe(false);
  });

  it('"sin tope" cuenta como infinito', () => {
    expect(seEnciman({ min: 40000.01, max: null }, { min: 90000, max: 95000 })).toBe(true);
    expect(seEnciman({ min: 40000.01, max: null }, { min: 0, max: 40000 })).toBe(false);
  });

  it('un rango encimado se rechaza con 400 y dice con cuál choca', () => {
    expect(() => validarRango(10000, 20000, SEED)).toThrow(BadRequestException);
    expect(() => validarRango(10000, 20000, SEED)).toThrow(/ING_1/);
  });

  it('un rango sin tope choca con el que ya no tiene tope', () => {
    expect(() => validarRango(50000, null, SEED)).toThrow(/ING_3 \(40000\.01 a sin tope\)/);
  });

  it('mínimo negativo, o mínimo mayor o igual al máximo → 400', () => {
    expect(() => validarRango(-1, 100, [])).toThrow('incomeRangeMin no puede ser negativo.');
    expect(() => validarRango(500, 500, [])).toThrow('incomeRangeMin debe ser menor que incomeRangeMax.');
    expect(() => validarRango(600, 500, [])).toThrow(BadRequestException);
  });

  it('un rango libre pasa; al editar no se compara contra sí mismo', () => {
    expect(() => validarRango(0, 15000, SEED.filter((r) => r.code !== 'ING_1'))).not.toThrow();
    expect(() => validarRango(0, 12000, SEED.filter((r) => r.code !== 'ING_1'))).not.toThrow();
  });
});

describe('qué cambia entre una versión y la siguiente (D-35)', () => {
  it('mandar los mismos valores no es un cambio: no hay versión nueva', () => {
    const { cambios } = aplicarCambios(vigente, { name: 'Ingreso bajo', incomeRangeMin: 0, incomeRangeMax: 15000 });
    expect(cambios).toEqual([]);
  });

  it('un cuerpo vacío no cambia nada', () => {
    expect(aplicarCambios(vigente, {}).cambios).toEqual([]);
  });

  it('solo se listan los valores que cambian, con su columna, antes y después', () => {
    const { valores, cambios } = aplicarCambios(vigente, { incomeRangeMax: 16000, source: 'INEGI - ENIGH 2024' });
    expect(valores.incomeRangeMax).toBe('16000.00');
    expect(valores.name).toBe('Ingreso bajo');
    expect(cambios).toEqual([
      { campo: 'ingreso_max', previo: '15000.00', posterior: '16000.00' },
      { campo: 'fuente', previo: 'INEGI - ENIGH 2022', posterior: 'INEGI - ENIGH 2024' },
    ]);
  });

  it('null explícito quita el tope y la descripción; omitirlos los conserva', () => {
    const conDescripcion = { ...vigente, description: 'Nota' };
    expect(aplicarCambios(conDescripcion, {}).valores).toEqual(conDescripcion);
    const { valores, cambios } = aplicarCambios(conDescripcion, { incomeRangeMax: null, description: null });
    expect(valores.incomeRangeMax).toBeNull();
    expect(valores.description).toBeNull();
    expect(cambios.map((c) => c.campo)).toEqual(['ingreso_max', 'descripcion']);
  });

  it('los importes se guardan con 2 decimales, como numeric(12,2)', () => {
    expect(decimal(15000)).toBe('15000.00');
    expect(decimal(0.5)).toBe('0.50');
  });
});
