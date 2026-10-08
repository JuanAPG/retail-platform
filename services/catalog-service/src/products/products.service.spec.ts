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
    find: jest.fn(async (): Promise<unknown[]> => []),
    remove: jest.fn(),
  };
  const unidades = { findOne: jest.fn(), find: jest.fn() };
  const manager = {
    create: jest.fn((_entidad, valores) => ({ ...valores })),
    save: jest.fn(async (x) => ({ id: 'nuevo-id', ...x })),
    update: jest.fn(async () => ({ affected: 1 })),
    remove: jest.fn(),
    // Por omisión la presentación NO tiene historial (ninguna tabla dependiente devuelve filas).
    query: jest.fn(async (_sql: string, _params?: unknown[]) => [] as unknown[]),
    findOneOrFail: jest.fn(async (): Promise<Record<string, unknown>> => ({ id: 'nuevo-id' })),
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

  it('remove borra el producto cuando ninguna presentación tiene historial', async () => {
    const { productos, manager, servicio } = crearServicio();
    const producto = { id: 'p-1', presentaciones: [{ id: 'pres-1' }] };
    productos.findOne.mockResolvedValue(producto);

    expect(await servicio.remove('p-1')).toEqual({ eliminado: true });
    expect(manager.remove).toHaveBeenCalledWith(producto);
  });

  it('remove NO borra un producto con historial (D-07): queda inactivo, con presentaciones desactivadas', async () => {
    const { productos, manager, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1', presentaciones: [{ id: 'pres-1' }] });
    manager.query.mockResolvedValueOnce([{ '?column?': 1 }]); // hay precios
    manager.findOneOrFail.mockResolvedValueOnce({ id: 'p-1', estatus: 'inactivo' });

    const resultado = await servicio.remove('p-1');

    expect(resultado).toEqual({ eliminado: false, entidad: { id: 'p-1', estatus: 'inactivo' } });
    expect(manager.update).toHaveBeenCalledWith(ProductoEntity, { id: 'p-1' }, { estatus: 'inactivo' });
    expect(manager.update).toHaveBeenCalledWith(ProductoPresentacionEntity, { productoId: 'p-1' }, { activo: false });
    expect(manager.remove).not.toHaveBeenCalled();
  });

  it('CAT-11: rechaza una presentación con el mismo contenido físico aunque cambie el nombre o la unidad (500 g = Medio kilo = 0.5 kg)', async () => {
    const { productos, unidades, presentaciones, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1' });
    unidades.findOne.mockResolvedValue({ id: 2, clave: 'kg', tipo: 'masa', factorBase: '1' });
    presentaciones.find.mockResolvedValue([
      { nombre: '500 g', contenido: '500', unidadMedida: { clave: 'g', tipo: 'masa', factorBase: '0.001' } },
    ]);

    await expect(
      servicio.addPresentation('p-1', { nombre: 'Medio kilo', contenido: 0.5, unidadMedida: 'kg' }),
    ).rejects.toThrow(/mismo contenido: "500 g"/);
    expect(presentaciones.save).not.toHaveBeenCalled();
  });

  it('CAT-11: una presentación de OTRO tipo de unidad con el mismo número no es duplicada (500 ml vs 500 g)', async () => {
    const { productos, unidades, presentaciones, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1' });
    unidades.findOne.mockResolvedValue({ id: 3, clave: 'ml', tipo: 'volumen', factorBase: '0.001' });
    presentaciones.find.mockResolvedValue([
      { nombre: '500 g', contenido: '500', unidadMedida: { clave: 'g', tipo: 'masa', factorBase: '0.001' } },
    ]);

    await expect(
      servicio.addPresentation('p-1', { nombre: '500 ml', contenido: 500, unidadMedida: 'ml' }),
    ).resolves.toBeDefined();
  });

  it('CAT-11: el 409 del índice único dice el motivo real: nombre repetido o código de barras repetido', async () => {
    const { productos, unidades, presentaciones, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1' });
    unidades.findOne.mockResolvedValue({ id: 2, clave: 'kg', tipo: 'masa', factorBase: '1' });
    const con = (constraint: string) => Object.assign(errorSql('23505'), { constraint });

    presentaciones.save.mockRejectedValueOnce(con('producto_presentaciones_producto_id_nombre_key'));
    await expect(servicio.addPresentation('p-1', { nombre: '2 kg', contenido: 2, unidadMedida: 'kg' })).rejects.toThrow(/llamada "2 kg"/);

    presentaciones.save.mockRejectedValueOnce(con('producto_presentaciones_codigo_barras_key'));
    await expect(servicio.addPresentation('p-1', { nombre: '3 kg', contenido: 3, unidadMedida: 'kg', codigoBarras: '123' })).rejects.toThrow(/código de barras/);
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

  it('removePresentation lanza 404 si no existe', async () => {
    const { presentaciones, servicio } = crearServicio();
    presentaciones.findOne.mockResolvedValueOnce(null);
    await expect(servicio.removePresentation('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removePresentation borra la que no tiene historial y desactiva la que sí (D-07)', async () => {
    const { presentaciones, manager, servicio } = crearServicio();
    const pres = { id: 'pres-1' };
    presentaciones.findOne.mockResolvedValue(pres);

    expect(await servicio.removePresentation('pres-1')).toEqual({ eliminado: true });
    expect(manager.remove).toHaveBeenCalledWith(pres);

    manager.remove.mockClear();
    manager.query.mockResolvedValueOnce([{ '?column?': 1 }]);
    manager.findOneOrFail.mockResolvedValueOnce({ id: 'pres-1', activo: false });
    expect(await servicio.removePresentation('pres-1')).toEqual({
      eliminado: false,
      entidad: { id: 'pres-1', activo: false },
    });
    expect(manager.update).toHaveBeenCalledWith(ProductoPresentacionEntity, { id: 'pres-1' }, { activo: false });
    expect(manager.remove).not.toHaveBeenCalled();
  });
});

describe('ProductsService — editar la propuesta (CAT-14, D-11)', () => {
  const prov: SesionUsuario = { id: 'u2', email: 'ventas@lacteos.mx', rol: 'Proveedor', rolId: 7 };
  const propia = (extra: Record<string, unknown> = {}) => ({
    id: 'p-1',
    proveedorId: 'prov-1',
    estatus: 'pendiente_aprobacion',
    presentaciones: [{ id: 'pres-1', esPredeterminada: true }],
    ...extra,
  });

  it('edita producto y presentación en una transacción, con el UPDATE condicionado a que siga pendiente', async () => {
    const { proveedores, productos, unidades, manager, servicio } = crearServicio();
    proveedores.findOne.mockResolvedValue({ id: 'prov-1' });
    productos.findOne.mockResolvedValue(propia());
    unidades.findOne.mockResolvedValue({ id: 2, clave: 'g' });

    await servicio.editProposal('p-1', { nombre: 'Nuevo', presentacion: '450 g', contenido: 450, unidadMedida: 'g' }, prov);

    expect(manager.update).toHaveBeenCalledWith(ProductoEntity, { id: 'p-1', estatus: 'pendiente_aprobacion' }, { nombre: 'Nuevo' });
    expect(manager.update).toHaveBeenCalledWith(ProductoPresentacionEntity, { id: 'pres-1' }, { nombre: '450 g', contenido: '450', unidadMedidaId: 2 });
  });

  it('la propuesta de otro proveedor o inexistente es 404, no 403', async () => {
    const { proveedores, productos, servicio } = crearServicio();
    proveedores.findOne.mockResolvedValue({ id: 'prov-1' });

    productos.findOne.mockResolvedValueOnce(propia({ proveedorId: 'otro' }));
    await expect(servicio.editProposal('p-1', { nombre: 'x' }, prov)).rejects.toBeInstanceOf(NotFoundException);
    productos.findOne.mockResolvedValueOnce(null);
    await expect(servicio.editProposal('p-1', { nombre: 'x' }, prov)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('una propuesta ya resuelta no se edita (409) y el mensaje dice que haga una nueva', async () => {
    const { proveedores, productos, manager, servicio } = crearServicio();
    proveedores.findOne.mockResolvedValue({ id: 'prov-1' });

    for (const estatus of ['rechazado', 'activo']) {
      productos.findOne.mockResolvedValueOnce(propia({ estatus }));
      const error = await servicio.editProposal('p-1', { nombre: 'x' }, prov).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.message).toContain('propuesta nueva');
    }
    expect(manager.update).not.toHaveBeenCalled();
  });

  it('si el Gerente la resuelve justo entre la lectura y el UPDATE, no se pisa (409)', async () => {
    const { proveedores, productos, manager, servicio } = crearServicio();
    proveedores.findOne.mockResolvedValue({ id: 'prov-1' });
    productos.findOne.mockResolvedValue(propia());
    manager.update.mockResolvedValueOnce({ affected: 0 } as never);

    await expect(servicio.editProposal('p-1', { nombre: 'x' }, prov)).rejects.toBeInstanceOf(ConflictException);
  });

  it('un Proveedor ve el detalle de SU producto (aun pendiente) y el de otro es 404', async () => {
    const { proveedores, productos, servicio } = crearServicio();
    proveedores.findOne.mockResolvedValue({ id: 'prov-1' });
    productos.findOne.mockResolvedValue(propia());
    expect(await servicio.findOneVisible('p-1', prov)).toMatchObject({ id: 'p-1', estatus: 'pendiente_aprobacion' });

    productos.findOne.mockResolvedValue(propia({ proveedorId: 'otro' }));
    await expect(servicio.findOneVisible('p-1', prov)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProductsService — lectura según el perfil', () => {
  const interno: SesionUsuario = { id: 'u1', email: 'admin@retail.mx', rol: 'Administrador', rolId: 1 };
  const proveedor: SesionUsuario = { id: 'u2', email: 'ventas@lacteos.mx', rol: 'Proveedor', rolId: 7 };

  it('un perfil interno solo ve productos ACTIVOS (D-08), sin filtro por proveedor', async () => {
    const { productos, servicio } = crearServicio();
    const qb = crearQb();
    productos.createQueryBuilder.mockReturnValue(qb);

    await servicio.findAll(interno, {});

    expect(qb.where).toHaveBeenCalledTimes(1);
    expect(qb.where).toHaveBeenCalledWith('p.estatus = :activo', { activo: 'activo' });
  });

  it('el detalle de un producto pendiente es 404 para un Analista y visible para el Gerente', async () => {
    const { productos, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({ id: 'p-1', estatus: 'pendiente_aprobacion', presentaciones: [] });
    const analista: SesionUsuario = { id: 'u3', email: 'a@retail.mx', rol: 'Analista comercial', rolId: 2 };
    const gerente: SesionUsuario = { id: 'u4', email: 'g@retail.mx', rol: 'Gerente de categoría', rolId: 3 };

    await expect(servicio.findOneVisible('p-1', analista)).rejects.toBeInstanceOf(NotFoundException);
    expect(await servicio.findOneVisible('p-1', gerente)).toMatchObject({ id: 'p-1', estatus: 'pendiente_aprobacion' });
  });

  it('el detalle sale con las llaves en el orden del XSD (presentaciones al final)', async () => {
    const { productos, servicio } = crearServicio();
    productos.findOne.mockResolvedValue({
      id: 'p-1',
      presentaciones: [],
      categoria: { id: 1 },
      estatus: 'activo',
    });

    const llaves = Object.keys(await servicio.findOneVisible('p-1', interno));

    expect(llaves.indexOf('categoria')).toBeLessThan(llaves.indexOf('presentaciones'));
    expect(llaves.indexOf('updatedAt')).toBeLessThan(llaves.indexOf('categoria'));
    expect(llaves[llaves.length - 1]).toBe('presentaciones');
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
