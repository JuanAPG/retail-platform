import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { NotificationsReporter } from '../common/notifications/notifications-reporter.service';
import { Scenario } from '../entities/scenario.entity';
import { ScenarioChange } from '../entities/scenario-change.entity';
import { ScenarioResult } from '../entities/scenario-result.entity';
import { PRESENTACIONES_MINIMAS, SimulationService } from './simulation.service';

type Fila = Record<string, unknown>;

/** Respuesta de cada consulta, reconocida por un fragmento de su SQL. */
type Respuestas = Array<[fragmento: string, filas: Fila[]]>;

const USUARIO = { id: 'u-1', email: 'planeador@retail.mx', rol: 'Planeador', rolId: 5 } as unknown as SesionUsuario;

/** Datos base de simulatePriceChange: precio actual 20, demanda base 100. */
function respuestasPrecio(elasticidad: Fila[]): Respuestas {
  return [
    ['FROM producto_presentaciones pp JOIN productos p', [{ productId: 'prod-1', productName: 'Arroz', presentationName: '1 kg' }]],
    ['COALESCE(AVG(p.precio), 0) AS "precio"', [{ precio: '20' }]],
    ['COALESCE(SUM(d.cantidad), 0)', [{ cantidad: 100 }]],
    ['FROM elasticidades e', elasticidad],
    ['zona_clasificaciones', []],
    ['SELECT id FROM indicadores', [{ id: 1 }]],
  ];
}

/** Presentación tal como la devuelve el SELECT de producto_presentaciones + unidades_medida. */
function presentacion(id: string, contenido: number, tipoUnidad: string, factorBase: number, predeterminada = false): Fila {
  return { id, nombre: id, activo: true, predeterminada, contenido: String(contenido), tipoUnidad, factorBase: String(factorBase) };
}

function respuestasPresentacion(presentaciones: Fila[], precios: Fila[], demandas: Fila[]): Respuestas {
  return [
    ['SELECT nombre FROM productos WHERE id', [{ nombre: 'Arroz' }]],
    ['JOIN unidades_medida', presentaciones],
    ['p.presentacion_id = ANY', precios],
    ['d.presentacion_id = ANY', demandas],
    ['SELECT id FROM indicadores', [{ id: 1 }]],
  ];
}

function crearServicio(respuestas: Respuestas) {
  const manager = {
    create: jest.fn((_entidad: unknown, x: Fila) => ({ ...x })),
    save: jest.fn(async (x: Fila) => x),
    insert: jest.fn(async () => undefined),
  };
  const dataSource = {
    query: jest.fn(async (sql: string): Promise<Fila[]> => {
      const respuesta = respuestas.find(([fragmento]) => sql.includes(fragmento));
      if (!respuesta) throw new Error(`Consulta no esperada en el test: ${sql}`);
      return respuesta[1];
    }),
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const audit = { reportar: jest.fn(async () => undefined) };
  const avisos = { notificar: jest.fn(async (_aviso: Fila, _ctx?: { token?: string }): Promise<void> => undefined) };
  const servicio = new SimulationService(
    {} as Repository<Scenario>,
    {} as Repository<ScenarioChange>,
    {} as Repository<ScenarioResult>,
    dataSource as unknown as DataSource,
    audit as unknown as AuditReporter,
    avisos as unknown as NotificationsReporter,
  );
  return { manager, dataSource, audit, avisos, servicio };
}

function nombreDuplicado(): QueryFailedError {
  return new QueryFailedError('INSERT INTO escenarios', [], Object.assign(new Error('duplicate key'), { code: '23505' }));
}

const DTO_PRECIO = { presentationId: 'pres-1', zoneId: 'zona-1', newPrice: 22 };

describe('SimulationService.simulatePriceChange', () => {
  it('elasticidad negativa: al subir el precio 10% la demanda baja', async () => {
    const { servicio } = crearServicio(respuestasPrecio([{ valor: '-1.5', corridaId: 'run-1', esNacional: false }]));

    const resultado = await servicio.simulatePriceChange(DTO_PRECIO, USUARIO);

    // A mano: 22/20 = 1.1; 1.1^1.5 = 1.1 × √1.1 = 1.1 × 1.048809 = 1.153690;
    // demanda = 100 / 1.153690 = 86.678; ingreso = 86.678 × 22 = 1906.92 (base 100 × 20 = 2000).
    const [demanda, ingreso] = resultado.results;
    expect(demanda.indicatorKey).toBe('demanda_estimada');
    expect(demanda.baseValue).toBe(100);
    expect(demanda.simulatedValue).toBeCloseTo(86.678, 2);
    expect(demanda.variationPct).toBeCloseTo(-13.32, 1);
    expect(ingreso.indicatorKey).toBe('ingreso_estimado');
    expect(ingreso.baseValue).toBe(2000);
    expect(ingreso.simulatedValue).toBeCloseTo(1906.92, 1);
    expect(resultado.inputs).toMatchObject({ currentPrice: 20, newPrice: 22, baseDemand: 100, elasticity: -1.5, elasticityRunId: 'run-1' });
  });

  it('elasticidad positiva: se respeta el signo y la demanda sube con el precio', async () => {
    const { servicio } = crearServicio(respuestasPrecio([{ valor: '0.5', corridaId: 'run-2', esNacional: true }]));

    const resultado = await servicio.simulatePriceChange(DTO_PRECIO, USUARIO);

    // A mano: 1.1^0.5 = √1.1 = 1.048809; demanda = 100 × 1.048809 = 104.881;
    // ingreso = 104.881 × 22 = 2307.38.
    const [demanda, ingreso] = resultado.results;
    expect(demanda.simulatedValue).toBeCloseTo(104.881, 2);
    expect(demanda.simulatedValue).toBeGreaterThan(demanda.baseValue);
    expect(demanda.variationPct).toBeCloseTo(4.88, 1);
    expect(ingreso.simulatedValue).toBeCloseTo(2307.38, 1);
    expect(resultado.assumptions?.[0]).toContain('agregado nacional');
  });

  it('D-01, caso de control: demanda 1,000, precio 25 → 27.5 y E = −2 dan 826 unidades e ingreso −9.1 %', async () => {
    // Los mismos mocks de respuestasPrecio, con el precio vigente (25) y la
    // demanda base (1000) del caso de control por delante: gana el primer fragmento que coincide.
    const { servicio } = crearServicio([
      ['COALESCE(AVG(p.precio), 0) AS "precio"', [{ precio: '25' }]],
      ['COALESCE(SUM(d.cantidad), 0)', [{ cantidad: 1000 }]],
      ...respuestasPrecio([{ valor: '-2', corridaId: 'run-d01', esNacional: false }]),
    ]);

    const resultado = await servicio.simulatePriceChange({ ...DTO_PRECIO, newPrice: 27.5 }, USUARIO);

    // A mano (elasticidad constante): 27.5/25 = 1.1; 1.1^-2 = 1/1.21 = 0.826446;
    // demanda = 1000 × 0.826446 = 826.446 → 826 unidades;
    // ingreso = 826.446 × 27.5 = 22727.27 contra 1000 × 25 = 25000 → −9.0909 % ≈ −9.1 %.
    const [demanda, ingreso] = resultado.results;
    expect(resultado.inputs).toMatchObject({ currentPrice: 25, newPrice: 27.5, baseDemand: 1000, elasticity: -2 });
    expect(demanda.indicatorKey).toBe('demanda_estimada');
    expect(demanda.baseValue).toBe(1000);
    expect(demanda.simulatedValue).toBeCloseTo(826.446, 3);
    expect(Math.round(demanda.simulatedValue)).toBe(826);
    expect(ingreso.indicatorKey).toBe('ingreso_estimado');
    expect(ingreso.baseValue).toBe(25000);
    expect(ingreso.simulatedValue).toBeCloseTo(22727.27, 2);
    // El servicio redondea la variación a 4 decimales.
    expect(ingreso.variationPct).toBe(-9.0909);
    expect(ingreso.variationPct).toBeCloseTo(-9.1, 1);

    // D-01: la simulación usa elasticidad constante, NO la aproximación lineal
    // (−2 × 10 % = −20 % → 800 unidades, ingreso 22,000 = −12 %). Ese resultado es INCORRECTO.
    expect(Math.round(demanda.simulatedValue)).not.toBe(800);
    expect(ingreso.simulatedValue).not.toBeCloseTo(22000, 0);
    expect(ingreso.variationPct).not.toBeCloseTo(-12, 0);
  });

  it('sin elasticidad calculada: NotFoundException con mensaje claro y no guarda nada', async () => {
    const { dataSource, audit, avisos, servicio } = crearServicio(respuestasPrecio([]));

    const error = await servicio.simulatePriceChange(DTO_PRECIO, USUARIO).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toContain('No hay elasticidad calculada para esta presentación');
    expect(error.message).toContain('POST /elasticity/calculate');
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(audit.reportar).not.toHaveBeenCalled();
    expect(avisos.notificar).not.toHaveBeenCalled();
  });

  it('D-12: después de guardar avisa escenario.generado a quien simuló, con su token', async () => {
    const { manager, dataSource, avisos, servicio } = crearServicio(
      respuestasPrecio([{ valor: '-1.5', corridaId: 'run-1', esNacional: false }]),
    );

    const resultado = await servicio.simulatePriceChange(DTO_PRECIO, USUARIO, { token: 'Bearer abc', ip: '10.0.0.5' });

    const guardado = manager.save.mock.calls[0][0];
    expect(avisos.notificar).toHaveBeenCalledTimes(1);
    expect(avisos.notificar).toHaveBeenCalledWith(
      {
        evento: 'escenario.generado',
        recipientUserId: 'u-1',
        payload: {
          relatedEntityId: resultado.scenarioId,
          title: 'Nuevo escenario',
          message: `Se guardó el escenario "${guardado.nombre}".`,
        },
      },
      { token: 'Bearer abc' },
    );
    expect(avisos.notificar.mock.invocationCallOrder[0]).toBeGreaterThan(dataSource.transaction.mock.invocationCallOrder[0]);
  });

  it('un fallo del aviso no cambia la respuesta de la simulación', async () => {
    const { avisos, servicio } = crearServicio(respuestasPrecio([{ valor: '-1.5', corridaId: 'run-1', esNacional: false }]));
    avisos.notificar.mockRejectedValue(new Error('notifications caído'));

    const resultado = await servicio.simulatePriceChange(DTO_PRECIO, USUARIO, { token: 'Bearer abc' });

    expect(resultado.scenarioId).toBeDefined();
    expect(resultado.results).toHaveLength(2);
  });

  it('después de guardar reporta a la bitácora con simular y el id del escenario', async () => {
    const { manager, dataSource, audit, servicio } = crearServicio(
      respuestasPrecio([{ valor: '-1.5', corridaId: 'run-1', esNacional: false }]),
    );

    const resultado = await servicio.simulatePriceChange(DTO_PRECIO, USUARIO, { token: 'Bearer abc', ip: '10.0.0.5' });

    const guardado = manager.save.mock.calls[0][0];
    expect(resultado.scenarioId).toBe(guardado.id);
    expect(audit.reportar).toHaveBeenCalledTimes(1);
    expect(audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'escenarios', registroId: guardado.id, accion: 'simular', ip: '10.0.0.5' }),
      'Bearer abc',
    );
    expect(audit.reportar.mock.invocationCallOrder[0]).toBeGreaterThan(dataSource.transaction.mock.invocationCallOrder[0]);
  });
});

describe('SimulationService.simulatePresentationChange', () => {
  it('una presentación sin precio vigente se excluye con warning y nunca entra como 0', async () => {
    const { servicio } = crearServicio(
      respuestasPresentacion(
        [
          presentacion('p-250', 250, 'masa', 0.001),
          presentacion('p-500', 500, 'masa', 0.001, true),
          presentacion('p-1k', 1000, 'masa', 0.001),
          presentacion('p-2k', 2000, 'masa', 0.001),
        ],
        // D-14 pide al menos 3 con precio: p-2k ($130 → $65/kg) completa el mínimo sin ser la más barata.
        [
          { presentationId: 'p-250', precio: 15 },
          { presentationId: 'p-500', precio: 25 },
          { presentationId: 'p-2k', precio: 130 },
        ],
        [
          { presentationId: 'p-250', cantidad: 40 },
          { presentationId: 'p-500', cantidad: 60 },
          { presentationId: 'p-1k', cantidad: 90 },
          { presentationId: 'p-2k', cantidad: 30 },
        ],
      ),
    );

    const resultado = await servicio.simulatePresentationChange({ productId: 'PROD-1' }, USUARIO);

    const sinPrecio = resultado.presentations.find((p) => p.presentationId === 'p-1k');
    expect(sinPrecio).toMatchObject({
      priceStatus: 'sin_precio_vigente',
      outlay: null,
      unitPrice: null,
      estimatedDemand: null,
      accessibilityEffect: null,
    });
    expect(resultado.warnings.some((w) => w.includes('p-1k') && w.includes('se excluyó de los cálculos'))).toBe(true);

    // Referencia = la predeterminada (p-500, $25 → $50/kg); comparada = p-250 ($15 → $60/kg).
    expect(resultado.referencePresentationId).toBe('p-500');
    expect(resultado.comparedPresentationId).toBe('p-250');
    const desembolso = resultado.results.find((r) => r.indicatorKey === 'desembolso');
    expect(desembolso).toMatchObject({ baseValue: 25, simulatedValue: 15 });
    const unitario = resultado.results.find((r) => r.indicatorKey === 'precio_unitario');
    expect(unitario).toMatchObject({ baseValue: 50, simulatedValue: 60 });
    // Ningún resultado usa el precio de la presentación excluida ni un 0 en su lugar.
    for (const r of resultado.results) {
      expect(r.baseValue).not.toBe(0);
      expect(r.simulatedValue).not.toBe(0);
    }
    expect(resultado.presentations.find((p) => p.presentationId === 'p-250')?.accessibilityEffect?.unitPricePremiumPct).toBe(20);
  });

  it('una presentación que no pertenece al producto da 400', async () => {
    const { dataSource, servicio } = crearServicio(
      respuestasPresentacion(
        [presentacion('p-250', 250, 'masa', 0.001), presentacion('p-500', 500, 'masa', 0.001)],
        [],
        [],
      ),
    );

    const error = await servicio
      .simulatePresentationChange({ productId: 'prod-1', presentationIds: ['p-250', 'p-de-otro'] }, USUARIO)
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain('p-de-otro');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('mezclar tipos de unidad devuelve el aviso de que el precio unitario no es comparable', async () => {
    const { servicio } = crearServicio(
      respuestasPresentacion(
        [presentacion('p-500', 500, 'masa', 0.001, true), presentacion('p-1k', 1000, 'masa', 0.001), presentacion('p-pza', 1, 'pieza', 1)],
        [
          { presentationId: 'p-500', precio: 25 },
          { presentationId: 'p-1k', precio: 45 },
          { presentationId: 'p-pza', precio: 10 },
        ],
        [],
      ),
    );

    const resultado = await servicio.simulatePresentationChange({ productId: 'prod-1' }, USUARIO);

    expect(resultado.warnings.some((w) => w.includes('tipos de unidad distintos') && w.includes('masa') && w.includes('pieza'))).toBe(
      true,
    );
    // La comparada se busca primero entre las del mismo tipo que la referencia.
    expect(resultado.comparedPresentationId).toBe('p-1k');
  });

  it('después de guardar reporta a la bitácora con simular', async () => {
    const { audit, servicio } = crearServicio(
      respuestasPresentacion(
        [
          presentacion('p-250', 250, 'masa', 0.001),
          presentacion('p-500', 500, 'masa', 0.001, true),
          presentacion('p-1k', 1000, 'masa', 0.001),
        ],
        [
          { presentationId: 'p-250', precio: 15 },
          { presentationId: 'p-500', precio: 25 },
          { presentationId: 'p-1k', precio: 45 },
        ],
        [],
      ),
    );

    const resultado = await servicio.simulatePresentationChange({ productId: 'prod-1' }, USUARIO, { token: 'Bearer abc' });

    expect(audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'escenarios', registroId: resultado.scenarioId, accion: 'simular' }),
      'Bearer abc',
    );
  });

  it('D-12: la comparación de presentaciones también avisa escenario.generado a quien simuló', async () => {
    const { avisos, servicio } = crearServicio(
      respuestasPresentacion(
        [
          presentacion('p-250', 250, 'masa', 0.001),
          presentacion('p-500', 500, 'masa', 0.001, true),
          presentacion('p-1k', 1000, 'masa', 0.001),
        ],
        [
          { presentationId: 'p-250', precio: 15 },
          { presentationId: 'p-500', precio: 25 },
          { presentationId: 'p-1k', precio: 45 },
        ],
        [],
      ),
    );

    const resultado = await servicio.simulatePresentationChange({ productId: 'prod-1' }, USUARIO, { token: 'Bearer abc' });

    expect(avisos.notificar).toHaveBeenCalledTimes(1);
    expect(avisos.notificar).toHaveBeenCalledWith(
      expect.objectContaining({
        evento: 'escenario.generado',
        recipientUserId: 'u-1',
        payload: expect.objectContaining({ relatedEntityId: resultado.scenarioId }),
      }),
      { token: 'Bearer abc' },
    );
  });

  it('D-14, límite del mínimo: 2 presentaciones con precio dan error y 3 con precio pasan', async () => {
    const TRES = [
      presentacion('p-250', 250, 'masa', 0.001),
      presentacion('p-500', 500, 'masa', 0.001, true),
      presentacion('p-1k', 1000, 'masa', 0.001),
    ];
    const DOS_PRECIOS = [
      { presentationId: 'p-250', precio: 15 },
      { presentationId: 'p-500', precio: 25 },
    ];

    const conDos = crearServicio(respuestasPresentacion(TRES, DOS_PRECIOS, []));
    const error = await conDos.servicio.simulatePresentationChange({ productId: 'prod-1' }, USUARIO).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toContain('Solo 2 de las 3 presentaciones');
    expect(error.message).toContain(`al menos ${PRESENTACIONES_MINIMAS} con precio`);
    expect(conDos.dataSource.transaction).not.toHaveBeenCalled();
    expect(conDos.audit.reportar).not.toHaveBeenCalled();
    expect(conDos.avisos.notificar).not.toHaveBeenCalled();

    const conTres = crearServicio(
      respuestasPresentacion(TRES, [...DOS_PRECIOS, { presentationId: 'p-1k', precio: 45 }], []),
    );
    const resultado = await conTres.servicio.simulatePresentationChange({ productId: 'prod-1' }, USUARIO);

    expect(resultado.presentations.filter((p) => p.priceStatus === 'con_precio')).toHaveLength(3);
    expect(resultado.warnings).toEqual([]);
    expect(conTres.dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('D-14: un producto con solo 2 presentaciones activas da 400 antes de consultar precios', async () => {
    const { dataSource, servicio } = crearServicio(
      respuestasPresentacion(
        [presentacion('p-250', 250, 'masa', 0.001), presentacion('p-500', 500, 'masa', 0.001, true)],
        [],
        [],
      ),
    );

    const error = await servicio.simulatePresentationChange({ productId: 'prod-1' }, USUARIO).catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain(`al menos ${PRESENTACIONES_MINIMAS} para comparar`);
    expect(dataSource.query.mock.calls.some(([sql]) => sql.includes('p.presentacion_id = ANY'))).toBe(false);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});

describe('SimulationService.saveScenario (vía simulatePriceChange)', () => {
  const ELASTICIDAD = [{ valor: '-1.5', corridaId: 'run-1', esNacional: false }];

  it('nombre duplicado (23505) en los 3 intentos: reintenta y termina en 409, nunca 500', async () => {
    const { dataSource, audit, avisos, servicio } = crearServicio(respuestasPrecio(ELASTICIDAD));
    dataSource.transaction.mockRejectedValue(nombreDuplicado());

    await expect(servicio.simulatePriceChange(DTO_PRECIO, USUARIO)).rejects.toBeInstanceOf(ConflictException);
    expect(dataSource.transaction).toHaveBeenCalledTimes(3);
    expect(audit.reportar).not.toHaveBeenCalled();
    expect(avisos.notificar).not.toHaveBeenCalled();
  });

  it('si el reintento funciona, guarda con un id nuevo y no lanza', async () => {
    const { manager, dataSource, servicio } = crearServicio(respuestasPrecio(ELASTICIDAD));
    const ids: string[] = [];
    const original = dataSource.transaction.getMockImplementation()!;
    dataSource.transaction.mockImplementation(async (fn) => {
      // Primer intento: registra el id que se iba a usar y choca; el segundo usa la implementación normal.
      if (ids.length === 0) {
        await fn({ ...manager, save: jest.fn(async (x: Fila) => { ids.push(x.id as string); throw nombreDuplicado(); }) });
      }
      return original(fn);
    });

    const resultado = await servicio.simulatePriceChange(DTO_PRECIO, USUARIO);

    expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    expect(resultado.scenarioId).toBeDefined();
    expect(resultado.scenarioId).not.toBe(ids[0]);
  });

  it('un error que no es de nombre duplicado no se reintenta', async () => {
    const { dataSource, servicio } = crearServicio(respuestasPrecio(ELASTICIDAD));
    dataSource.transaction.mockRejectedValue(
      new QueryFailedError('INSERT', [], Object.assign(new Error('fk'), { code: '23503' })),
    );

    await expect(servicio.simulatePriceChange(DTO_PRECIO, USUARIO)).rejects.toBeInstanceOf(QueryFailedError);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });
});
