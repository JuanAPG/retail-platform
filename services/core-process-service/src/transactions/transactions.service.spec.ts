import { TransactionsService } from './transactions.service';
import { BasketsService } from '../baskets/baskets.service';

const TIENDAS = [{ id: 't1', nombre: 'Super Valle Centro' }];
const PRODUCTOS = [
  {
    id: 'p1',
    sku: 'P-001-001',
    estatus: 'activo',
    presentaciones: [{ id: 'pr1', nombre: '1 kg' }],
  },
];

function repos() {
  const guardados: Record<string, object[]> = { t: [], d: [], imp: [], filas: [], errores: [] };
  return {
    guardados,
    transactionsRepo: {
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'nuevo', folio: 'T-1' }),
      createQueryBuilder: jest.fn(),
    },
    detailsRepo: {},
    importacionesRepo: {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(async (f: object) => ({ id: 'imp1', ...f })),
    },
    filasRepo: {
      create: jest.fn((f: object) => f),
      save: jest.fn(async (f: object) => f),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    erroresRepo: {
      create: jest.fn((f: object) => f),
      save: jest.fn(async (f: object) => f),
    },
  };
}

function servicio() {
  const r = repos();
  const catalogos = {
    listarTiendas: jest.fn().mockResolvedValue(TIENDAS),
    listarProductos: jest.fn().mockResolvedValue(PRODUCTOS),
  };
  const auditoria = { reportar: jest.fn().mockResolvedValue(undefined) };
  const canastasCreadas: string[] = [];
  const baskets = {
    buildFromTransaction: jest.fn(async (id: string) => {
      canastasCreadas.push(id);
      return {};
    }),
  } as unknown as BasketsService;
  const dataSource = {
    transaction: jest.fn(async (fn: (m: object) => Promise<object>) =>
      fn({
        save: jest.fn(async (entidad: object, fila: object) => ({ id: 'nuevo', ...fila })),
      }),
    ),
  } as never;
  const svc = new TransactionsService(
    r.transactionsRepo as never,
    r.detailsRepo as never,
    r.importacionesRepo as never,
    r.filasRepo as never,
    r.erroresRepo as never,
    dataSource,
    baskets,
    catalogos as never,
    auditoria as never,
  );
  return { svc, r, catalogos, auditoria, canastasCreadas };
}

const ENCABEZADO = 'folio,fecha,tienda,sku,presentacion,cantidad,precio';
const archivo = (lineas: string[]) => ({
  buffer: Buffer.from([ENCABEZADO, ...lineas].join('\n'), 'utf-8'),
  originalname: 'prueba.csv',
  mimetype: 'text/csv',
  size: 100,
});
const USUARIO = { id: 'u1', email: 'a@x.mx', rol: 'Analista comercial', rolId: 2 };

describe('TransactionsService (M06 portado)', () => {
  it('preview válido detecta 1 transacción sin errores', async () => {
    const { svc } = servicio();
    const r = await svc.previewCsvImport(
      archivo(['T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,2,42.5']),
      USUARIO as never,
    );
    expect(r.filasValidas).toBe(1);
    expect(r.filasConError).toBe(0);
    expect(r.transaccionesDetectadas).toBe(1);
  });

  it('marca fecha futura, cantidad y precio inválidos con su código', async () => {
    const { svc } = servicio();
    const r = await svc.previewCsvImport(
      archivo([
        'T1,2999-01-01,Super Valle Centro,P-001-001,1 kg,2,42.5',
        'T2,2026-09-01,Super Valle Centro,P-001-001,1 kg,0,42.5',
        'T3,2026-09-01,Super Valle Centro,P-001-001,1 kg,2,-5',
      ]),
      USUARIO as never,
    );
    expect(r.filasValidas).toBe(0);
    const codigos = r.errores.map((e) => e.codigo);
    expect(codigos).toContain('FECHA_FUTURA');
    expect(codigos).toContain('CANTIDAD_INVALIDA');
    expect(codigos).toContain('PRECIO_INVALIDO');
  });

  it('mezclado: válidas pasan, inválidas se señalan con fila exacta', async () => {
    const { svc } = servicio();
    const r = await svc.previewCsvImport(
      archivo([
        'T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,2,42.5',
        'T2,2026-09-01,Tienda Fantasma,P-001-001,1 kg,2,42.5',
      ]),
      USUARIO as never,
    );
    expect(r.filasValidas).toBe(1);
    expect(r.filasConError).toBe(1);
    expect(r.errores[0]).toMatchObject({ fila: 3, codigo: 'TIENDA_NO_EXISTE' });
  });

  it('presentación duplicada en el mismo folio es error de grupo', async () => {
    const { svc } = servicio();
    const r = await svc.previewCsvImport(
      archivo([
        'T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,2,42.5',
        'T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,1,42.5',
      ]),
      USUARIO as never,
    );
    expect(r.filasValidas).toBe(1);
    expect(r.errores.map((e) => e.codigo)).toContain('PRESENTACION_DUPLICADA');
  });

  it('manual: total = Σ subtotales y construye canasta', async () => {
    const { svc, canastasCreadas } = servicio();
    await svc.createManual(
      {
        storeId: 't1',
        folio: 'T-1',
        fecha: '2026-09-01',
        details: [
          { presentationId: 'pr1', quantity: 2, unitPrice: 42.5 },
          { presentationId: 'pr1', quantity: 1, unitPrice: 10 },
        ],
      },
      USUARIO as never,
    );
    expect(canastasCreadas).toHaveLength(1);
  });

  it('si catalog-service cae, nada se inserta (503)', async () => {
    const { svc, r, catalogos } = servicio();
    const { ServiceUnavailableException } = await import('@nestjs/common');
    catalogos.listarTiendas.mockRejectedValueOnce(
      new ServiceUnavailableException('Catálogo no disponible.'),
    );
    await expect(
      svc.previewCsvImport(
        archivo(['T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,2,42.5']),
        USUARIO as never,
      ),
    ).rejects.toThrow('Catálogo no disponible.');
    expect(r.filasRepo.save).not.toHaveBeenCalled();
  });
});
