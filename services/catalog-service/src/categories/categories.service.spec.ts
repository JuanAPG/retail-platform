import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { CacheService } from '../common/cache/cache.service';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { CategoriesService } from './categories.service';

const errorSql = (code: string) => Object.assign(new QueryFailedError('q', [], new Error('x')), { code });

/** Catálogo en memoria: Abarrotes (1) → Granos (2) → Arroces (3); Limpieza (4) desactivada. */
function crearServicio() {
  const filas = new Map<number, CategoriaProductoEntity>([
    [1, { id: 1, nombre: 'Abarrotes', categoriaPadreId: null, descripcion: null, activo: true }],
    [2, { id: 2, nombre: 'Granos', categoriaPadreId: 1, descripcion: null, activo: true }],
    [3, { id: 3, nombre: 'Arroces', categoriaPadreId: 2, descripcion: null, activo: true }],
    [4, { id: 4, nombre: 'Limpieza', categoriaPadreId: null, descripcion: null, activo: false }],
  ]);
  const nombreBuscado = { valor: '' };
  const qb: { where: jest.Mock; getOne: jest.Mock } = {
    where: jest.fn(),
    getOne: jest.fn(async () => [...filas.values()].find((c) => c.nombre.toLowerCase() === nombreBuscado.valor) ?? null),
  };
  qb.where.mockImplementation((_sql: string, p: { nombre: string }) => {
    nombreBuscado.valor = p.nombre.toLowerCase();
    return qb;
  });
  const categorias = {
    findOne: jest.fn(async ({ where }: { where: { id: number } }) => {
      const fila = filas.get(where.id);
      return fila ? { ...fila } : null;
    }),
    count: jest.fn(async ({ where }: { where: { categoriaPadreId: number } }) =>
      [...filas.values()].filter((c) => c.categoriaPadreId === where.categoriaPadreId).length,
    ),
    create: jest.fn((x: Partial<CategoriaProductoEntity>) => ({ ...x })),
    save: jest.fn(async (x: CategoriaProductoEntity) => {
      const id = x.id ?? 10;
      filas.set(id, { ...x, id });
      return { ...x, id };
    }),
    remove: jest.fn(async (x: CategoriaProductoEntity) => {
      filas.delete(x.id);
    }),
    createQueryBuilder: jest.fn(() => qb),
  };
  const productos = { count: jest.fn(async () => 0) };
  const cache = { borrar: jest.fn(async () => undefined) };
  const servicio = new CategoriesService(
    categorias as unknown as Repository<CategoriaProductoEntity>,
    productos as unknown as Repository<ProductoEntity>,
    cache as unknown as CacheService,
  );
  return { servicio, categorias, productos, cache, filas };
}

describe('CategoriesService (T-21)', () => {
  describe('alta', () => {
    it('crea la categoría activa, sin padre, y borra el catálogo cacheado', async () => {
      const { servicio, cache } = crearServicio();
      const creada = await servicio.create({ nombre: '  Lácteos ' });
      expect(creada).toMatchObject({ id: 10, nombre: 'Lácteos', categoriaPadreId: null, descripcion: null, activo: true });
      expect(cache.borrar).toHaveBeenCalledWith('catalog:categories');
    });

    it('nombre repetido, aunque cambien mayúsculas o espacios → 409', async () => {
      const { servicio } = crearServicio();
      await expect(servicio.create({ nombre: ' abarrotes ' })).rejects.toThrow(ConflictException);
    });

    it('dos altas simultáneas con el mismo nombre: el índice único se traduce a 409, no a 500', async () => {
      const { servicio, categorias } = crearServicio();
      categorias.save.mockRejectedValueOnce(errorSql('23505'));
      await expect(servicio.create({ nombre: 'Bebidas' })).rejects.toThrow(ConflictException);
    });

    it('padre inexistente o desactivado → 400', async () => {
      const { servicio } = crearServicio();
      await expect(servicio.create({ nombre: 'Quesos', categoriaPadreId: 99 })).rejects.toThrow('no existe');
      await expect(servicio.create({ nombre: 'Jabones', categoriaPadreId: 4 })).rejects.toThrow('desactivada');
    });
  });

  describe('cambio', () => {
    it('edita nombre y descripción; `null` borra la descripción y quita el padre', async () => {
      const { servicio } = crearServicio();
      const editada = await servicio.update(2, { nombre: 'Granos y semillas', descripcion: 'Secos' });
      expect(editada).toMatchObject({ nombre: 'Granos y semillas', descripcion: 'Secos', categoriaPadreId: 1 });
      expect(await servicio.update(2, { descripcion: null, categoriaPadreId: null })).toMatchObject({
        descripcion: null,
        categoriaPadreId: null,
      });
    });

    it('conservar su propio nombre no es un duplicado; tomar el de otra → 409', async () => {
      const { servicio } = crearServicio();
      await expect(servicio.update(2, { nombre: 'Granos' })).resolves.toMatchObject({ nombre: 'Granos' });
      await expect(servicio.update(2, { nombre: 'Abarrotes' })).rejects.toThrow(ConflictException);
    });

    it('no puede colgar de sí misma ni de una de sus subcategorías (ciclo) → 400', async () => {
      const { servicio } = crearServicio();
      await expect(servicio.update(1, { categoriaPadreId: 1 })).rejects.toThrow(BadRequestException);
      await expect(servicio.update(1, { categoriaPadreId: 3 })).rejects.toThrow(/subcategor/);
    });

    it('`activo` desactiva y reactiva sin borrar', async () => {
      const { servicio } = crearServicio();
      expect((await servicio.update(1, { activo: false })).activo).toBe(false);
      expect((await servicio.update(4, { activo: true })).activo).toBe(true);
    });

    it('inexistente o fuera del rango de SMALLINT → 404', async () => {
      const { servicio } = crearServicio();
      await expect(servicio.update(99, { nombre: 'X' })).rejects.toThrow(NotFoundException);
      await expect(servicio.findOne(99999999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('baja (D-07)', () => {
    it('sin productos ni subcategorías se borra de verdad', async () => {
      const { servicio, categorias, filas, cache } = crearServicio();
      expect(await servicio.remove(3)).toEqual({ eliminado: true });
      expect(categorias.remove).toHaveBeenCalled();
      expect(filas.has(3)).toBe(false);
      expect(cache.borrar).toHaveBeenCalledWith('catalog:categories');
    });

    it('con productos NO se borra: queda desactivada y se devuelve', async () => {
      const { servicio, categorias, productos, filas } = crearServicio();
      productos.count.mockResolvedValue(5);
      const resultado = await servicio.remove(3);
      expect(resultado).toEqual({ eliminado: false, entidad: expect.objectContaining({ id: 3, activo: false }) });
      expect(categorias.remove).not.toHaveBeenCalled();
      expect(filas.get(3)?.activo).toBe(false);
    });

    it('con subcategorías tampoco se borra', async () => {
      const { servicio, categorias } = crearServicio();
      const resultado = await servicio.remove(1);
      expect(resultado.eliminado).toBe(false);
      expect(categorias.remove).not.toHaveBeenCalled();
    });

    it('si otro servicio la usa (llave foránea), se desactiva en vez de responder 500', async () => {
      const { servicio, categorias, filas } = crearServicio();
      categorias.remove.mockRejectedValueOnce(errorSql('23503'));
      const resultado = await servicio.remove(3);
      expect(resultado).toEqual({ eliminado: false, entidad: expect.objectContaining({ id: 3, activo: false }) });
      expect(filas.get(3)?.activo).toBe(false);
    });

    it('inexistente → 404', async () => {
      const { servicio } = crearServicio();
      await expect(servicio.remove(99)).rejects.toThrow(NotFoundException);
    });
  });
});
