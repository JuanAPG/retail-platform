import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CacheService } from '../common/cache/cache.service';
import { CodigoPostalEntity } from '../entities/codigo-postal.entity';
import { TiendaEntity } from '../entities/tienda.entity';
import { ZonaEntity } from '../entities/zona.entity';
import { DireccionEntity } from '../entities/direccion.entity';
import { CreateStoreDto } from './dto/create-store.dto';
import { StoresService } from './stores.service';

const dto: CreateStoreDto = {
  nombre: 'Super Valle Norte',
  formato: 'supermercado',
  zonaId: 'zona-1',
  calle: 'Av. Insurgentes',
  codigoPostal: '66220',
};

function crearServicio() {
  const tiendas = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const codigos = { findOne: jest.fn(), find: jest.fn() };
  const zonas = { findOne: jest.fn() };
  const manager = {
    create: jest.fn((_entidad, valores) => ({ ...valores })),
    save: jest.fn(async (x) => ({ id: 'nuevo-id', ...x })),
    update: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
    findOneOrFail: jest.fn(async () => ({ id: 'nuevo-id' })),
  };
  const dataSource = {
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  // Caché "transparente" por omisión: siempre MISS (ejecuta la carga). Los tests de caché
  // sobreescriben `obtener` para simular un HIT.
  const cache = {
    obtener: jest.fn((_clave: string, _ttl: number, cargar: () => Promise<unknown>) => cargar()),
  };
  const servicio = new StoresService(
    tiendas as unknown as Repository<TiendaEntity>,
    codigos as unknown as Repository<CodigoPostalEntity>,
    zonas as unknown as Repository<ZonaEntity>,
    dataSource as unknown as DataSource,
    cache as unknown as CacheService,
  );
  return { tiendas, codigos, zonas, manager, dataSource, cache, servicio };
}

describe('StoresService', () => {
  it('create rechaza una zona inexistente con 400, sin abrir transacción', async () => {
    const { zonas, dataSource, servicio } = crearServicio();
    zonas.findOne.mockResolvedValue(null);

    await expect(servicio.create(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('create rechaza un código postal fuera del catálogo con 400', async () => {
    const { zonas, codigos, dataSource, servicio } = crearServicio();
    zonas.findOne.mockResolvedValue({ id: 'zona-1' });
    codigos.findOne.mockResolvedValue(null);

    await expect(servicio.create(dto)).rejects.toThrow(/66220/);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('create guarda dirección y tienda juntas, enlazadas y activas', async () => {
    const { zonas, codigos, manager, servicio } = crearServicio();
    zonas.findOne.mockResolvedValue({ id: 'zona-1' });
    codigos.findOne.mockResolvedValue({ codigoPostal: '66220' });

    await servicio.create(dto);

    const [crearDireccion, crearTienda] = manager.create.mock.calls;
    expect(crearDireccion[0]).toBe(DireccionEntity);
    expect(crearDireccion[1]).toMatchObject({ calle: 'Av. Insurgentes', numeroExterior: null });
    expect(crearTienda[0]).toBe(TiendaEntity);
    expect(crearTienda[1]).toMatchObject({ direccionId: 'nuevo-id', activo: true, proveedorId: null });
    expect(manager.save).toHaveBeenCalledTimes(2);
  });

  it('findOne lanza 404 si la tienda no existe', async () => {
    const { tiendas, servicio } = crearServicio();
    tiendas.findOne.mockResolvedValue(null);

    await expect(servicio.findOne('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update cambia la zona por columna (no re-guarda la relación eager vieja)', async () => {
    const { tiendas, zonas, manager, servicio } = crearServicio();
    tiendas.findOne.mockResolvedValue({ id: 't-1', direccionId: 'd-1', zonaId: 'zona-vieja' });
    zonas.findOne.mockResolvedValue({ id: 'zona-2' });

    await servicio.update('t-1', { zonaId: 'zona-2', activo: false });

    expect(manager.update).toHaveBeenCalledWith(TiendaEntity, { id: 't-1' }, { zonaId: 'zona-2', activo: false });
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('update solo de dirección toca direcciones y no manda un SET vacío a tiendas', async () => {
    const { tiendas, manager, servicio } = crearServicio();
    tiendas.findOne.mockResolvedValue({ id: 't-1', direccionId: 'd-1' });

    await servicio.update('t-1', { calle: 'Nueva 123' });

    expect(manager.update).toHaveBeenCalledTimes(1);
    expect(manager.update).toHaveBeenCalledWith(DireccionEntity, { id: 'd-1' }, { calle: 'Nueva 123' });
  });

  it('remove borra la tienda y su dirección en la misma transacción', async () => {
    const { tiendas, manager, dataSource, servicio } = crearServicio();
    const tienda = { id: 't-1', direccionId: 'd-1' };
    tiendas.findOne.mockResolvedValue(tienda);

    await servicio.remove('t-1');

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.remove).toHaveBeenCalledWith(tienda);
    expect(manager.delete).toHaveBeenCalledWith(DireccionEntity, { id: 'd-1' });
  });

  it('remove convierte la violación de llave foránea (23503) en 409', async () => {
    const { tiendas, manager, servicio } = crearServicio();
    tiendas.findOne.mockResolvedValue({ id: 't-1', direccionId: 'd-1' });
    manager.remove.mockRejectedValue(
      Object.assign(new QueryFailedError('delete', [], new Error('fk')), { code: '23503' }),
    );

    await expect(servicio.remove('t-1')).rejects.toBeInstanceOf(ConflictException);
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('findAll une todas las relaciones y pagina por nombre', async () => {
    const { tiendas, servicio } = crearServicio();
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[{ id: 't-1' }], 1]),
    };
    tiendas.createQueryBuilder.mockReturnValue(qb);

    const pagina = await servicio.findAll({});

    expect(qb.leftJoinAndSelect).toHaveBeenCalledTimes(6);
    expect(qb.orderBy).toHaveBeenCalledWith('t.nombre', 'ASC');
    expect(pagina).toEqual({ data: [{ id: 't-1' }], total: 1, page: 1, limit: 20 });
  });
});

describe('StoresService — caché de catálogos', () => {
  it('los códigos postales se cachean 1 hora bajo catalog:postal-codes y salen de la base solo en un MISS', async () => {
    const { codigos, cache, servicio } = crearServicio();
    codigos.find.mockResolvedValue([{ codigoPostal: '64000' }]);

    expect(await servicio.findPostalCodes()).toEqual([{ codigoPostal: '64000' }]);
    expect(cache.obtener).toHaveBeenCalledWith('catalog:postal-codes', 3600, expect.any(Function));
    expect(codigos.find).toHaveBeenCalledWith({ order: { codigoPostal: 'ASC' } });
  });

  it('en un HIT de códigos postales no se consulta la base', async () => {
    const { codigos, cache, servicio } = crearServicio();
    cache.obtener.mockResolvedValue([{ codigoPostal: '99999' }]);

    expect(await servicio.findPostalCodes()).toEqual([{ codigoPostal: '99999' }]);
    expect(codigos.find).not.toHaveBeenCalled();
  });

  it('crear una tienda valida el código postal contra la base, no contra la caché', async () => {
    const { zonas, codigos, cache, servicio } = crearServicio();
    zonas.findOne.mockResolvedValue({ id: 'zona-1' });
    codigos.findOne.mockResolvedValue(null);

    await expect(
      servicio.create({ nombre: 'T', formato: 'otro', zonaId: 'zona-1', calle: 'C', codigoPostal: '00000' }),
    ).rejects.toThrow(/00000/);
    expect(codigos.findOne).toHaveBeenCalledWith({ where: { codigoPostal: '00000' } });
    expect(cache.obtener).not.toHaveBeenCalled();
  });
});
