import { TransactionsService } from './transactions.service';
import { BasketsService } from '../baskets/baskets.service';

const TIENDAS = [{ id: 't1', nombre: 'Super Valle Centro' }];
const PRODUCTOS = [
  {
    id: 'p1',
    sku: 'P-001-001',
    estatus: 'activo',
    presentaciones: [
      { id: 'pr1', nombre: '1 kg' },
      { id: 'pr2', nombre: '500 g' },
    ],
  },
  {
    id: 'p2',
    sku: 'P-002-001',
    estatus: 'pendiente_aprobacion',
    presentaciones: [{ id: 'pr9', nombre: '1 L' }],
  },
];

/** Postgres materializa `subtotal`: el doble hace lo mismo para que `verificarTotal` sea real. */
function sumaSubtotales(detalles: { quantity: string; unitPrice: string }[]): string {
  const centavos = detalles.reduce((suma, d) => {
    const producto = Math.round(Number(d.quantity) * 100) * Math.round(Number(d.unitPrice) * 100);
    return suma + Math.floor((producto + 50) / 100);
  }, 0);
  return (centavos / 100).toFixed(2);
}

interface Opciones {
  /** Filas válidas que `confirmCsvImport` encuentra en staging. */
  filas?: object[];
  /** Importación que devuelve `importacionesRepo.findOne`. */
  importacion?: object | null;
  /** Transacción existente (folio duplicado). */
  transaccionExistente?: object | null;
  /** Hace fallar la construcción de la canasta. */
  canastaFalla?: boolean;
}

function servicio(opciones: Opciones = {}) {
  const insertadas: Record<string, unknown>[] = [];
  const detallesPorTransaccion = new Map<string, { quantity: string; unitPrice: string }[]>();
  const guardados: Record<string, object[]> = { imp: [], filas: [], errores: [] };
  const commits: string[] = [];
  const canastasCreadas: string[] = [];
  let secuencia = 0;

  const transactionsRepo = {
    // Dos usos distintos: chequeo de folio duplicado (por storeId+folio) y
    // relectura de la transacción recién insertada (por id).
    findOne: jest.fn(async (opts: { where?: { id?: string } }) => {
      const id = opts?.where?.id;
      if (id) return insertadas.find((t) => t.id === id) ?? null;
      return opciones.transaccionExistente ?? null;
    }),
    createQueryBuilder: jest.fn(),
  };
  const importacionesRepo = {
    findOne: jest.fn().mockResolvedValue(opciones.importacion ?? null),
    save: jest.fn(async (f: object) => {
      guardados.imp.push(f);
      return { id: 'imp1', ...f };
    }),
  };
  const filasRepo = {
    create: jest.fn((f: object) => f),
    save: jest.fn(async (f: object) => f),
    find: jest.fn().mockResolvedValue(opciones.filas ?? []),
    update: jest.fn(),
  };
  const erroresRepo = {
    create: jest.fn((f: object) => f),
    save: jest.fn(async (f: object) => f),
    find: jest.fn().mockResolvedValue([]),
  };

  // Manager que simula lo justo: ids, detalles y SUM(subtotal).
  const manager = {
    create: jest.fn((_e: unknown, f: object) => ({ ...f })),
    save: jest.fn(async (_entidad: unknown, fila: object | object[]) => {
      if (Array.isArray(fila)) {
        const transactionId = (fila[0] as { transactionId?: string })?.transactionId;
        if (transactionId) {
          detallesPorTransaccion.set(
            transactionId,
            fila as { quantity: string; unitPrice: string }[],
          );
        }
        return fila;
      }
      const guardada = { id: `tx${++secuencia}`, ...fila };
      if ('folio' in guardada) insertadas.push(guardada);
      else guardados.imp.push(guardada);
      return guardada;
    }),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => {
      const qb: Record<string, jest.Mock> = {};
      let transactionId = '';
      qb.select = jest.fn(() => qb);
      qb.where = jest.fn((_sql: string, params: { transactionId: string }) => {
        transactionId = params.transactionId;
        return qb;
      });
      qb.getRawOne = jest.fn(async () => ({
        suma: sumaSubtotales(detallesPorTransaccion.get(transactionId) ?? []),
      }));
      return qb;
    }),
    query: jest.fn(async () => [{ segmentId: 2 }]),
  };

  const dataSource = {
    manager,
    transaction: jest.fn(async (fn: (m: typeof manager) => Promise<unknown>) => {
      const resultado = await fn(manager);
      commits.push('commit');
      return resultado;
    }),
  };

  const catalogos = {
    listarTiendas: jest.fn().mockResolvedValue(TIENDAS),
    listarProductos: jest.fn().mockResolvedValue(PRODUCTOS),
  };
  const auditoria = { reportar: jest.fn().mockResolvedValue(undefined) };
  const baskets = {
    buildFromTransaction: jest.fn(async (id: string) => {
      if (opciones.canastaFalla) throw new Error('canasta: zona de la tienda sin segmento');
      canastasCreadas.push(id);
      return {};
    }),
  } as unknown as BasketsService;

  const svc = new TransactionsService(
    transactionsRepo as never,
    {} as never,
    importacionesRepo as never,
    filasRepo as never,
    erroresRepo as never,
    dataSource as never,
    baskets,
    catalogos as never,
    auditoria as never,
  );

  return {
    svc,
    catalogos,
    auditoria,
    baskets,
    canastasCreadas,
    insertadas,
    commits,
    guardados,
    r: { transactionsRepo, importacionesRepo, filasRepo, erroresRepo },
  };
}

const ENCABEZADO = 'folio,fecha,tienda,sku,presentacion,cantidad,precio';
const archivo = (lineas: string[], extra: Partial<Record<string, unknown>> = {}) => ({
  buffer: Buffer.from([ENCABEZADO, ...lineas].join('\n'), 'utf-8'),
  originalname: 'prueba.csv',
  mimetype: 'text/csv',
  size: 100,
  ...extra,
});
const USUARIO = { id: 'u1', email: 'a@x.mx', rol: 'Analista comercial', rolId: 2 };

const FILA_VALIDA = {
  id: 'f1',
  folioOrigen: 'T-1',
  tiendaOrigen: 'Super Valle Centro',
  storeId: 't1',
  presentationId: 'pr1',
  fecha: new Date('2026-09-01T00:00:00Z'),
  cantidad: '2.00',
  unitPrice: '42.50',
};
const IMPORTACION_VALIDADA = {
  id: 'imp1',
  fileName: 'prueba.csv',
  estado: 'validado',
  totalRows: 1,
  validRows: 1,
  errorRows: 0,
};

// --- Preview ---------------------------------------------------------

describe('TransactionsService — preview CSV', () => {
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

  it('detecta la fecha futura aunque no venga en formato ISO', async () => {
    // Antes se comparaban cadenas: "12/31/2099" > "2026-10-06" era false
    // porque "1" < "2", y la fila pasaba como válida.
    const { svc } = servicio();
    const r = await svc.previewCsvImport(
      archivo(['T1,12/31/2099,Super Valle Centro,P-001-001,1 kg,2,42.5']),
      USUARIO as never,
    );
    expect(r.filasValidas).toBe(0);
    expect(r.errores.map((e) => e.codigo)).toContain('FECHA_FUTURA');
  });

  it('rechaza notaciones que no son decimales planos', async () => {
    const { svc } = servicio();
    const r = await svc.previewCsvImport(
      archivo([
        'T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,1e3,42.5',
        'T2,2026-09-01,Super Valle Centro,P-001-001,1 kg,0x10,42.5',
        // 0.001 pasaba el preview y luego violaba el CHECK al confirmar.
        'T3,2026-09-01,Super Valle Centro,P-001-001,1 kg,0.001,42.5',
      ]),
      USUARIO as never,
    );
    expect(r.filasValidas).toBe(0);
    expect(r.errores.filter((e) => e.codigo === 'CANTIDAD_INVALIDA')).toHaveLength(3);
  });

  it('una celda más larga que la columna de staging es error de SU fila, no un 500', async () => {
    const { svc } = servicio();
    const largo = 'T'.repeat(200);
    const r = await svc.previewCsvImport(
      archivo([
        'T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,2,42.5',
        `T2,2026-09-01,${largo},P-001-001,1 kg,2,42.5`,
      ]),
      USUARIO as never,
    );
    expect(r.filasValidas).toBe(1);
    expect(r.errores.map((e) => e.codigo)).toContain('VALOR_DEMASIADO_LARGO');
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

  it('CSV mixto: 3 válidas, 2 con producto inexistente y 1 con cantidad negativa', async () => {
    const { svc } = servicio();
    const r = await svc.previewCsvImport(
      archivo([
        'T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,2,42.5',
        'T1,2026-09-01,Super Valle Centro,P-001-001,500 g,1,25',
        'T2,2026-09-01,Super Valle Centro,P-001-001,1 kg,3,42.5',
        'T3,2026-09-01,Super Valle Centro,P-FANTASMA,1 kg,1,10',
        'T4,2026-09-01,Super Valle Centro,P-OTRO,1 kg,1,10',
        'T5,2026-09-01,Super Valle Centro,P-001-001,1 kg,-2,42.5',
      ]),
      USUARIO as never,
    );
    expect(r.filasTotales).toBe(6);
    expect(r.filasValidas).toBe(3);
    expect(r.filasConError).toBe(3);
    // T1 agrupa 2 líneas; T2 una: 2 transacciones detectadas.
    expect(r.transaccionesDetectadas).toBe(2);
    expect(r.errores.filter((e) => e.codigo === 'SKU_NO_EXISTE')).toHaveLength(2);
    expect(r.errores.filter((e) => e.codigo === 'CANTIDAD_INVALIDA')).toHaveLength(1);
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

  it('CSV vacío o solo con encabezado da 400 claro, no 500', async () => {
    const { svc } = servicio();
    await expect(svc.previewCsvImport(archivo([]), USUARIO as never)).rejects.toThrow(
      /no trae datos/i,
    );
    await expect(
      svc.previewCsvImport({ ...archivo([]), buffer: Buffer.alloc(0) }, USUARIO as never),
    ).rejects.toThrow(/No se recibió ningún archivo/);
  });

  it('un archivo que no es CSV se rechaza con 415', async () => {
    const { svc } = servicio();
    await expect(
      svc.previewCsvImport(
        archivo(['T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,2,42.5'], {
          originalname: 'virus.exe',
          mimetype: 'application/x-msdownload',
        }) as never,
        USUARIO as never,
      ),
    ).rejects.toThrow(/Solo se admite un archivo .csv/);
  });

  it('archivo repetido da 409 con el id de la importación previa', async () => {
    const { svc } = servicio({
      importacion: { id: 'imp0', estado: 'validado' },
    });
    await expect(
      svc.previewCsvImport(
        archivo(['T1,2026-09-01,Super Valle Centro,P-001-001,1 kg,2,42.5']),
        USUARIO as never,
      ),
    ).rejects.toThrow(/ya se cargó antes \(importación imp0/);
  });

  it('si catalog-service cae, NADA se persiste: ni filas ni la cabecera con el hash', async () => {
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
    // La cabecera tampoco: si quedara, su hash bloquearía el archivo con
    // 409 para siempre, incluso después de que el catálogo vuelva.
    expect(r.importacionesRepo.save).not.toHaveBeenCalled();
  });
});

// --- Confirmación ----------------------------------------------------

describe('TransactionsService — confirmación CSV', () => {
  it('inserta la transacción con su canasta y el resumen cuadra', async () => {
    const { svc, canastasCreadas, insertadas, auditoria } = servicio({
      importacion: { ...IMPORTACION_VALIDADA },
      filas: [FILA_VALIDA],
    });
    const r = await svc.confirmCsvImport('imp1', USUARIO as never, '1.2.3.4');

    expect(r).toMatchObject({
      estado: 'confirmado',
      transaccionesCreadas: 1,
      canastasCreadas: 1,
      lineasInsertadas: 1,
      filasValidas: 1,
      filasConError: 0,
      omitidos: [],
    });
    expect(insertadas).toHaveLength(1);
    expect(insertadas[0]).toMatchObject({ folio: 'T-1', total: '85.00', canal: 'importacion_csv' });
    expect(canastasCreadas).toHaveLength(1);
    expect(auditoria.reportar).toHaveBeenCalledTimes(1);
  });

  it('audita la confirmación con acción `importacion` y los conteos reales', async () => {
    const { svc, auditoria } = servicio({
      importacion: { ...IMPORTACION_VALIDADA },
      filas: [FILA_VALIDA],
    });
    await svc.confirmCsvImport('imp1', USUARIO as never, '1.2.3.4');

    expect(auditoria.reportar).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'importaciones',
        registroId: 'imp1',
        accion: 'importacion',
        usuarioId: 'u1',
        rolId: 2,
        ip: '1.2.3.4',
        cambios: expect.arrayContaining([
          { campo: 'transacciones_creadas', posterior: '1' },
          { campo: 'canastas_creadas', posterior: '1' },
        ]),
      }),
    );
  });

  it('la venta se inserta ANTES de auditar: audit-service nunca la bloquea', async () => {
    const { svc, insertadas, auditoria } = servicio({
      importacion: { ...IMPORTACION_VALIDADA },
      filas: [FILA_VALIDA],
    });
    // Cuando se llama a la auditoría, la transacción ya está insertada.
    auditoria.reportar.mockImplementationOnce(async () => {
      expect(insertadas).toHaveLength(1);
    });
    const r = await svc.confirmCsvImport('imp1', USUARIO as never);
    expect(r.transaccionesCreadas).toBe(1);
    expect(auditoria.reportar).toHaveBeenCalled();
    // Que un fallo del reporte no propague lo garantiza `AuditReporter`
    // (ver audit-reporter.service.spec.ts), no este servicio.
  });

  it('si la canasta falla, la venta NO queda insertada y el folio se reporta omitido', async () => {
    const { svc, canastasCreadas } = servicio({
      importacion: { ...IMPORTACION_VALIDADA },
      filas: [FILA_VALIDA],
      canastaFalla: true,
    });
    const r = await svc.confirmCsvImport('imp1', USUARIO as never);

    expect(r.transaccionesCreadas).toBe(0);
    expect(r.canastasCreadas).toBe(0);
    expect(canastasCreadas).toHaveLength(0);
    expect(r.omitidos).toHaveLength(1);
    // El motivo no filtra el texto crudo del motor de base de datos.
    expect(r.omitidos[0].motivo).toMatch(/^ERROR_INSERCION/);
    expect(r.omitidos[0]).toMatchObject({ folio: 'T-1', tienda: 'Super Valle Centro' });
  });

  it('folio ya existente se omite con su motivo, sin abortar el resto', async () => {
    const { svc } = servicio({
      importacion: { ...IMPORTACION_VALIDADA },
      filas: [FILA_VALIDA],
      transaccionExistente: { id: 'ya', folio: 'T-1' },
    });
    const r = await svc.confirmCsvImport('imp1', USUARIO as never);
    expect(r.transaccionesCreadas).toBe(0);
    expect(r.omitidos[0].motivo).toMatch(/^FOLIO_DUPLICADO/);
  });

  it('agrupa varias líneas del mismo folio en una sola transacción', async () => {
    const { svc, insertadas } = servicio({
      importacion: { ...IMPORTACION_VALIDADA, validRows: 2, totalRows: 2 },
      filas: [
        FILA_VALIDA,
        { ...FILA_VALIDA, id: 'f2', presentationId: 'pr2', cantidad: '1.00', unitPrice: '25.00' },
      ],
    });
    const r = await svc.confirmCsvImport('imp1', USUARIO as never);
    expect(r.transaccionesCreadas).toBe(1);
    expect(r.lineasInsertadas).toBe(2);
    expect(insertadas[0]).toMatchObject({ total: '110.00' });
  });

  it('rechaza re-confirmar, confirmar una descartada, una sin validar o inexistente', async () => {
    const casos: [string, RegExp][] = [
      ['confirmado', /ya fue confirmada/],
      ['descartado', /fue descartada/],
      ['cargado', /aún no está validada/],
    ];
    for (const [estado, mensaje] of casos) {
      const { svc } = servicio({ importacion: { ...IMPORTACION_VALIDADA, estado } });
      await expect(svc.confirmCsvImport('imp1', USUARIO as never)).rejects.toThrow(mensaje);
    }
    const { svc } = servicio({ importacion: null });
    await expect(svc.confirmCsvImport('nope', USUARIO as never)).rejects.toThrow(
      /No existe la importación/,
    );
  });

  it('sin filas válidas no inserta nada y devuelve 400', async () => {
    const { svc } = servicio({ importacion: { ...IMPORTACION_VALIDADA }, filas: [] });
    await expect(svc.confirmCsvImport('imp1', USUARIO as never)).rejects.toThrow(
      /no tiene filas válidas/,
    );
  });
});

// --- Alta manual -----------------------------------------------------

describe('TransactionsService — alta manual', () => {
  const alta = (detalles: object[], extra: object = {}) =>
    ({
      storeId: 't1',
      folio: 'T-1',
      fecha: '2026-09-01',
      details: detalles,
      ...extra,
    }) as never;

  it('total = Σ subtotales, verificado contra la base antes de confirmar', async () => {
    const { svc, insertadas, canastasCreadas } = servicio();
    await svc.createManual(
      alta([
        { presentationId: 'pr1', quantity: 2, unitPrice: 42.5 },
        { presentationId: 'pr2', quantity: 1, unitPrice: 28.5 },
      ]),
      USUARIO as never,
    );
    expect(insertadas[0]).toMatchObject({ total: '113.50', canal: 'punto_venta' });
    expect(canastasCreadas).toHaveLength(1);
  });

  it('replica el redondeo por línea de Postgres (medio centavo)', async () => {
    const { svc, insertadas } = servicio();
    await svc.createManual(
      alta([{ presentationId: 'pr1', quantity: 1.5, unitPrice: 5.01 }]),
      USUARIO as never,
    );
    // Σ subtotal en la base es 7.52; el cálculo viejo guardaba 7.51.
    expect(insertadas[0]).toMatchObject({ total: '7.52' });
  });

  it('construye la canasta DENTRO de la transacción de base de datos', async () => {
    const { svc, baskets } = servicio();
    await svc.createManual(
      alta([{ presentationId: 'pr1', quantity: 1, unitPrice: 10 }]),
      USUARIO as never,
    );
    // Recibe el manager de la transacción, no se construye tras el commit.
    expect(baskets.buildFromTransaction).toHaveBeenCalledWith('tx1', expect.anything());
  });

  it('tienda inexistente da 404 y no inserta', async () => {
    const { svc, insertadas } = servicio();
    await expect(
      svc.createManual(
        alta([{ presentationId: 'pr1', quantity: 1, unitPrice: 10 }], { storeId: 'fantasma' }),
        USUARIO as never,
      ),
    ).rejects.toThrow('No existe la tienda fantasma.');
    expect(insertadas).toHaveLength(0);
  });

  it('presentación inexistente da 400 y no inserta', async () => {
    const { svc, insertadas } = servicio();
    await expect(
      svc.createManual(
        alta([{ presentationId: 'pr-fantasma', quantity: 1, unitPrice: 10 }]),
        USUARIO as never,
      ),
    ).rejects.toThrow('No existe la presentación pr-fantasma.');
    expect(insertadas).toHaveLength(0);
  });

  it('producto inactivo se rechaza, igual que en el CSV', async () => {
    const { svc } = servicio();
    await expect(
      svc.createManual(alta([{ presentationId: 'pr9', quantity: 1, unitPrice: 10 }]), USUARIO as never),
    ).rejects.toThrow(/no está activo \(estatus: pendiente_aprobacion\)/);
  });

  it('la misma presentación dos veces da 400, no una violación de UNIQUE', async () => {
    const { svc, insertadas } = servicio();
    await expect(
      svc.createManual(
        alta([
          { presentationId: 'pr1', quantity: 2, unitPrice: 42.5 },
          { presentationId: 'pr1', quantity: 1, unitPrice: 10 },
        ]),
        USUARIO as never,
      ),
    ).rejects.toThrow(/aparece más de una vez/);
    expect(insertadas).toHaveLength(0);
  });

  it('folio duplicado en la tienda da 409', async () => {
    const { svc } = servicio({ transaccionExistente: { id: 'ya', folio: 'T-1' } });
    await expect(
      svc.createManual(alta([{ presentationId: 'pr1', quantity: 1, unitPrice: 10 }]), USUARIO as never),
    ).rejects.toThrow(/Ya existe la transacción con folio T-1/);
  });

  it('audita el alta con el total guardado', async () => {
    const { svc, auditoria } = servicio();
    await svc.createManual(
      alta([{ presentationId: 'pr1', quantity: 2, unitPrice: 42.5 }]),
      USUARIO as never,
      undefined,
      '9.9.9.9',
    );
    expect(auditoria.reportar).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'transacciones',
        accion: 'insert',
        ip: '9.9.9.9',
        cambios: expect.arrayContaining([{ campo: 'total', posterior: '85.00' }]),
      }),
    );
  });

  it('si catalog-service cae, no se inserta nada', async () => {
    const { svc, insertadas, catalogos } = servicio();
    const { ServiceUnavailableException } = await import('@nestjs/common');
    catalogos.listarTiendas.mockRejectedValueOnce(
      new ServiceUnavailableException('Catálogo no disponible.'),
    );
    await expect(
      svc.createManual(alta([{ presentationId: 'pr1', quantity: 1, unitPrice: 10 }]), USUARIO as never),
    ).rejects.toThrow('Catálogo no disponible.');
    expect(insertadas).toHaveLength(0);
  });
});

// --- Lectura ---------------------------------------------------------

describe('TransactionsService — findAll', () => {
  it('devuelve la envoltura paginada y aplica los filtros con AND', async () => {
    const condiciones: string[] = [];
    const qb: Record<string, jest.Mock> = {};
    for (const metodo of ['leftJoinAndSelect', 'orderBy', 'addOrderBy', 'skip', 'take']) {
      qb[metodo] = jest.fn(() => qb);
    }
    qb.andWhere = jest.fn((sql: string) => {
      condiciones.push(sql);
      return qb;
    });
    qb.getManyAndCount = jest.fn(async () => [[], 0]);

    const svc = new TransactionsService(
      { createQueryBuilder: () => qb } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const r = await svc.findAll({
      storeId: 't1',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
      page: 3,
      limit: 10,
    } as never);

    expect(r).toEqual({ data: [], total: 0, page: 3, limit: 10 });
    expect(condiciones).toEqual([
      't.storeId = :storeId',
      't.fecha >= :dateFrom',
      // Día completo, igual que M07 y M09.
      't.fecha < CAST(:dateTo AS date) + 1',
    ]);
  });
});
