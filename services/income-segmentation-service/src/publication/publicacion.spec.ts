import { evaluarPublicacion, UMBRALES_D36, umbralesDelEntorno } from './publicacion';

const CUALQUIERA = { ...UMBRALES_D36, regla: 'cualquiera' as const };

describe('publicación de agregados zona-segmento (D-36)', () => {
  // Casos de control del contrato (docs/contratos/income-segmentation-service.md).
  it('10 transacciones y 3 tiendas: se publica con cualquiera de las dos lecturas', () => {
    expect(evaluarPublicacion(10, 3)).toEqual({ disponible: true, motivo: null });
    expect(evaluarPublicacion(10, 3, CUALQUIERA)).toEqual({ disponible: true, motivo: null });
  });

  it('9 transacciones y 2 tiendas (caso de D-36): no disponible, con motivo, en las dos lecturas', () => {
    const esperado = {
      disponible: false,
      motivo: 'Menos de 10 transacciones y menos de 3 tiendas en la combinación zona-segmento (D-36).',
    };
    expect(evaluarPublicacion(9, 2)).toEqual(esperado);
    expect(evaluarPublicacion(9, 2, CUALQUIERA)).toEqual(esperado);
  });

  it('sin datos tampoco se publica (nunca un 0)', () => {
    expect(evaluarPublicacion(0, 0).disponible).toBe(false);
  });

  describe('solo se cumple un umbral (P-11 pendiente)', () => {
    it('por defecto (`ambos`) NO publica y dice cuál umbral falta', () => {
      expect(evaluarPublicacion(10, 2)).toEqual({
        disponible: false,
        motivo: 'Menos de 3 tiendas en la combinación zona-segmento (D-36).',
      });
      expect(evaluarPublicacion(9, 3)).toEqual({
        disponible: false,
        motivo: 'Menos de 10 transacciones en la combinación zona-segmento (D-36).',
      });
    });

    it('con `cualquiera` publica', () => {
      expect(evaluarPublicacion(10, 2, CUALQUIERA).disponible).toBe(true);
      expect(evaluarPublicacion(9, 3, CUALQUIERA).disponible).toBe(true);
    });
  });

  it('muchas transacciones de una sola tienda no se publican por defecto: describirían a esa tienda', () => {
    expect(evaluarPublicacion(5000, 1).disponible).toBe(false);
  });
});

describe('umbrales desde el entorno', () => {
  it('sin variables valen los de D-36 y la regla que no publica en la duda', () => {
    expect(umbralesDelEntorno({})).toEqual({ minTransacciones: 10, minTiendas: 3, regla: 'ambos' });
  });

  it('acepta otros umbrales y la regla `cualquiera`', () => {
    expect(
      umbralesDelEntorno({ PUBLICATION_MIN_TRANSACTIONS: '30', PUBLICATION_MIN_STORES: '5', PUBLICATION_RULE: 'cualquiera' }),
    ).toEqual({ minTransacciones: 30, minTiendas: 5, regla: 'cualquiera' });
  });

  it('un valor inválido cae al de D-36 (nunca a 0, que publicaría todo)', () => {
    expect(
      umbralesDelEntorno({ PUBLICATION_MIN_TRANSACTIONS: '0', PUBLICATION_MIN_STORES: 'tres', PUBLICATION_RULE: 'ninguna' }),
    ).toEqual({ minTransacciones: 10, minTiendas: 3, regla: 'ambos' });
  });
});
