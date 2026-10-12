import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { Recommendation } from '../entities/recommendation.entity';
import { RecommendationEvidence } from '../entities/recommendation-evidence.entity';
import { RecommendationsService } from './recommendations.service';
import { RecommendationQueryDto, RejectRecommendationDto } from './dto/recommendation-context.dto';

type Fila = Record<string, unknown>;

/** Filas que devuelve cada regla; la consulta se reconoce por la vista/tabla que lee. */
interface Filas {
  accesibilidad?: Fila[];
  elasticidad?: Fila[];
  simulacion?: Fila[];
  asociacion?: Fila[];
}

const FECHA = new Date('2026-10-01T12:00:00.000Z');

function crearServicio(filas: Filas = {}) {
  // QueryBuilder encadenable de `list`; `getManyAndCount` lo fija cada test.
  const qb = {
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(async (): Promise<[Fila[], number]> => [[], 0]),
  };
  const recommendationRepo = {
    findOne: jest.fn(),
    update: jest.fn(async (): Promise<{ affected?: number }> => ({ affected: 1 })),
    createQueryBuilder: jest.fn(() => qb),
  };
  const evidenceRepo = { find: jest.fn(async (): Promise<Fila[]> => []) };
  let siguienteId = 1;
  const manager = {
    create: jest.fn((_entidad: unknown, x: Fila) => ({ ...x })),
    save: jest.fn(async (x: Fila) => ({ id: `rec-${siguienteId++}`, ...x })),
    insert: jest.fn(async () => undefined),
    query: jest.fn(async (_sql: string, _params?: unknown[]) => []),
  };
  const dataSource = {
    query: jest.fn(async (sql: string, _params?: unknown[]): Promise<Fila[]> => {
      if (sql.includes('v_dashboard_accesibilidad_zona')) return filas.accesibilidad ?? [];
      if (sql.includes('FROM elasticidades e')) return filas.elasticidad ?? [];
      if (sql.includes('FROM escenario_resultados r')) return filas.simulacion ?? [];
      if (sql.includes('v_dashboard_asociaciones')) return filas.asociacion ?? [];
      throw new Error(`Consulta no esperada en el test: ${sql}`);
    }),
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const audit = { reportar: jest.fn(async () => undefined) };
  const servicio = new RecommendationsService(
    recommendationRepo as unknown as Repository<Recommendation>,
    evidenceRepo as unknown as Repository<RecommendationEvidence>,
    dataSource as unknown as DataSource,
    audit as unknown as AuditReporter,
  );
  return { qb, recommendationRepo, evidenceRepo, manager, dataSource, audit, servicio };
}

/** Parámetros con los que se llamó la consulta que contiene `fragmento`. */
function parametrosDe(dataSource: { query: jest.Mock }, fragmento: string): unknown[] {
  const llamada = dataSource.query.mock.calls.find(([sql]: [string]) => sql.includes(fragmento));
  if (!llamada) throw new Error(`No se ejecutó la consulta de ${fragmento}`);
  return llamada[1];
}

function filaElasticidad(valor: string, presentacionId = `pres-${valor}`): Fila {
  return {
    presentacionId,
    producto: 'Arroz',
    presentacion: '1 kg',
    zonaId: 'zona-1',
    zona: 'Centro',
    valor,
    corridaId: 'run-e',
    ejecutadaEn: FECHA,
  };
}

describe('RecommendationsService — regla de accesibilidad', () => {
  it('pasa el umbral 0.4 (y la zona) como parámetros del SQL', async () => {
    const { dataSource, servicio } = crearServicio();

    await servicio.evaluateRules({ zoneId: 'zona-1' });

    expect(parametrosDe(dataSource, 'v_dashboard_accesibilidad_zona')).toEqual([0.4, 'zona-1']);
  });

  it('sin zona, el segundo parámetro va en null', async () => {
    const { dataSource, servicio } = crearServicio();

    await servicio.evaluateRules({});

    expect(parametrosDe(dataSource, 'v_dashboard_accesibilidad_zona')).toEqual([0.4, null]);
  });

  it('con filas arma el borrador con zona, corrida y evidencia de la zona', async () => {
    const { servicio } = crearServicio({
      accesibilidad: [{ zonaId: 'zona-1', zona: 'Centro', indice: '0.3125', corridaId: 'run-a', ejecutadaEn: FECHA }],
    });

    const [borrador, ...resto] = await servicio.evaluateRules({});

    expect(resto).toHaveLength(0);
    expect(borrador).toMatchObject({
      corridaId: 'run-a',
      escenarioId: null,
      zonaId: 'zona-1',
      title: 'Accesibilidad baja en zona Centro',
    });
    expect(borrador.why).toContain('0.3125');
    expect(borrador.why).toContain('umbral de 0.4');
    expect(borrador.evidence).toEqual([
      { dimension: 'zona', referenceId: 'zona-1', description: expect.stringContaining('2026-10-01T12:00:00.000Z') },
    ]);
  });

  it('con 0 filas no genera nada', async () => {
    const { servicio } = crearServicio({ accesibilidad: [] });

    expect(await servicio.evaluateRules({})).toEqual([]);
  });
});

describe('RecommendationsService — regla de elasticidad', () => {
  it('|E| > 2 genera "muy sensible" (también con signo negativo)', async () => {
    const { servicio } = crearServicio({ elasticidad: [filaElasticidad('2.01'), filaElasticidad('-2.5')] });

    const borradores = await servicio.evaluateRules({});

    expect(borradores).toHaveLength(2);
    for (const b of borradores) {
      expect(b.title).toBe('Arroz 1 kg es muy sensible al precio en la zona Centro');
      expect(b.corridaId).toBe('run-e');
      expect(b.evidence[0]).toMatchObject({ dimension: 'producto' });
    }
  });

  it('|E| < 0.3 genera "margen de ajuste" (también con signo negativo)', async () => {
    const { servicio } = crearServicio({ elasticidad: [filaElasticidad('0.29'), filaElasticidad('-0.1')] });

    const borradores = await servicio.evaluateRules({});

    expect(borradores).toHaveLength(2);
    for (const b of borradores) expect(b.title).toBe('Arroz 1 kg tiene margen de ajuste de precio en la zona Centro');
  });

  it('exactamente 2 y exactamente 0.3 (con cualquier signo) no generan nada; tampoco un valor intermedio', async () => {
    const { servicio } = crearServicio({
      elasticidad: ['2', '-2', '0.3', '-0.3', '1'].map((v) => filaElasticidad(v)),
    });

    expect(await servicio.evaluateRules({})).toEqual([]);
  });

  it('en la frontera: 2.01 y 0.29 sí generan, 2 y 0.3 no', async () => {
    const { servicio } = crearServicio({
      elasticidad: ['2', '2.01', '0.3', '0.29'].map((v) => filaElasticidad(v)),
    });

    const borradores = await servicio.evaluateRules({});

    expect(borradores.map((b) => b.evidence[0].referenceId)).toEqual(['pres-2.01', 'pres-0.29']);
    expect(borradores[0].title).toContain('muy sensible');
    expect(borradores[1].title).toContain('margen de ajuste');
  });

  it('una elasticidad nacional dice "a nivel nacional"', async () => {
    const { servicio } = crearServicio({ elasticidad: [{ ...filaElasticidad('3'), zonaId: null, zona: null }] });

    const [borrador] = await servicio.evaluateRules({});

    expect(borrador.title).toBe('Arroz 1 kg es muy sensible al precio a nivel nacional');
    expect(borrador.zonaId).toBeNull();
  });
});

describe('RecommendationsService — regla de simulación', () => {
  const ESCENARIO = {
    escenarioId: 'esc-1',
    escenarioNombre: 'Cambio de precio - Arroz 1 kg',
    valorBase: '2000',
    valorSimulado: '2400',
    variacionPct: '20',
    presentacionId: 'pres-1',
  };

  it('pasa el umbral 15 como parámetro', async () => {
    const { dataSource, servicio } = crearServicio();

    await servicio.evaluateRules({ zoneId: 'zona-1' });

    expect(parametrosDe(dataSource, 'FROM escenario_resultados r')).toEqual([15, 'zona-1']);
  });

  it('con zona, la evidencia es de dimensión zona', async () => {
    const { servicio } = crearServicio({ simulacion: [{ ...ESCENARIO, zonaId: 'zona-1', zona: 'Centro' }] });

    const [borrador] = await servicio.evaluateRules({});

    expect(borrador).toMatchObject({ corridaId: null, escenarioId: 'esc-1', zonaId: 'zona-1' });
    expect(borrador.title).toBe('Escenario "Cambio de precio - Arroz 1 kg" mejora el ingreso estimado en la zona Centro');
    expect(borrador.evidence).toEqual([
      { dimension: 'zona', referenceId: 'zona-1', description: expect.stringContaining('de 2000 a 2400 (20%)') },
    ]);
  });

  it('sin zona, la evidencia es de dimensión producto y apunta a la presentación cambiada', async () => {
    const { servicio } = crearServicio({ simulacion: [{ ...ESCENARIO, zonaId: null, zona: null }] });

    const [borrador] = await servicio.evaluateRules({});

    expect(borrador.evidence).toEqual([
      { dimension: 'producto', referenceId: 'pres-1', description: expect.stringContaining('(20%)') },
    ]);
  });

  it('sin zona ni presentación, la evidencia de producto cae al id del escenario', async () => {
    const { servicio } = crearServicio({ simulacion: [{ ...ESCENARIO, zonaId: null, zona: null, presentacionId: null }] });

    const [borrador] = await servicio.evaluateRules({});

    expect(borrador.evidence[0]).toMatchObject({ dimension: 'producto', referenceId: 'esc-1' });
  });
});

describe('RecommendationsService — regla de asociación', () => {
  it('pasa lift 2 y confianza 0.5 como parámetros, sin zona', async () => {
    const { dataSource, servicio } = crearServicio();

    await servicio.evaluateRules({ zoneId: 'zona-1' });

    expect(parametrosDe(dataSource, 'v_dashboard_asociaciones')).toEqual([2, 0.5]);
  });

  it('arma la venta cruzada con la regla como evidencia', async () => {
    const { servicio } = crearServicio({
      asociacion: [
        { reglaId: 'regla-1', corridaId: 'run-ap', soporte: '0.1', confianza: '0.7', lift: '2.5', antecedente: 'Pan', consecuente: 'Leche' },
      ],
    });

    const [borrador] = await servicio.evaluateRules({});

    expect(borrador).toMatchObject({ corridaId: 'run-ap', zonaId: null, title: 'Oportunidad de venta cruzada: Pan → Leche' });
    expect(borrador.evidence).toEqual([{ dimension: 'producto', referenceId: 'regla-1', description: expect.any(String) }]);
  });
});

describe('RecommendationsService.generate', () => {
  it('con 0 borradores devuelve [] sin abrir transacción ni reportar', async () => {
    const { dataSource, audit, servicio } = crearServicio();

    expect(await servicio.generate({})).toEqual([]);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(audit.reportar).not.toHaveBeenCalled();
  });

  it('con 0 borradores tampoco borra las pendientes que ya había', async () => {
    const { manager, servicio } = crearServicio();

    await servicio.generate({ zoneId: 'zona-1' });

    expect(manager.query).not.toHaveBeenCalled();
  });

  it('guarda cada recomendación con su evidencia y reporta una entrada por recomendación', async () => {
    const { manager, dataSource, audit, servicio } = crearServicio({
      accesibilidad: [{ zonaId: 'zona-1', zona: 'Centro', indice: '0.3', corridaId: 'run-a', ejecutadaEn: FECHA }],
      elasticidad: [filaElasticidad('2.5', 'pres-9')],
    });

    const guardadas = await servicio.generate({}, { token: 'Bearer abc', ip: '10.0.0.5' });

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(guardadas.map((r) => r.id)).toEqual(['rec-1', 'rec-2']);
    expect(manager.create).toHaveBeenCalledWith(
      Recommendation,
      expect.objectContaining({ corridaId: 'run-a', zonaId: 'zona-1', estatus: 'propuesta', titulo: 'Accesibilidad baja en zona Centro' }),
    );
    expect(manager.insert).toHaveBeenCalledTimes(2);
    expect(manager.insert).toHaveBeenCalledWith(RecommendationEvidence, [
      { recomendacionId: 'rec-1', dimension: 'zona', referenciaId: 'zona-1', descripcion: expect.any(String) },
    ]);
    expect(manager.insert).toHaveBeenCalledWith(RecommendationEvidence, [
      { recomendacionId: 'rec-2', dimension: 'producto', referenciaId: 'pres-9', descripcion: expect.any(String) },
    ]);

    expect(audit.reportar).toHaveBeenCalledTimes(2);
    for (const id of ['rec-1', 'rec-2']) {
      expect(audit.reportar).toHaveBeenCalledWith(
        expect.objectContaining({ tabla: 'recomendaciones', registroId: id, accion: 'generar_recomendacion', ip: '10.0.0.5' }),
        'Bearer abc',
      );
    }
    expect(audit.reportar.mock.invocationCallOrder[0]).toBeGreaterThan(dataSource.transaction.mock.invocationCallOrder[0]);
  });
});

describe('RecommendationsService.generate — reemplazo de pendientes', () => {
  const ACCESIBILIDAD = [{ zonaId: 'zona-1', zona: 'Centro', indice: '0.3', corridaId: 'run-a', ejecutadaEn: FECHA }];
  const ASOCIACION = [
    { reglaId: 'regla-1', corridaId: 'run-ap', soporte: '0.1', confianza: '0.7', lift: '2.5', antecedente: 'Pan', consecuente: 'Leche' },
  ];

  it('sin zoneId borra TODAS las propuesta, solo las propuesta, dentro de la transacción y antes de insertar', async () => {
    const { manager, servicio } = crearServicio({ accesibilidad: ACCESIBILIDAD });

    await servicio.generate({});

    expect(manager.query).toHaveBeenCalledTimes(1);
    const [sql, params] = manager.query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM recomendaciones\s+WHERE estatus = 'propuesta'\s*$/);
    expect(sql).not.toMatch(/aceptada|descartada/);
    expect(params).toBeUndefined();
    expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(manager.save.mock.invocationCallOrder[0]);
  });

  it('con zoneId borra las propuesta de esa zona más las sin zona con el título de un borrador nuevo sin zona', async () => {
    const { manager, servicio } = crearServicio({ accesibilidad: ACCESIBILIDAD, asociacion: ASOCIACION });

    await servicio.generate({ zoneId: 'zona-1' });

    expect(manager.query).toHaveBeenCalledTimes(1);
    const [sql, params] = manager.query.mock.calls[0];
    expect(sql).toContain("WHERE estatus = 'propuesta'");
    expect(sql).toContain('zona_id = $1 OR (zona_id IS NULL AND titulo = ANY($2::text[]))');
    expect(sql).not.toMatch(/aceptada|descartada/);
    // Solo el título de la regla de asociación (zonaId null); la de accesibilidad ya cae por zona_id.
    expect(params).toEqual(['zona-1', ['Oportunidad de venta cruzada: Pan → Leche']]);
  });

  it('con zoneId y sin borradores sin zona, la lista de títulos va vacía (solo borra los de la zona)', async () => {
    const { manager, servicio } = crearServicio({ accesibilidad: ACCESIBILIDAD });

    await servicio.generate({ zoneId: 'zona-1' });

    expect(manager.query.mock.calls[0][1]).toEqual(['zona-1', []]);
  });
});

describe('RecommendationsService.list', () => {
  const FILA = {
    id: 'rec-1',
    corridaId: 'run-a',
    escenarioId: null,
    zonaId: 'zona-1',
    titulo: 'Accesibilidad baja en zona Centro',
    queRecomienda: 'Revisar precios',
    porQue: 'Índice 0.3',
    impactoEstimado: 'Sube el índice',
    estatus: 'propuesta',
    generadaEn: FECHA,
  };

  it('sin filtros: no agrega condiciones, ordena por generadaEn desc y usa la paginación por defecto', async () => {
    const { qb, servicio } = crearServicio();
    qb.getManyAndCount.mockResolvedValue([[FILA], 1]);

    const pagina = await servicio.list({});

    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(qb.orderBy).toHaveBeenCalledWith('r.generadaEn', 'DESC');
    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(20);
    expect(pagina).toEqual({
      total: 1,
      page: 1,
      limit: 20,
      data: [
        {
          id: 'rec-1',
          title: 'Accesibilidad baja en zona Centro',
          whatRecommends: 'Revisar precios',
          why: 'Índice 0.3',
          estimatedImpact: 'Sube el índice',
          zoneId: 'zona-1',
          scenarioId: null,
          runId: 'run-a',
          status: 'propuesta',
          generatedAt: FECHA,
        },
      ],
    });
  });

  it('con zona y estatus filtra por ambos y respeta page/limit', async () => {
    const { qb, servicio } = crearServicio();

    const pagina = await servicio.list({ zoneId: 'zona-1', status: 'aceptada', page: 3, limit: 5 });

    expect(qb.andWhere).toHaveBeenCalledWith('r.zonaId = :zoneId', { zoneId: 'zona-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('r.estatus = :status', { status: 'aceptada' });
    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(5);
    expect(pagina).toMatchObject({ data: [], total: 0, page: 3, limit: 5 });
  });

  it('limit mayor a 100 se recorta a 100', async () => {
    const { qb, servicio } = crearServicio();

    await servicio.list({ limit: 500 });

    expect(qb.take).toHaveBeenCalledWith(100);
  });
});

describe('RecommendationsService.approve / reject', () => {
  const GERENTE = { id: 'u-ger', email: 'gerente@retail.mx', rol: 'Gerente de categoría', rolId: 3 };
  const GUARDADA = {
    id: 'rec-1',
    titulo: 'Accesibilidad baja en zona Centro',
    queRecomienda: 'Revisar precios',
    porQue: 'Índice 0.3',
    impactoEstimado: 'Sube el índice',
    generadaEn: FECHA,
  };

  it("approve: UPDATE condicionado a 'propuesta' → 'aceptada', responde con la forma de explain y reporta 'aprobar'", async () => {
    const { recommendationRepo, audit, servicio } = crearServicio();
    recommendationRepo.findOne.mockResolvedValue({ ...GUARDADA, estatus: 'aceptada' });

    const respuesta = await servicio.approve('rec-1', GERENTE, { token: 'Bearer g', ip: '10.0.0.9' });

    expect(recommendationRepo.update).toHaveBeenCalledWith({ id: 'rec-1', estatus: 'propuesta' }, { estatus: 'aceptada' });
    expect(respuesta).toMatchObject({ recommendationId: 'rec-1', status: 'aceptada', evidence: [] });
    expect(audit.reportar).toHaveBeenCalledTimes(1);
    const [evento, token] = audit.reportar.mock.calls[0] as unknown as [Fila, string];
    expect(token).toBe('Bearer g');
    expect(evento).toMatchObject({
      tabla: 'recomendaciones',
      registroId: 'rec-1',
      accion: 'aprobar',
      ip: '10.0.0.9',
      cambios: [{ campo: 'estatus', previo: 'propuesta', posterior: 'aceptada' }],
    });
    expect(evento.descripcion).toContain('gerente@retail.mx');
    expect(evento.descripcion).toContain('u-ger');
  });

  it("reject: 'propuesta' → 'descartada' y la bitácora lleva 'rechazar' con el motivo y el Gerente", async () => {
    const { recommendationRepo, audit, servicio } = crearServicio();
    recommendationRepo.findOne.mockResolvedValue({ ...GUARDADA, estatus: 'descartada' });

    const respuesta = await servicio.reject('rec-1', 'No aplica en temporada escolar.', GERENTE, { token: 'Bearer g' });

    expect(recommendationRepo.update).toHaveBeenCalledWith({ id: 'rec-1', estatus: 'propuesta' }, { estatus: 'descartada' });
    expect(respuesta.status).toBe('descartada');
    const [evento] = audit.reportar.mock.calls[0] as unknown as [Fila];
    expect(evento).toMatchObject({ accion: 'rechazar', registroId: 'rec-1' });
    expect(evento.descripcion).toContain('Motivo: No aplica en temporada escolar.');
    expect(evento.descripcion).toContain('gerente@retail.mx');
  });

  it('id inexistente: 404 y no reporta', async () => {
    const { recommendationRepo, audit, servicio } = crearServicio();
    recommendationRepo.update.mockResolvedValue({ affected: 0 });
    recommendationRepo.findOne.mockResolvedValue(null);

    await expect(servicio.approve('no-existe', GERENTE)).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.reportar).not.toHaveBeenCalled();
  });

  it.each(['aceptada', 'descartada'])("ya en '%s' (o la ganó otra decisión simultánea): 409 y no reporta", async (estatus) => {
    const { recommendationRepo, audit, servicio } = crearServicio();
    recommendationRepo.update.mockResolvedValue({ affected: 0 });
    recommendationRepo.findOne.mockResolvedValue({ ...GUARDADA, estatus });

    const error = await servicio.reject('rec-1', 'Motivo suficientemente largo.', GERENTE).catch((e) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toContain(estatus);
    expect(audit.reportar).not.toHaveBeenCalled();
  });
});

describe('RejectRecommendationDto (class-validator)', () => {
  async function errores(body: unknown): Promise<string[]> {
    const resultado = await validate(plainToInstance(RejectRecommendationDto, body));
    return resultado.flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('sin motivo: inválido', async () => {
    expect(await errores({})).toContain('motivo es obligatorio.');
  });

  it('motivo de menos de 10 caracteres: inválido', async () => {
    expect(await errores({ motivo: 'corto' })).toEqual(['Explica el motivo del rechazo (mínimo 10 caracteres).']);
  });

  it('motivo de más de 500 caracteres: inválido', async () => {
    expect(await errores({ motivo: 'x'.repeat(501) })).toEqual(['motivo no puede pasar de 500 caracteres.']);
  });

  it('motivo de 10 a 500 caracteres: válido', async () => {
    expect(await errores({ motivo: 'x'.repeat(10) })).toEqual([]);
    expect(await errores({ motivo: 'x'.repeat(500) })).toEqual([]);
  });
});

describe('RecommendationQueryDto (class-validator)', () => {
  it('rechaza zoneId que no es UUID y status fuera del enum', async () => {
    const resultado = await validate(plainToInstance(RecommendationQueryDto, { zoneId: 'abc', status: 'pendiente' }));
    expect(resultado.map((e) => e.property).sort()).toEqual(['status', 'zoneId']);
  });

  it('acepta los tres estatus y un UUID', async () => {
    for (const status of ['propuesta', 'aceptada', 'descartada']) {
      const dto = plainToInstance(RecommendationQueryDto, { zoneId: '6f1c2a4e-8b1d-4c3a-9e2f-1a2b3c4d5e6f', status });
      expect(await validate(dto)).toEqual([]);
    }
  });
});

describe('RecommendationsService.explain', () => {
  it('id inexistente: NotFoundException', async () => {
    const { recommendationRepo, evidenceRepo, servicio } = crearServicio();
    recommendationRepo.findOne.mockResolvedValue(null);

    await expect(servicio.explain('no-existe')).rejects.toBeInstanceOf(NotFoundException);
    expect(evidenceRepo.find).not.toHaveBeenCalled();
  });
});
