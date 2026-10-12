import { NotFoundException } from '@nestjs/common';
import { FuenteDatos } from '../fuente-datos/fuente-datos.service';
import { SubstitutionService } from './substitution.service';

const LACTEOS = 2;
const PRODUCTOS = {
  [LACTEOS]: [
    { id: 'leche', name: 'Leche entera' },
    { id: 'queso', name: 'Queso panela' },
  ],
  // Otra categoría: el frijol nunca debe emparejarse con un lácteo.
  1: [{ id: 'frijol', name: 'Frijol negro' }],
};
const canasta = (products: string[], day = '2026-08-10') => ({ store: 't1', day, products });

function servicio(canastas: { store: string; day: string; products: string[] }[], precios: unknown[] = []) {
  const fuente = {
    categoriaExiste: jest.fn(async (id: number) => id in PRODUCTOS),
    productosDeCategoria: jest.fn(async (id: number) => PRODUCTOS[id as keyof typeof PRODUCTOS] ?? []),
    canastasConProductos: jest.fn(async () => canastas),
    historialDePrecios: jest.fn(async () => precios),
  };
  return { service: new SubstitutionService(fuente as unknown as FuenteDatos), fuente };
}

describe('SubstitutionService (fuente simulada)', () => {
  it('QA ALG-03: productos de categorías distintas no se emparejan, y sus canastas no cuentan', async () => {
    // Leche y queso nunca juntos (6 y 6); además hay 8 canastas que solo
    // llevan frijol, que alterna con la leche. Si contaran, el total sería
    // 20 y no 12, y el frijol podría aparecer en un par.
    const { service, fuente } = servicio([
      ...Array.from({ length: 6 }, (_, i) => canasta(['leche'], `2026-08-0${i + 1}`)),
      ...Array.from({ length: 6 }, () => canasta(['queso'])),
      ...Array.from({ length: 8 }, () => canasta(['frijol'])),
    ]);

    const patrones = await service.detectPatterns(LACTEOS);

    expect(fuente.productosDeCategoria).toHaveBeenCalledWith(LACTEOS);
    expect(fuente.canastasConProductos).toHaveBeenCalledWith(['leche', 'queso']);
    expect(patrones).toHaveLength(1);
    expect(patrones[0]).toMatchObject({ originProductId: 'leche', targetProductId: 'queso', observations: 12, lift: 0 });
    const enPares = patrones.flatMap((p) => [p.originProductId, p.targetProductId]);
    expect(enPares).not.toContain('frijol');
  });

  it('el periodo es el de las canastas que compraron la categoría', async () => {
    const { service } = servicio([
      canasta(['leche'], '2026-08-03'),
      canasta(['leche'], '2026-08-20'),
      canasta(['queso'], '2026-08-05'),
      canasta(['queso'], '2026-08-07'),
      canasta(['frijol'], '2026-07-01'),
    ]);

    const [patron] = await service.detectPatterns(LACTEOS);

    expect(patron).toMatchObject({ periodStart: '2026-08-03', periodEnd: '2026-08-20' });
  });

  it('usa el precio vigente de la tienda ese día como evidencia', async () => {
    const { service } = servicio(
      [
        ...Array.from({ length: 3 }, () => canasta(['leche'], '2026-08-05')),
        ...Array.from({ length: 3 }, () => canasta(['queso'], '2026-08-20')),
      ],
      [
        { productId: 'leche', store: 't1', price: 10, from: '2026-08-01', until: '2026-08-14' },
        { productId: 'leche', store: 't1', price: 12, from: '2026-08-15', until: null },
      ],
    );

    const [patron] = await service.detectPatterns(LACTEOS);

    expect(patron).toMatchObject({ type: 'precio', priceVariation: 0.2, originFrequencyChange: -1, targetFrequencyChange: 1 });
  });

  it('categoría inexistente → 404; con menos de 2 productos o sin canastas → []', async () => {
    await expect(servicio([]).service.detectPatterns(99)).rejects.toThrow(NotFoundException);
    expect(await servicio([canasta(['frijol'])]).service.detectPatterns(1)).toEqual([]);
    expect(await servicio([]).service.detectPatterns(LACTEOS)).toEqual([]);
  });
});
