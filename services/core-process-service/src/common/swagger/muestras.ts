/**
 * Muestras reales para los ejemplos Swagger de M06/M07/M09. Números
 * coherentes con el seed + CSV de 100 canastas (ticket ~100 MXN).
 */
export const muestras = {
  ticketPromedio: 128.4,
  productosPorCanasta: 2.1,
  frecuenciaCompra: 53.0,
  unidadesPorTransaccion: 4.2,
  gastoPorCategoria: [
    {
      categoryId: 2,
      categoryName: 'Lácteos',
      totalSpend: 1520.5,
      units: 42,
      basketCount: 18,
      share: 23.75,
    },
  ],
  transaccion: {
    id: '11111111-1111-4111-8111-111111111111',
    folio: 'T-V-001',
    storeId: '22222222-2222-4222-8222-222222222222',
    fecha: '2026-09-02T10:15:00.000Z',
    total: '142.50',
  },
  previewCsv: {
    importacionId: '33333333-3333-4333-8333-333333333333',
    fileName: 'datos_prueba_100_canastas.csv',
    estado: 'validado',
    filasTotales: 154,
    filasValidas: 154,
    filasConError: 0,
    transaccionesDetectadas: 100,
  },
  confirmCsv: {
    importacionId: '33333333-3333-4333-8333-333333333333',
    estado: 'confirmado',
    transaccionesCreadas: 100,
    canastasCreadas: 100,
    omitidos: [],
  },
  canasta: {
    id: '44444444-4444-4444-8444-444444444444',
    transaccionId: '11111111-1111-4111-8111-111111111111',
    valor_total: '142.50',
  },
};
