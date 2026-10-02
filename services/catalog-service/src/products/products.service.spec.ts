import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { CacheService } from '../common/cache/cache.service';
import { CategoriaProductoEntity } from '../entities/categoria-producto.entity';
import { ProductoEntity } from '../entities/producto.entity';
import { ProductoPresentacionEntity } from '../entities/producto-presentacion.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { UnidadMedidaEntity } from '../entities/unidad-medida.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductsService } from './products.service';

const dto: CreateProductDto = {
  sku: 'ABA-ARR-001',
  nombre: 'Arroz blanco 1 kg',
  categoriaId: 1,
  presentacion: '1 kg',
  contenido: 1,
  unidadMedida: 'kg',
};

const errorSql = (code: string) =>
  Object.assign(new QueryFailedError('q', [], new Error('x')), { code });

function crearQb() {
  const qb: Record<string, jest.Mock> = {};
  for (const m of ['leftJoinAndSelect', 'orderBy', 'addOrderBy', 'where', 'skip', 'take']) {
    qb[m] = jest.fn().mockReturnValue(qb);
  }
  qb.getManyAndCount = jest.fn().mockResolvedValue([[{ id: 'p-1' }], 1]);
  return qb;
}

function crearServicio() {
  const proveedores = { findOne: jest.fn(), createQueryBuilder: jest.fn() };
  const categorias = { findOne: jest.fn(), find: jest.fn() };
  const productos = {
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const presentaciones = {
    create: jest.fn((x) => ({ ...x })),
    save: jest.fn(async (x) => ({ id: 'pres-1', ...x })),
    findOne: jest.fn(),
    findOneOrFail: jest.fn(async () => ({ id: 'pres-1' })),
    find: jest.fn(),
    remove: jest.fn(),
  };
  const unidades = { findOne: jest.fn(), find: jest.fn() };
  const manager = {
    create: jest.fn((_entidad, valores) => ({ ...valores })),
    save: jest.fn(async (x) => ({ id: 'nuevo-id', ...x })),
    update: jest.fn(async () => ({ affected: 1 })),
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
  const servicio = new ProductsService(
    proveedores as unknown as Repository<ProveedorEntity>,
    categorias as unknown as Repository<CategoriaProductoEntity>,
    productos as unknown as Repository<ProductoEntity>,
    presentaciones as unknown as Repository<ProductoPresentacionEntity>,
    unidades as unknown as Repository<UnidadMedidaEntity>,
    dataSource as unknown as DataSource,
    cache as unknown as CacheService,
  );
  return { proveedores, categorias, productos, presentaciones, unidades, manager, dataSource, cache, servicio };
}

describe('ProductsService — productos y presentaciones', () => {
  it('create rechaza una categoría inexistente con 400', async () => {
    const { categorias, servicio } = crearServicio();
    categorias.findOne.mockResolvedValue(null);

    await expect(servicio.create(dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create rechaza un SKU repetido con 409', async () => {
    const { categorias, productos, servicio } = crearServicio();
    categorias.findOne.mockResolvedValue({ id: 1 });
    productos.findOne.mockResolvedValue({ id: 'otro', sku: dto.sku });

    await expect(servicio.create(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('create rechaza una unidad desconocida con 400, sin abrir transacción', async () => {
    const { categorias, productos, unidades, dataSource, servicio } = crearServicio();
    categorias.findOne.mockResolvedValue({ id: 1 });
    productos.findOne.mockResolvedValue(null);
    unidades.findOne.mockResolvedValue(null);

    await expect(servicio.create(dto)).rejects.toThrow(/'kg'/);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('create guarda producto activo, sin proveedor, con su presentación predeterminada', async () => {
    const { categorias, productos, unidades, manager, servicio } = crearServicio();
    categorias.findOne.mockResolvedValue({ id: 1 });
    productos.findOne.mockResolvedValue(null);
    unidades.findOne.mockResolvedValue({ id: 3, clave: 'kg' });

    await servicio.create(dto);

    const [crearProducto, crearPresentacion] = manager.create.mock.calls;
    expect(crearProducto[0]).toBe(ProductoEntity);
    expect(crearProducto[1]).toMatchObject({ estatus: 'activo', proveedorId: null, esCanastaBasica: false });
    expect(crearPresentacion[0]).toBe(ProductoPresentacionEntity);
    expect(crearPresentacion[1]).toMatchObject({
      productoId: 'nuevo-id',
      contenido: '1',
      unidadMedidaId: 3,
      esPredeterminada: true,
    });
  });

  it('findOne lanza 404 si el producto no existe', async () => {
    const { productos, servicio } = crearServicio();
    productos.findOne.mockResolvedValue(null);

    await expect(servicio.findOne('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update cambia la categoría por columna y no re-guarda la relación eager', async () => {
    const { categorias, productos, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1', categoriaId: 1, categoria: { id: 1 } });
    categorias.findOne.mockResolvedValue({ id: 2 });

    await servicio.update('p-1', { categoriaId: 2, esCanastaBasica: true });

    expect(productos.update).toHaveBeenCalledWith({ id: 'p-1' }, { categoriaId: 2, esCanastaBasica: true });
  });

  it('update sin campos no manda un SET vacío', async () => {
    const { productos, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1' });

    await servicio.update('p-1', {});

    expect(productos.update).not.toHaveBeenCalled();
  });

  it('remove convierte la violación de llave foránea en 409', async () => {
    const { productos, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1' });
    productos.remove.mockRejectedValue(errorSql('23503'));

    await expect(servicio.remove('p-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('addPresentation convierte la segunda predeterminada (23505) en 409', async () => {
    const { productos, unidades, presentaciones, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1' });
    unidades.findOne.mockResolvedValue({ id: 2 });
    presentaciones.save.mockRejectedValue(errorSql('23505'));

    await expect(
      servicio.addPresentation('p-1', { nombre: '2 kg', contenido: 2, unidadMedida: 'kg', esPredeterminada: true }),
    ).rejects.toThrow(/predeterminada/);
  });

  it('removePresentation lanza 404 si no existe y 409 si tiene ventas', async () => {
    const { presentaciones, servicio } = crearServicio();
    presentaciones.findOne.mockResolvedValueOnce(null);
    await expect(servicio.removePresentation('x')).rejects.toBeInstanceOf(NotFoundException);

    presentaciones.findOne.mockResolvedValueOnce({ id: 'pres-1' });
    presentaciones.remove.mockRejectedValue(errorSql('23503'));
    await expect(servicio.removePresentation('pres-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ProductsService — lectura según el perfil', () => {
  const interno: SesionUsuario = { id: 'u1', email: 'admin@retail.mx', rol: 'Administrador', rolId: 1 };
  const proveedor: SesionUsuario = { id: 'u2', email: 'ventas@lacteos.mx', rol: 'Proveedor', rolId: 7 };

  it('un perfil interno ve el catálogo completo (sin filtro por proveedor)', async () => {
    const { productos, servicio } = crearServicio();
    const qb = crearQb();
    productos.createQueryBuilder.mockReturnValue(qb);

    await servicio.findAll(interno, {});

    expect(qb.where).not.toHaveBeenCalled();
  });

  it('un Proveedor solo recibe los productos de su empresa, filtrado en la consulta', async () => {
    const { productos, proveedores, servicio } = crearServicio();
    const qb = crearQb();
    productos.createQueryBuilder.mockReturnValue(qb);
    proveedores.findOne.mockResolvedValue({ id: 'prov-1' });

    await servicio.findAll(proveedor, {});

    expect(proveedores.findOne).toHaveBeenCalledWith({ where: { email: 'ventas@lacteos.mx' } });
    expect(qb.where).toHaveBeenCalledWith('p.proveedorId = :proveedorId', { proveedorId: 'prov-1' });
  });

  it('un Proveedor sin empresa vinculada recibe 403', async () => {
    const { productos, proveedores, servicio } = crearServicio();
    productos.createQueryBuilder.mockReturnValue(crearQb());
    proveedores.findOne.mockResolvedValue(null);

    await expect(servicio.findAll(proveedor, {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('findAll pagina por nombre', async () => {
    const { productos, servicio } = crearServicio();
    const qb = crearQb();
    productos.createQueryBuilder.mockReturnValue(qb);

    const pagina = await servicio.findAll(interno, { page: 2, limit: 5 });

    expect(qb.orderBy).toHaveBeenCalledWith('p.nombre', 'ASC');
    expect(qb.skip).toHaveBeenCalledWith(5);
    expect(pagina).toEqual({ data: [{ id: 'p-1' }], total: 1, page: 2, limit: 5 });
  });
});

describe('ProductsService — propuestas y revisión', () => {
  const proveedorUsuario: SesionUsuario = { id: 'u2', email: 'ventas@lacteos.mx', rol: 'Proveedor', rolId: 7 };
  const gerente: SesionUsuario = { id: 'u-ger', email: 'g@retail.mx', rol: 'Gerente de categoría', rolId: 3 };
  const propuesta = {
    sku: 'LDN-NEW-1',
    nombre: 'Queso nuevo',
    categoriaId: 1,
    presentacion: '400 g',
    contenido: 400,
    unidadMedida: 'g',
  };

  it('la propuesta nace pendiente, ligada a la empresa del token y sin canasta básica', async () => {
    const { proveedores, categorias, productos, unidades, manager, servicio } = crearServicio();
    proveedores.findOne.mockResolvedValue({ id: 'prov-1', activo: true });
    categorias.findOne.mockResolvedValue({ id: 1 });
    productos.findOne.mockResolvedValue(null);
    unidades.findOne.mockResolvedValue({ id: 4, clave: 'g' });

    await servicio.createProposal(propuesta, proveedorUsuario);

    expect(manager.create.mock.calls[0][1]).toMatchObject({
      estatus: 'pendiente_aprobacion',
      proveedorId: 'prov-1',
      esCanastaBasica: false,
    });
  });

  it('una empresa proveedora inactiva no puede proponer (403)', async () => {
    const { proveedores, dataSource, servicio } = crearServicio();
    proveedores.findOne.mockResolvedValue({ id: 'prov-1', activo: false });

    await expect(servicio.createProposal(propuesta, proveedorUsuario)).rejects.toBeInstanceOf(ForbiddenException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('una cuenta Proveedor sin empresa vinculada no puede proponer (403)', async () => {
    const { proveedores, servicio } = crearServicio();
    proveedores.findOne.mockResolvedValue(null);

    await expect(servicio.createProposal(propuesta, proveedorUsuario)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('la propuesta con SKU repetido responde 409', async () => {
    const { proveedores, categorias, productos, servicio } = crearServicio();
    proveedores.findOne.mockResolvedValue({ id: 'prov-1', activo: true });
    categorias.findOne.mockResolvedValue({ id: 1 });
    productos.findOne.mockResolvedValue({ id: 'otro' });

    await expect(servicio.createProposal(propuesta, proveedorUsuario)).rejects.toBeInstanceOf(ConflictException);
  });

  it('approve pasa a activo y deja constancia de quién y cuándo, en la misma transacción', async () => {
    const { productos, manager, dataSource, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1', estatus: 'pendiente_aprobacion' });

    await servicio.approve('p-1', gerente);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.update).toHaveBeenCalledWith(
      ProductoEntity,
      { id: 'p-1', estatus: 'pendiente_aprobacion' },
      { estatus: 'activo' },
    );
    expect(manager.create.mock.calls[0][1]).toMatchObject({
      productoId: 'p-1',
      estatusResultante: 'activo',
      revisadoPor: 'u-ger',
      motivo: null,
    });
    expect(manager.save).toHaveBeenCalledTimes(1);
  });

  it('reject guarda el motivo en la revisión', async () => {
    const { productos, manager, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1', estatus: 'pendiente_aprobacion' });

    await servicio.reject('p-1', { motivoRechazo: 'Falta la ficha técnica.' }, gerente);

    expect(manager.update).toHaveBeenCalledWith(ProductoEntity, expect.anything(), { estatus: 'rechazado' });
    expect(manager.create.mock.calls[0][1]).toMatchObject({
      estatusResultante: 'rechazado',
      motivo: 'Falta la ficha técnica.',
    });
  });

  it('resolver una propuesta ya resuelta responde 409 sin tocar nada', async () => {
    const { productos, dataSource, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1', estatus: 'activo' });

    await expect(servicio.approve('p-1', gerente)).rejects.toBeInstanceOf(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('si otro revisor gana la carrera, el UPDATE no afecta filas y responde 409 sin registrar revisión', async () => {
    const { productos, manager, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1', estatus: 'pendiente_aprobacion' });
    manager.update.mockResolvedValue({ affected: 0 });

    await expect(servicio.approve('p-1', gerente)).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('resolver un producto inexistente responde 404', async () => {
    const { productos, servicio } = crearServicio();
    productos.findOne.mockResolvedValue(null);

    await expect(servicio.approve('x', gerente)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('la bandeja solo trae pendientes, las más antiguas primero', async () => {
    const { productos, servicio } = crearServicio();
    const qb = crearQb();
    productos.createQueryBuilder.mockReturnValue(qb);

    await servicio.findPending({});

    expect(qb.where).toHaveBeenCalledWith('p.estatus = :estatus', { estatus: 'pendiente_aprobacion' });
    expect(qb.orderBy).toHaveBeenCalledWith('p.createdAt', 'ASC');
  });
});

describe('ProductsService — caché de catálogos', () => {
  it('las categorías se cachean 1 hora bajo catalog:categories y salen de la base solo en un MISS', async () => {
    const { categorias, cache, servicio } = crearServicio();
    categorias.find.mockResolvedValue([{ id: 1, nombre: 'Abarrotes' }]);

    const resultado = await servicio.findCategories();

    expect(cache.obtener).toHaveBeenCalledWith('catalog:categories', 3600, expect.any(Function));
    expect(categorias.find).toHaveBeenCalledWith({ order: { nombre: 'ASC' } });
    expect(resultado).toEqual([{ id: 1, nombre: 'Abarrotes' }]);
  });

  it('en un HIT de categorías no se consulta la base', async () => {
    const { categorias, cache, servicio } = crearServicio();
    cache.obtener.mockResolvedValue([{ id: 9, nombre: 'Desde Redis' }]);

    expect(await servicio.findCategories()).toEqual([{ id: 9, nombre: 'Desde Redis' }]);
    expect(categorias.find).not.toHaveBeenCalled();
  });

  it('las unidades se cachean 1 hora bajo catalog:units', async () => {
    const { unidades, cache, servicio } = crearServicio();
    unidades.find.mockResolvedValue([{ id: 1, clave: 'kg' }]);

    await servicio.findUnits();

    expect(cache.obtener).toHaveBeenCalledWith('catalog:units', 3600, expect.any(Function));
    expect(unidades.find).toHaveBeenCalledWith({ order: { clave: 'ASC' } });
  });

  it('lo mutable NO se cachea: el listado de productos y la bandeja siempre consultan la base', async () => {
    const { productos, cache, servicio } = crearServicio();
    const qb: Record<string, jest.Mock> = {};
    for (const m of ['leftJoinAndSelect', 'where', 'orderBy', 'addOrderBy', 'skip', 'take']) {
      qb[m] = jest.fn().mockReturnValue(qb);
    }
    qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
    productos.createQueryBuilder.mockReturnValue(qb);

    await servicio.findPending({});
    await servicio.findAll({ id: 'u1', email: 'a@b', rol: 'Administrador', rolId: 1 }, {});

    expect(cache.obtener).not.toHaveBeenCalled();
    expect(productos.createQueryBuilder).toHaveBeenCalledTimes(2);
  });
});
