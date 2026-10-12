import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { IncomeSegment } from '../entities/income-segment.entity';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto } from './dto/create-segment.dto';

const dtoBase: CreateSegmentDto = {
  code: 'ING_1',
  name: 'Ingreso bajo',
  incomeRangeMin: 0,
  incomeRangeMax: 15000,
  source: 'INEGI',
  updateFrequency: 'Anual',
  zoneRelation: 'Zona agregada',
  limitations: 'Ninguna',
};

function crearServicio() {
  const repo = {
    create: jest.fn((x) => ({ ...x })),
    save: jest.fn(async (x) => ({ id: 7, ...x })),
    findOne: jest.fn(),
    find: jest.fn(async () => [] as unknown[]), // segmentos existentes (para detectar encimados)
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const servicio = new SegmentsService(repo as unknown as Repository<IncomeSegment>);
  return { repo, servicio };
}

describe('SegmentsService', () => {
  it('create guarda los ingresos como cadenas decimales y deja nulos los opcionales', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValue(null);

    const { incomeRangeMax, ...sinTope } = dtoBase;
    void incomeRangeMax;
    const guardado = await servicio.create(sinTope);

    expect(guardado).toMatchObject({
      id: 7,
      incomeRangeMin: '0',
      incomeRangeMax: null,
      description: null,
    });
  });

  it('create rechaza un mínimo >= máximo con 400 (no 500)', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValue(null);

    await expect(servicio.create({ ...dtoBase, incomeRangeMin: 30000, incomeRangeMax: 20000 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(servicio.create({ ...dtoBase, incomeRangeMin: 5, incomeRangeMax: 5 })).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('create rechaza con 409 un rango que se encima con otro y dice con cuál (D-10)', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValue(null);
    repo.find.mockResolvedValue([
      { id: 1, code: 'ING_1', incomeRangeMin: '0.00', incomeRangeMax: '15000.00' },
      { id: 3, code: 'ING_3', incomeRangeMin: '45000.01', incomeRangeMax: null },
    ]);

    await expect(servicio.create({ ...dtoBase, code: 'X', name: 'X', incomeRangeMin: 1000, incomeRangeMax: 20000 })).rejects.toThrow(/ING_1/);
    // Sin tope: se encima con el de abajo que también es abierto.
    await expect(servicio.create({ ...dtoBase, code: 'X', name: 'X', incomeRangeMin: 900000, incomeRangeMax: undefined })).rejects.toThrow(/ING_3/);
    // Pegado justo después del límite de ING_1 no se encima.
    await expect(servicio.create({ ...dtoBase, code: 'X', name: 'X', incomeRangeMin: 15000.01, incomeRangeMax: 40000 })).resolves.toBeDefined();
  });

  it('update revisa el rango resultante y no choca consigo mismo', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValueOnce({ id: 1, incomeRangeMin: '0', incomeRangeMax: '15000' });
    repo.find.mockResolvedValue([
      { id: 1, code: 'ING_1', incomeRangeMin: '0.00', incomeRangeMax: '15000.00' },
      { id: 2, code: 'ING_2', incomeRangeMin: '15000.01', incomeRangeMax: '45000.00' },
    ]);

    await expect(servicio.update(1, { incomeRangeMax: 20000 })).rejects.toThrow(/ING_2/);
    repo.findOne.mockResolvedValueOnce({ id: 1, incomeRangeMin: '0', incomeRangeMax: '15000' });
    await expect(servicio.update(1, { incomeRangeMax: 14000 })).resolves.toBeDefined();
  });

  it('create rechaza un código repetido con 409', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValueOnce({ id: 1, code: 'ING_1' });

    await expect(servicio.create(dtoBase)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('findOne lanza 404 si el segmento no existe', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValue(null);

    await expect(servicio.findOne(99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update permite conservar el propio código pero rechaza el de otro segmento', async () => {
    const { repo, servicio } = crearServicio();
    const actual = { id: 1, code: 'ING_1', name: 'Ingreso bajo', incomeRangeMin: '0', incomeRangeMax: null };
    repo.findOne
      .mockResolvedValueOnce(actual) // findOne(id)
      .mockResolvedValueOnce({ id: 1, code: 'ING_1' }); // mismo segmento: no es duplicado
    await expect(servicio.update(1, { code: 'ING_1' })).resolves.toBeDefined();

    repo.findOne
      .mockResolvedValueOnce(actual)
      .mockResolvedValueOnce({ id: 2, code: 'ING_2' }); // otro segmento ya lo usa
    await expect(servicio.update(1, { code: 'ING_2' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('update puede quitar el tope superior mandando incomeRangeMax null', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValueOnce({ id: 1, incomeRangeMin: '0', incomeRangeMax: '15000' });

    const guardado = await servicio.update(1, { incomeRangeMax: null as unknown as undefined });

    expect(guardado.incomeRangeMax).toBeNull();
  });

  it('remove convierte la violación de llave foránea (23503) en 409', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValue({ id: 1, code: 'ING_1' });
    const error = Object.assign(new QueryFailedError('delete', [], new Error('fk')), {
      code: '23503',
    });
    repo.remove.mockRejectedValue(error);

    await expect(servicio.remove(1)).rejects.toBeInstanceOf(ConflictException);
  });

  it('remove deja pasar cualquier otro error de la base', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValue({ id: 1, code: 'ING_1' });
    repo.remove.mockRejectedValue(new Error('conexión caída'));

    await expect(servicio.remove(1)).rejects.toThrow('conexión caída');
  });

  it('findAll pagina ordenando por ingreso mínimo ascendente', async () => {
    const { repo, servicio } = crearServicio();
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[{ id: 1 }], 3]),
    };
    repo.createQueryBuilder.mockReturnValue(qb);

    const pagina = await servicio.findAll({ page: 2, limit: 1 });

    expect(qb.orderBy).toHaveBeenCalledWith('s.incomeRangeMin', 'ASC');
    expect(qb.skip).toHaveBeenCalledWith(1);
    expect(qb.take).toHaveBeenCalledWith(1);
    expect(pagina).toEqual({ data: [{ id: 1 }], total: 3, page: 2, limit: 1 });
  });
});
