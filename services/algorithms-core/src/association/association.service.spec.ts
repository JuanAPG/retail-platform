import { InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { ReporteDeCorridas } from '../common/reportes/reporte-de-corridas.service';
import { AssociationExclusion } from '../entities/association-exclusion.entity';
import { FuenteDatos } from '../fuente-datos/fuente-datos.service';
import { apriori } from './apriori';
import { AssociationService, compararReglas, fotoDe, ReglaParaOrdenar } from './association.service';
import { CorridaAsociacionMongo } from './corrida-asociacion.schema';
import { CorridasAsociacion, NuevaCorrida } from './corridas-asociacion.repository';

const regla = (
  antecedente: string[],
  consecuente: string[],
  m: { confidence: number; lift: number | null; support: number },
): ReglaParaOrdenar => ({
  ...m,
  items: [
    ...antecedente.map((productId) => ({ productId, side: 'antecedente' as const })),
    ...consecuente.map((productId) => ({ productId, side: 'consecuente' as const })),
  ],
});
const firma = (r: ReglaParaOrdenar) =>
  ['antecedente', 'consecuente'].map((lado) => r.items.filter((i) => i.side === lado).map((i) => i.productId).sort().join('+')).join('→');

/** Todas las formas de acomodar una lista (para listas chicas). */
function permutaciones<T>(lista: T[]): T[][] {
  if (lista.length <= 1) return [lista];
  return lista.flatMap((x, i) => permutaciones([...lista.slice(0, i), ...lista.slice(i + 1)]).map((resto) => [x, ...resto]));
}

describe('compararReglas (ALG-06)', () => {
  it('reglas empatadas salen siempre en el mismo orden, sin importar cómo lleguen', () => {
    // Mismas métricas: antes el desempate era el id aleatorio de la regla.
    const m = { confidence: 0.42857, lift: 1.25, support: 0.2449 };
    const reglas = [
      regla(['leche'], ['frijol'], m),
      regla(['frijol'], ['leche'], m),
      regla(['frijol', 'queso'], ['leche'], m),
      regla(['frijol'], ['queso'], m),
    ];

    const ordenes = new Set(permutaciones(reglas).map((p) => [...p].sort(compararReglas).map(firma).join(' | ')));

    expect([...ordenes]).toEqual(['frijol→leche | frijol→queso | frijol+queso→leche | leche→frijol']);
  });

  it('ordena por confianza, luego lift (sin lift al final) y luego soporte, de mayor a menor', () => {
    const reglas = [
      regla(['a'], ['b'], { confidence: 0.5, lift: 1, support: 0.3 }),
      regla(['c'], ['d'], { confidence: 0.5, lift: null, support: 0.9 }),
      regla(['e'], ['f'], { confidence: 0.5, lift: 2, support: 0.1 }),
      regla(['g'], ['h'], { confidence: 0.5, lift: 1, support: 0.4 }),
      regla(['i'], ['j'], { confidence: 0.9, lift: 0.5, support: 0.1 }),
    ];

    expect([...reglas].sort(compararReglas).map(firma)).toEqual(['i→j', 'e→f', 'g→h', 'a→b', 'c→d']);
  });

  it('el antecedente es un conjunto: el orden de sus productos no cambia el resultado', () => {
    const m = { confidence: 0.5, lift: 1, support: 0.2 };
    expect(compararReglas(regla(['queso', 'frijol'], ['leche'], m), regla(['frijol', 'queso'], ['leche'], m))).toBe(0);
  });

  it('da el mismo orden que apriori(), así que leer de la base no lo cambia', () => {
    // Canastas con empates: a y b aparecen igual de seguido, lo mismo c y d.
    const canastas = [['a', 'b'], ['a', 'b'], ['a', 'c'], ['b', 'd'], ['c', 'd'], ['c', 'd'], ['a', 'b', 'c', 'd']];
    const { rules } = apriori(canastas, { minSupport: 0.1, minConfidence: 0.1, maxItemsetSize: 3 });
    const comoGuardadas = rules.map((r) =>
      regla(r.antecedent, r.consequent, { confidence: r.confidence, lift: r.lift, support: r.support }),
    );

    const releidas = [...comoGuardadas].reverse().sort(compararReglas);

    expect(releidas.map(firma)).toEqual(comoGuardadas.map(firma));
  });
});

// ===== Corridas en MongoDB (D3), foto de los datos (D-15) y Mongo caído (D-25).

const FECHA = '2026-10-21T15:00:00.000Z';
const ANALISTA: SesionUsuario = { id: 'u-1', email: 'analista@retail.mx', rol: 'Analista comercial', rolId: 2 };
const LECHE = { id: 'p-leche', sku: 'LEC', nombre: 'Leche', categoriaId: 1 };
const PAN = { id: 'p-pan', sku: 'PAN', nombre: 'Pan', categoriaId: 1 };

/** 3 canastas: leche+pan, leche+pan, leche. Pan → Leche tiene confianza 1; Leche → Pan, 2/3. */
const LINEAS = [
  { basketId: 'k1', productId: LECHE.id, categoryId: 1, day: '2026-08-01' },
  { basketId: 'k1', productId: PAN.id, categoryId: 1, day: '2026-08-01' },
  { basketId: 'k2', productId: PAN.id, categoryId: 1, day: '2026-08-02' },
  { basketId: 'k2', productId: LECHE.id, categoryId: 1, day: '2026-08-02' },
  { basketId: 'k3', productId: LECHE.id, categoryId: 1, day: '2026-08-03' },
];

function crearServicio() {
  const corridas = {
    exigirMongo: jest.fn(),
    guardar: jest.fn(
      async (c: NuevaCorrida): Promise<CorridaAsociacionMongo> => ({ ...c, _id: `run-${c.status}`, type: 'asociacion', date: new Date(FECHA) }),
    ),
    porId: jest.fn(async (_id: string): Promise<CorridaAsociacionMongo | null> => null),
    historial: jest.fn(),
  };
  const exclusiones = { find: jest.fn(async (): Promise<AssociationExclusion[]> => []) };
  const fuente = {
    lineasDeCanasta: jest.fn(async () => LINEAS),
    nombresDeUsuarios: jest.fn(async () => new Map([['u-1', 'Ana Analista']])),
    resumenDeProductos: jest.fn(async () => new Map([LECHE, PAN].map((p) => [p.id, p]))),
  };
  const reporte = { terminada: jest.fn(async () => undefined) };
  const servicio = new AssociationService(
    corridas as unknown as CorridasAsociacion,
    exclusiones as unknown as Repository<AssociationExclusion>,
    fuente as unknown as FuenteDatos,
    reporte as unknown as ReporteDeCorridas,
  );
  return { servicio, corridas, exclusiones, fuente, reporte };
}

describe('AssociationService — corridas en MongoDB (D3)', () => {
  const PARAMS = { minSupport: 0.5, minConfidence: 0.5 };

  it('guarda la corrida completa en Mongo y responde sus reglas en el orden de compararReglas', async () => {
    const { servicio, corridas, reporte } = crearServicio();

    const reglas = await servicio.runFpGrowth(PARAMS, ANALISTA);

    expect(corridas.guardar).toHaveBeenCalledTimes(1);
    const guardada = corridas.guardar.mock.calls[0][0];
    expect(guardada).toMatchObject({
      status: 'completada',
      userId: 'u-1',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-03',
      transactionsConsidered: 3,
      basketsConsidered: 3,
      errorMessage: null,
      snapshot: fotoDe([[LECHE.id, PAN.id], [PAN.id, LECHE.id], [LECHE.id]]),
    });
    expect(guardada.parameters).toEqual(
      expect.arrayContaining([
        { key: 'algoritmo', value: 'fpgrowth' },
        { key: 'soporte_minimo', value: '0.5' },
        { key: 'reglas_generadas', value: '2' },
      ]),
    );
    // Misma precisión que tenían las columnas de Postgres: 5 decimales.
    expect(guardada.results.map((r) => r.confidence).sort()).toEqual([0.66667, 1]);

    expect(reglas.map((r) => [r.runId, r.confidence, r.items.map((i) => i.side + ':' + i.product?.nombre)])).toEqual([
      ['run-completada', 1, ['antecedente:Pan', 'consecuente:Leche']],
      ['run-completada', 0.66667, ['antecedente:Leche', 'consecuente:Pan']],
    ]);
    expect(reglas[0].items[0].ruleId).toBe(reglas[0].id);
    expect(reporte.terminada).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-completada', estado: 'completada', tipo: 'asociacion' }),
      'u-1',
      {},
    );
  });

  it('D-25: sin Mongo responde 503 antes de leer las canastas y no corre nada', async () => {
    const { servicio, corridas, fuente, reporte } = crearServicio();
    corridas.exigirMongo.mockImplementation(() => {
      throw new ServiceUnavailableException('Mongo caído');
    });

    await expect(servicio.runApriori(PARAMS, ANALISTA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fuente.lineasDeCanasta).not.toHaveBeenCalled();
    expect(corridas.guardar).not.toHaveBeenCalled();
    expect(reporte.terminada).not.toHaveBeenCalled();
  });

  it('D-25: si Mongo se cae al guardar, responde 503 y no intenta registrar una fallida', async () => {
    const { servicio, corridas, reporte } = crearServicio();
    corridas.guardar.mockRejectedValue(new ServiceUnavailableException('Mongo caído'));

    await expect(servicio.runApriori(PARAMS, ANALISTA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(corridas.guardar).toHaveBeenCalledTimes(1);
    expect(reporte.terminada).toHaveBeenCalledWith(expect.objectContaining({ runId: null, estado: 'fallida' }), 'u-1', {});
  });

  it('otra falla deja la corrida registrada como fallida en Mongo y responde 500', async () => {
    const { servicio, corridas, exclusiones, reporte } = crearServicio();
    exclusiones.find.mockRejectedValue(new Error('se cayó Postgres'));

    await expect(servicio.runApriori(PARAMS, ANALISTA)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(corridas.guardar).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'fallida', errorMessage: 'se cayó Postgres', results: [], snapshot: null }),
    );
    expect(reporte.terminada).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-fallida', estado: 'fallida' }), 'u-1', {});
  });

  it('findRun arma la forma del contrato: runId en cada parámetro, supuesto y filtro; date ISO; user con nombre', async () => {
    const { servicio, corridas } = crearServicio();
    corridas.porId.mockResolvedValue({
      _id: 'run-9',
      type: 'asociacion',
      status: 'completada',
      userId: 'u-1',
      date: new Date(FECHA),
      periodStart: '2026-08-01',
      periodEnd: '2026-08-03',
      transactionsConsidered: 3,
      basketsConsidered: 3,
      errorMessage: null,
      parameters: [
        { key: 'soporte_minimo', value: '0.5' },
        { key: 'algoritmo', value: 'apriori' },
      ],
      assumptions: ['Primero.', 'Segundo.'],
      filters: [
        { dimension: 'segmento', referenceId: '2' },
        { dimension: 'zona', referenceId: 'z-1' },
      ],
      results: [
        {
          id: 'r-1',
          support: 0.66667,
          confidence: 1,
          lift: 1,
          transactionCount: 2,
          items: [
            { productId: PAN.id, side: 'antecedente' },
            { productId: LECHE.id, side: 'consecuente' },
          ],
        },
      ],
      snapshot: { hash: 'abc', baskets: 3 },
    });

    const corrida = await servicio.findRun('run-9');

    expect(corrida).toMatchObject({
      id: 'run-9',
      type: 'asociacion',
      date: FECHA,
      user: { id: 'u-1', nombre: 'Ana Analista' },
      parameters: [
        { runId: 'run-9', key: 'algoritmo', value: 'apriori' },
        { runId: 'run-9', key: 'soporte_minimo', value: '0.5' },
      ],
      assumptions: [
        { runId: 'run-9', order: 1, assumption: 'Primero.' },
        { runId: 'run-9', order: 2, assumption: 'Segundo.' },
      ],
      filters: [
        // Orden del enum dimension_analisis (tienda, zona, segmento…), como en Postgres.
        { runId: 'run-9', dimension: 'zona', referenceId: 'z-1' },
        { runId: 'run-9', dimension: 'segmento', referenceId: '2' },
      ],
    });
    expect(corrida.results?.[0]).toMatchObject({
      id: 'r-1',
      runId: 'run-9',
      items: [
        { ruleId: 'r-1', product: PAN },
        { ruleId: 'r-1', product: LECHE },
      ],
    });
    // La foto es interna: no está en el contrato ni en su XSD.
    expect(corrida).not.toHaveProperty('snapshot');
    expect(corrida).not.toHaveProperty('_id');
  });

  it('findRun de un id que no existe → 404', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.findRun('no-existe')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('findAllRuns pagina el historial de Mongo con la envoltura estándar', async () => {
    const { servicio, corridas } = crearServicio();
    const consulta = {
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(async () => [[], 41]),
    };
    corridas.historial.mockReturnValue(consulta);

    expect(await servicio.findAllRuns({ page: 3, limit: 20 })).toEqual({ data: [], total: 41, page: 3, limit: 20 });
    expect(consulta.skip).toHaveBeenCalledWith(40);
    expect(consulta.take).toHaveBeenCalledWith(20);
  });
});

describe('fotoDe (D-15)', () => {
  it('mismas canastas en otro orden, o con un producto repetido, dan el mismo hash', () => {
    const a = fotoDe([['x', 'y'], ['z']]);
    const b = fotoDe([['z'], ['y', 'x', 'y']]);

    expect(b).toEqual(a);
    expect(a.baskets).toBe(2);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('datos distintos dan otro hash', () => {
    expect(fotoDe([['x', 'y'], ['z']]).hash).not.toBe(fotoDe([['x'], ['y', 'z']]).hash);
  });
});
