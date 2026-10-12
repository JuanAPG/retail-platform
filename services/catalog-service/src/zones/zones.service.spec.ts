import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CacheService } from '../common/cache/cache.service';
import { MunicipioEntity } from '../entities/municipio.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { ZonesService } from './zones.service';

function crearServicio() {
  const zonas = {
    create: jest.fn((x) => ({ ...x })),
    save: jest.fn(async (x) => ({ id: 'z-1', ...x })),
    findOne: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const municipios = { findOne: jest.fn(), find: jest.fn() };
  const manager = { query: jest.fn(async (_sql: string, _params?: unknown[]): Promise<any> => []) };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  // Caché "transparente" por omisión: siempre MISS (ejecuta la carga). Los tests de caché
  // sobreescriben `obtener` para simular un HIT.
  const cache = {
    obtener: jest.fn((_clave: string, _ttl: number, cargar: () => Promise<unknown>) => cargar()),
  };
  const servicio = new ZonesService(
    zonas as unknown as Repository<ZonaEntity>,
    municipios as unknown as Repository<MunicipioEntity>,
    dataSource as unknown as DataSource,
    cache as unknown as CacheService,
  );
  return { zonas, municipios, dataSource, manager, cache, servicio };
}

describe('ZonesService', () => {
  it('create rechaza un municipio inexistente con 400', async () => {
    const { municipios, servicio } = crearServicio();
    municipios.findOne.mockResolvedValue(null);

    await expect(servicio.create({ nombre: 'Zona Norte', municipioId: 99 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('create rechaza el mismo nombre en el mismo municipio con 409', async () => {
    const { zonas, municipios, servicio } = crearServicio();
    municipios.findOne.mockResolvedValue({ id: 2 });
    zonas.findOne.mockResolvedValue({ id: 'otra', nombre: 'Zona Norte', municipioId: 2 });

    await expect(servicio.create({ nombre: 'Zona Norte', municipioId: 2 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(zonas.save).not.toHaveBeenCalled();
  });

  it('create guarda la zona activa y devuelve la fila releída con su municipio', async () => {
    const { zonas, municipios, servicio } = crearServicio();
    municipios.findOne.mockResolvedValue({ id: 2 });
    zonas.findOne
      .mockResolvedValueOnce(null) // sin duplicado
      .mockResolvedValueOnce({ id: 'z-1', nombre: 'Zona Norte', municipio: { id: 2 } }); // relectura

    const zona = await servicio.create({ nombre: 'Zona Norte', municipioId: 2 });

    expect(zonas.create).toHaveBeenCalledWith(
      expect.objectContaining({ activo: true, descripcion: null }),
    );
    expect(zona).toMatchObject({ id: 'z-1', municipio: { id: 2 } });
  });

  it('findOne lanza 404 si la zona no existe', async () => {
    const { zonas, servicio } = crearServicio();
    zonas.findOne.mockResolvedValue(null);

    await expect(servicio.findOne('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update no guarda la relación eager vieja al cambiar de municipio', async () => {
    const { zonas, municipios, servicio } = crearServicio();
    const actual = { id: 'z-1', nombre: 'Zona', municipioId: 1, municipio: { id: 1 }, activo: true };
    municipios.findOne.mockResolvedValue({ id: 2 });
    zonas.findOne
      .mockResolvedValueOnce(actual) // findOne(id)
      .mockResolvedValueOnce(null) // sin duplicado
      .mockResolvedValueOnce({ ...actual, municipioId: 2 }); // relectura

    await servicio.update('z-1', { municipioId: 2 });

    const guardado = zonas.save.mock.calls[0][0];
    expect(guardado.municipioId).toBe(2);
    expect(guardado).not.toHaveProperty('municipio');
  });

  it('remove convierte la violación de llave foránea (23503) en 409', async () => {
    const { zonas, servicio } = crearServicio();
    zonas.findOne.mockResolvedValue({ id: 'z-1', nombre: 'Zona' });
    zonas.remove.mockRejectedValue(
      Object.assign(new QueryFailedError('delete', [], new Error('fk')), { code: '23503' }),
    );

    await expect(servicio.remove('z-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('compareZones exige al menos DOS ids distintos (CAT-12): vacío, uno solo o repetido dan 400', async () => {
    const { servicio } = crearServicio();
    await expect(servicio.compareZones([])).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.compareZones(['a'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.compareZones(['a', 'a'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('compareZones devuelve null en los indicadores que Analítica no calculó', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query
      .mockResolvedValueOnce([
        { zoneId: 'a', zoneName: 'Valle', municipality: 'San Pedro', classification: null },
        { zoneId: 'b', zoneName: 'Centro', municipality: 'Monterrey', classification: 'Ingreso medio' },
      ])
      .mockResolvedValueOnce([{ zoneId: 'b', clave: 'poblacion', valor: '1200' }]);

    const filas = await servicio.compareZones(['a', 'b']);

    expect(filas[0]).toMatchObject({ classification: null, population: null, estimatedIncome: null });
    expect(filas[1]).toMatchObject({ classification: 'Ingreso medio', population: 1200, availability: null });
  });

  it('compareZones responde 404 y LISTA las zonas que no existen, aunque otras sí existan', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ zoneId: 'a', zoneName: 'A', municipality: 'M', classification: null }]);

    const error = await servicio.compareZones(['a', 'fantasma']).catch((e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toContain('fantasma');
    expect(error.message).not.toContain(' a,');
  });
});

describe('ZonesService — CAT-13: indicadores y clasificación de una zona', () => {
  const dto = { ingresoEstimado: 18500, poblacion: 42000, disponibilidad: 0.85, periodoInicio: '2026-01-01', periodoFin: '2026-09-30', fuente: 'INEGI' };

  it('setIndicators guarda una corrida de carga manual y un valor por indicador, TODO en una transacción', async () => {
    const { zonas, manager, dataSource, servicio } = crearServicio();
    zonas.findOne.mockResolvedValue({ id: 'z1' });
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO analisis_corridas')) return [{ id: 'corrida-1' }];
      if (sql.includes('INSERT INTO indicador_valores')) return [{ id: 'iv' }];
      return [];
    });

    const r = await servicio.setIndicators('z1', dto, 'u-admin');

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ zoneId: 'z1', estimatedIncome: 18500, population: 42000, availability: 0.85, runId: 'corrida-1', source: 'INEGI' });
    const sqls = manager.query.mock.calls.map(([sql]) => sql as string);
    expect(sqls.filter((q) => q.includes('INSERT INTO indicador_valores'))).toHaveLength(3);
    const claves = manager.query.mock.calls.filter(([sql]) => (sql as string).includes('INSERT INTO indicador_valores')).map(([, p]) => (p as unknown[])[0]);
    expect(claves).toEqual(['ingreso_estimado', 'poblacion', 'disponibilidad']);
    const corrida = manager.query.mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO analisis_corridas'))!;
    expect(corrida[1]).toEqual(['u-admin', '2026-01-01', '2026-09-30']);
    const params = manager.query.mock.calls.filter(([sql]) => (sql as string).includes('analisis_corrida_parametros')).map(([, p]) => (p as unknown[]).slice(1));
    expect(params).toEqual([['origen', 'carga_manual'], ['fuente', 'INEGI'], ['zona_id', 'z1']]);
  });

  it('setIndicators rechaza una zona inexistente (404), un periodo invertido (400) y un indicador que falta en el catálogo (400)', async () => {
    const { zonas, manager, servicio } = crearServicio();
    zonas.findOne.mockResolvedValueOnce(null);
    await expect(servicio.setIndicators('x', dto, 'u')).rejects.toBeInstanceOf(NotFoundException);

    zonas.findOne.mockResolvedValue({ id: 'z1' });
    await expect(servicio.setIndicators('z1', { ...dto, periodoInicio: '2026-10-01', periodoFin: '2026-01-01' }, 'u')).rejects.toBeInstanceOf(BadRequestException);

    manager.query.mockImplementation(async (sql: string) => (sql.includes('INSERT INTO analisis_corridas') ? [{ id: 'c' }] : []));
    await expect(servicio.setIndicators('z1', dto, 'u')).rejects.toThrow(/no existe en el catálogo/);
  });

  it('setClassification cierra la vigente, crea la nueva con quién la asignó y devuelve la anterior', async () => {
    const { zonas, dataSource, manager, servicio } = crearServicio();
    zonas.findOne.mockResolvedValue({ id: 'z1' });
    dataSource.query.mockResolvedValueOnce([{ id: 2, codigo: 'ING_2', nombre: 'Ingreso medio' }]);
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT segmento_manual_id')) return [{ segmento_manual_id: 1 }];
      if (sql.includes('INSERT INTO zona_clasificaciones')) return [{ id: 'zc', desde: '2026-10-08' }];
      return [];
    });

    const r = await servicio.setClassification('z1', { segmentId: 2 }, 'u-admin');

    expect(r).toEqual({ zoneId: 'z1', segmentId: 2, segmentCode: 'ING_2', segmentName: 'Ingreso medio', since: '2026-10-08', previousSegmentId: 1 });
    const sqls = manager.query.mock.calls.map(([sql]) => sql as string);
    const cierre = sqls.findIndex((q) => q.includes('UPDATE zona_clasificaciones SET vigente_hasta'));
    const alta = sqls.findIndex((q) => q.includes('INSERT INTO zona_clasificaciones'));
    expect(cierre).toBeGreaterThanOrEqual(0);
    expect(cierre).toBeLessThan(alta); // primero se cierra la vigente, luego se crea la nueva
    expect(manager.query.mock.calls[alta][1]).toEqual(['z1', 2, 'u-admin']);
  });

  it('setClassification rechaza un segmento inexistente con 400 sin tocar nada', async () => {
    const { zonas, dataSource, dataSource: ds, servicio } = crearServicio();
    zonas.findOne.mockResolvedValue({ id: 'z1' });
    dataSource.query.mockResolvedValueOnce([]);

    await expect(servicio.setClassification('z1', { segmentId: 99 }, 'u')).rejects.toBeInstanceOf(BadRequestException);
    expect(ds.transaction).not.toHaveBeenCalled();
  });
});

describe('ZonesService — caché de catálogos', () => {
  it('los municipios se cachean 1 hora bajo catalog:municipalities y salen de la base solo en un MISS', async () => {
    const { municipios, cache, servicio } = crearServicio();
    municipios.find.mockResolvedValue([{ id: 2, nombre: 'Monterrey' }]);

    expect(await servicio.findMunicipalities()).toEqual([{ id: 2, nombre: 'Monterrey' }]);
    expect(cache.obtener).toHaveBeenCalledWith('catalog:municipalities', 3600, expect.any(Function));
    expect(municipios.find).toHaveBeenCalledWith({ order: { nombre: 'ASC' } });
  });

  it('en un HIT de municipios no se consulta la base', async () => {
    const { municipios, cache, servicio } = crearServicio();
    cache.obtener.mockResolvedValue([{ id: 7, nombre: 'Desde Redis' }]);

    expect(await servicio.findMunicipalities()).toEqual([{ id: 7, nombre: 'Desde Redis' }]);
    expect(municipios.find).not.toHaveBeenCalled();
  });

  it('las zonas (mutables) no se cachean: crear una no deja datos viejos en ningún lado', async () => {
    const { zonas, municipios, cache, servicio } = crearServicio();
    municipios.findOne.mockResolvedValue({ id: 2 });
    zonas.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'z-1', nombre: 'Zona Norte' });

    await servicio.create({ nombre: 'Zona Norte', municipioId: 2 });

    expect(cache.obtener).not.toHaveBeenCalled();
  });
});
