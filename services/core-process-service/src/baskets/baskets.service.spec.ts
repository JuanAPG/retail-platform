import { BasketsService } from './baskets.service';

function servicio(transaccion: object | null, segmento: number | null) {
  const guardadas: Record<string, unknown>[] = [];
  const basketsRepo = {
    create: jest.fn((f: object) => f),
    save: jest.fn(async (f: object) => {
      const fila = { id: 'k1', ...f };
      guardadas.push(fila);
      return fila;
    }),
    findOne: jest.fn(async () => guardadas[guardadas.length - 1] ?? null),
  };
  const transactionsRepo = { findOne: jest.fn().mockResolvedValue(transaccion) };
  const dataSource = { query: jest.fn().mockResolvedValue([{ segmentId: segmento }]) };
  const svc = new BasketsService(basketsRepo as never, transactionsRepo as never, dataSource as never);
  return { svc, guardadas };
}

const TRANSACCION = {
  id: 't1',
  fecha: new Date('2026-09-01T10:00:00Z'),
  store: { zonaId: 'z1' },
  details: [
    { quantity: '2', subtotal: '85.00', presentation: { producto: { esCanastaBasica: true } } },
    { quantity: '1', subtotal: '28.50', presentation: { producto: { esCanastaBasica: false } } },
  ],
};

describe('BasketsService (M07 portado)', () => {
  it('construye 1 canasta por transacción con zona congelada y clasifica segmento', async () => {
    const { svc } = servicio(TRANSACCION, 2);
    const canasta = await svc.buildFromTransaction('t1');
    expect(canasta).toMatchObject({ transactionId: 't1', zoneId: 'z1', segmentId: 2 });
  });

  it('hereda conteos del detalle (valor, productos, unidades, básicos)', async () => {
    const { svc, guardadas } = servicio(TRANSACCION, null);
    await svc.buildFromTransaction('t1');
    expect(guardadas[0]).toMatchObject({
      totalValue: '113.50',
      productCount: 2,
      unitsTotal: '3.00',
      basicProductsCount: 1,
      segmentId: null,
    });
  });

  it('sin transacción lanza 404', async () => {
    const { svc } = servicio(null, null);
    await expect(svc.buildFromTransaction('x')).rejects.toThrow('No existe la transacción x.');
  });
});
