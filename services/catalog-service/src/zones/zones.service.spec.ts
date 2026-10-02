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
  const dataSource = { query: jest.fn() };
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
  return { zonas, municipios, dataSource, cache, servicio };
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

  it('compareZones exige al menos un id', async () => {
    const { servicio } = crearServicio();
    await expect(servicio.compareZones([])).rejects.toBeInstanceOf(BadRequestException);
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

  it('compareZones lanza 404 si ninguna zona existe', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([]);

    await expect(servicio.compareZones(['a'])).rejects.toBeInstanceOf(NotFoundException);
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
