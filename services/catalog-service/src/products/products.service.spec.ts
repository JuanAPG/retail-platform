import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
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
    findOneOrFail: jest.fn(async () => ({ id: 'nuevo-id' })),
  };
  const dataSource = {
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const servicio = new ProductsService(
    proveedores as unknown as Repository<ProveedorEntity>,
    categorias as unknown as Repository<CategoriaProductoEntity>,
    productos as unknown as Repository<ProductoEntity>,
    presentaciones as unknown as Repository<ProductoPresentacionEntity>,
    unidades as unknown as Repository<UnidadMedidaEntity>,
    dataSource as unknown as DataSource,
  );
  return { proveedores, categorias, productos, presentaciones, unidades, manager, dataSource, servicio };
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
