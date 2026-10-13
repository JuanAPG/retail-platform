import { NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { AccessibilityComponentEntity } from '../entities/accessibility-component.entity';
import { AccessibilityWeightEntity } from '../entities/accessibility-weight.entity';
import { AccessibilityZoneEntity } from '../entities/accessibility-zone.entity';
import { IncomeSegment } from '../entities/income-segment.entity';
import { AccessibilityService } from './accessibility.service';

/** Lo que devuelve cada consulta de `calculateIndex`; `disponibilidad: null` = la vista no tiene fila. */
interface Datos {
  zonaExiste: boolean;
  costoZona: number;
  costoTodas: number;
  maxIngreso: number | null;
  disponibilidad: number | null;
  maxDisponibilidad: number | null;
  totalBasicos: number;
  basicosDisponibles: number;
}

const CON_DATOS: Datos = {
  zonaExiste: true,
  costoZona: 120,
  costoTodas: 200,
  maxIngreso: 30000,
  disponibilidad: 8,
  maxDisponibilidad: 10,
  totalBasicos: 10,
  basicosDisponibles: 6,
};

const SEGMENTO = { id: 2, incomeRangeMin: '10000', incomeRangeMax: '20000' };

function crearServicio(datos: Datos = CON_DATOS) {
  const zonaRepo = {
    create: jest.fn((x) => ({ ...x })),
    save: jest.fn(async (x) => ({ id: 'acc-1', ...x })),
  };
  const pesosRepo = { create: jest.fn((x) => ({ ...x })), save: jest.fn(async (x) => x) };
  const componentesRepo = { create: jest.fn((x) => ({ ...x })), save: jest.fn(async (x) => x) };
  const segmentosRepo = { findOne: jest.fn(async (): Promise<unknown> => SEGMENTO) };
  const manager = {
    withRepository: jest.fn((repo) => repo),
    query: jest.fn(async (sql: string) => (sql.includes('RETURNING id') ? [{ id: 'corrida-1' }] : [])),
  };
  // Cada consulta se reconoce por un fragmento de su SQL: las del cálculo
  // corren en paralelo (Promise.all), así que el orden de llamada no sirve.
  const dataSource = {
    query: jest.fn(async (sql: string): Promise<unknown[]> => {
      if (sql.includes('FROM zonas WHERE id')) return datos.zonaExiste ? [{ '?column?': 1 }] : [];
      if (sql.includes('t.zona_id = $1 AND p.vigente')) return [{ costo: String(datos.costoZona) }];
      if (sql.includes('WHERE prod.es_canasta_basica = true AND p.vigente')) return [{ costo: String(datos.costoTodas) }];
      if (sql.includes('"maxIngreso"')) return [{ maxIngreso: datos.maxIngreso }];
      if (sql.includes('v_zona_indicadores')) return datos.disponibilidad === null ? [] : [{ valor: datos.disponibilidad }];
      if (sql.includes('"maxDisponibilidad"')) return [{ maxDisponibilidad: datos.maxDisponibilidad }];
      if (sql.includes('AS total')) return [{ total: String(datos.totalBasicos) }];
      if (sql.includes('AS disponibles')) return [{ disponibles: String(datos.basicosDisponibles) }];
      throw new Error(`Consulta no esperada en el test: ${sql}`);
    }),
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const audit = { reportar: jest.fn(async () => undefined) };
  const servicio = new AccessibilityService(
    zonaRepo as unknown as Repository<AccessibilityZoneEntity>,
    pesosRepo as unknown as Repository<AccessibilityWeightEntity>,
    componentesRepo as unknown as Repository<AccessibilityComponentEntity>,
    segmentosRepo as unknown as Repository<IncomeSegment>,
    dataSource as unknown as DataSource,
    audit as unknown as AuditReporter,
  );
  return { zonaRepo, pesosRepo, componentesRepo, segmentosRepo, manager, dataSource, audit, servicio };
}

/** Valor guardado de cada componente, tal como llega a `accesibilidad_componentes`. */
function componentesGuardados(componentesRepo: { create: jest.Mock }): Record<string, string> {
  return Object.fromEntries(
    componentesRepo.create.mock.calls.map(([c]: [{ componente: string; valor: string }]) => [c.componente, c.valor]),
  );
}

describe('AccessibilityService.calculateIndex', () => {
  it('zona sin ningún precio vigente de canasta básica: el componente de precio vale 0, no 1', async () => {
    // Regresión: antes `1 - 0 / promedio` daba 1 (la mejor nota) a una zona sin precios.
    const { componentesRepo, servicio } = crearServicio({ ...CON_DATOS, costoZona: 0 });

    const resultado = await servicio.calculateIndex('zona-1', 2);

    const valores = componentesGuardados(componentesRepo);
    expect(valores.precio).toBe('0.0000');
    expect(resultado.basicBasketCost).toBe(0);
    // Solo suman los otros tres: 0.25 × (0 + 0.5 + 0.8 + 0.6) = 0.475.
    expect(resultado.indexValue).toBeCloseTo(0.475, 10);
  });

  it('sin datos de ingreso, disponibilidad ni cobertura: esos componentes también valen 0', async () => {
    const { componentesRepo, zonaRepo, servicio } = crearServicio({
      zonaExiste: true,
      costoZona: 0,
      costoTodas: 0,
      maxIngreso: null,
      disponibilidad: null,
      maxDisponibilidad: null,
      totalBasicos: 0,
      basicosDisponibles: 0,
    });

    const resultado = await servicio.calculateIndex('zona-1', 2);

    expect(componentesGuardados(componentesRepo)).toEqual({
      precio: '0.0000',
      ingreso_segmento: '0.0000',
      disponibilidad: '0.0000',
      cobertura_basicos: '0.0000',
    });
    expect(resultado.indexValue).toBe(0);
    expect(zonaRepo.create).toHaveBeenCalledWith(expect.objectContaining({ indice: '0.0000' }));
  });

  it('disponibilidad y cobertura en 0 cuando la zona no tiene fila en la vista ni básicos con stock', async () => {
    const { componentesRepo, servicio } = crearServicio({ ...CON_DATOS, disponibilidad: null, basicosDisponibles: 0 });

    await servicio.calculateIndex('zona-1', 2);

    const valores = componentesGuardados(componentesRepo);
    expect(valores.disponibilidad).toBe('0.0000');
    expect(valores.cobertura_basicos).toBe('0.0000');
  });

  it('con datos: el índice es la suma ponderada de los 4 componentes con peso 0.25 cada uno', async () => {
    const { componentesRepo, pesosRepo, zonaRepo, servicio } = crearServicio();

    const resultado = await servicio.calculateIndex('zona-1', 2);

    // precio = 1 - 120/200 = 0.4; ingreso = ((10000+20000)/2) / 30000 = 0.5;
    // disponibilidad = 8/10 = 0.8; cobertura = 6/10 = 0.6.
    expect(componentesGuardados(componentesRepo)).toEqual({
      precio: '0.4000',
      ingreso_segmento: '0.5000',
      disponibilidad: '0.8000',
      cobertura_basicos: '0.6000',
    });
    // Los pesos no se leen de la base: son la constante 0.25 y se guardan con la corrida.
    expect(pesosRepo.create).toHaveBeenCalledTimes(4);
    for (const [peso] of pesosRepo.create.mock.calls) expect(peso.peso).toBe('0.2500');

    // 0.25 × (0.4 + 0.5 + 0.8 + 0.6) = 0.575; a la tabla va con 4 decimales.
    expect(resultado.indexValue).toBeCloseTo(0.575, 10);
    expect(zonaRepo.create).toHaveBeenCalledWith({ corridaId: 'corrida-1', zonaId: 'zona-1', indice: '0.5750' });
    expect(resultado).toMatchObject({ zoneId: 'zona-1', segmentId: 2, basicBasketCost: 120, estimatedIncome: 15000 });
  });

  it('segmento inexistente: NotFoundException y no abre transacción', async () => {
    const { segmentosRepo, dataSource, audit, servicio } = crearServicio();
    segmentosRepo.findOne.mockResolvedValue(null);

    await expect(servicio.calculateIndex('zona-1', 99)).rejects.toBeInstanceOf(NotFoundException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(audit.reportar).not.toHaveBeenCalled();
  });

  it('zona inexistente: NotFoundException antes de crear la corrida', async () => {
    const { dataSource, audit, servicio } = crearServicio({ ...CON_DATOS, zonaExiste: false });

    await expect(servicio.calculateIndex('no-existe', 2)).rejects.toBeInstanceOf(NotFoundException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(audit.reportar).not.toHaveBeenCalled();
  });

  it('después de guardar reporta a la bitácora con ejecutar_corrida, reenviando token e IP', async () => {
    const { dataSource, audit, servicio } = crearServicio();

    await servicio.calculateIndex('zona-1', 2, { token: 'Bearer abc', ip: '10.0.0.5' });

    expect(audit.reportar).toHaveBeenCalledTimes(1);
    expect(audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'analisis_corridas',
        registroId: 'corrida-1',
        accion: 'ejecutar_corrida',
        ip: '10.0.0.5',
      }),
      'Bearer abc',
    );
    expect(audit.reportar.mock.invocationCallOrder[0]).toBeGreaterThan(
      dataSource.transaction.mock.invocationCallOrder[0],
    );
  });
});
