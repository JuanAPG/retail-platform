import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { SesionUsuario } from '../common/auth/session.guard';
import { PriceProposal } from '../entities/price-proposal.entity';
import { PricesService } from '../prices/prices.service';
import { PriceProposalsService } from './price-proposals.service';

const proveedorUsuario: SesionUsuario = { id: 'u-prov', email: 'ventas@lacteos.mx', rol: 'Proveedor', rolId: 7 };
const gerente: SesionUsuario = { id: 'u-ger', email: 'g@retail.mx', rol: 'Gerente de categoría', rolId: 3 };
const interno: SesionUsuario = { id: 'u-adm', email: 'a@retail.mx', rol: 'Administrador', rolId: 1 };

const errorSql = (code: string) => Object.assign(new QueryFailedError('q', [], new Error('x')), { code });

function filaPropuesta(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    presentacion_id: 'pres-1',
    proveedor_id: 'prov-1',
    precio: '38.00',
    unidad_compra: 'caja 12 pzas',
    estatus: 'pendiente',
    motivo_rechazo: null,
    revisado_por: null,
    revisado_en: null,
    created_at: new Date('2026-09-30T15:00:00Z'),
    producto_id: 'prod-1',
    pres_nombre: '400 g',
    contenido: '400.000',
    unidad: 'g',
    sku: 'LDN-QUE-400',
    producto_nombre: 'Queso fresco',
    razon_social: 'Lácteos del Norte',
    ...extra,
  };
}

function crearServicio() {
  const repo = {
    findOne: jest.fn(),
    save: jest.fn(async (x) => ({ id: 'prop-nueva', ...x })),
    create: jest.fn((x) => ({ ...x })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(),
  };
  const manager = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const audit = { reportar: jest.fn().mockResolvedValue(undefined) };
  let contador = 0;
  const prices = {
    registrarPrecio: jest.fn<Promise<{ id: string; precioPrevio: string | null }>, [unknown, Record<string, string>]>(
      async () => ({ id: `precio-${++contador}`, precioPrevio: '40.00' }),
    ),
    detallar: jest.fn(async (ids: string[]) => ids.map((id) => ({ id }))),
    invalidarProducto: jest.fn().mockResolvedValue(undefined),
  };
  const servicio = new PriceProposalsService(
    repo as unknown as Repository<PriceProposal>,
    dataSource as unknown as DataSource,
    audit as unknown as AuditReporter,
    prices as unknown as PricesService,
  );
  return { repo, manager, dataSource, audit, prices, servicio };
}

describe('PriceProposalsService.create', () => {
  const dto = { presentationId: 'pres-1', proposedPrice: 38, purchaseUnit: 'caja' };

  /** proveedor de la cuenta + presentación que sí es de su empresa y está activa. */
  function escenarioValido(ctx: ReturnType<typeof crearServicio>) {
    ctx.dataSource.query
      .mockResolvedValueOnce([{ id: 'prov-1', activo: true }])
      .mockResolvedValueOnce([{ proveedor_id: 'prov-1', estatus: 'activo' }]);
    ctx.repo.findOne.mockResolvedValue(null);
  }

  it('una cuenta Proveedor sin empresa vinculada recibe 403', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([]);

    await expect(servicio.create(dto, proveedorUsuario)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('una empresa inactiva no puede proponer (403)', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ id: 'prov-1', activo: false }]);

    await expect(servicio.create(dto, proveedorUsuario)).rejects.toThrow(/inactiva/);
  });

  it('una presentación inexistente responde 400', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query.mockResolvedValueOnce([{ id: 'prov-1', activo: true }]).mockResolvedValueOnce([]);

    await expect(servicio.create(dto, proveedorUsuario)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no puede proponer sobre un producto de OTRA empresa (403)', async () => {
    const { dataSource, repo, servicio } = crearServicio();
    dataSource.query
      .mockResolvedValueOnce([{ id: 'prov-1', activo: true }])
      .mockResolvedValueOnce([{ proveedor_id: 'otra-empresa', estatus: 'activo' }]);

    await expect(servicio.create(dto, proveedorUsuario)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('un producto que aún no está activo responde 409', async () => {
    const { dataSource, servicio } = crearServicio();
    dataSource.query
      .mockResolvedValueOnce([{ id: 'prov-1', activo: true }])
      .mockResolvedValueOnce([{ proveedor_id: 'prov-1', estatus: 'pendiente_aprobacion' }]);

    await expect(servicio.create(dto, proveedorUsuario)).rejects.toBeInstanceOf(ConflictException);
  });

  it('ya tener una propuesta pendiente para la presentación responde 409', async () => {
    const ctx = crearServicio();
    escenarioValido(ctx);
    ctx.repo.findOne.mockResolvedValue({ id: 'existente' });

    await expect(ctx.servicio.create(dto, proveedorUsuario)).rejects.toThrow(/pendiente/);
    expect(ctx.repo.save).not.toHaveBeenCalled();
  });

  it('guarda la propuesta pendiente, ligada a la empresa del token, y la reporta a auditoría', async () => {
    const ctx = crearServicio();
    escenarioValido(ctx);
    ctx.dataSource.query.mockResolvedValueOnce([filaPropuesta('prop-nueva')]);

    const resultado = await ctx.servicio.create(dto, proveedorUsuario, '172.18.0.4', 'Bearer t-prov');

    expect(ctx.repo.create).toHaveBeenCalledWith({
      presentationId: 'pres-1',
      supplierId: 'prov-1',
      proposedPrice: '38',
      purchaseUnit: 'caja',
      status: 'pendiente',
    });
    expect(ctx.audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({
        tabla: 'precios_propuestos_proveedor',
        registroId: 'prop-nueva',
        accion: 'insert',
        ip: '172.18.0.4',
      }),
      'Bearer t-prov',
    );
    expect(resultado).toMatchObject({ id: 'prop-nueva', status: 'pendiente', supplier: { razonSocial: 'Lácteos del Norte' } });
  });
});

describe('PriceProposalsService.findAll', () => {
  function qb() {
    const q: Record<string, jest.Mock> = {};
    for (const m of ['andWhere', 'orderBy', 'addOrderBy', 'skip', 'take']) q[m] = jest.fn().mockReturnValue(q);
    q.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
    return q;
  }

  it('un perfil interno ve todas (sin filtro por proveedor)', async () => {
    const { repo, servicio } = crearServicio();
    const q = qb();
    repo.createQueryBuilder.mockReturnValue(q);

    await servicio.findAll(interno, {});

    expect(q.andWhere).not.toHaveBeenCalled();
    expect(q.orderBy).toHaveBeenCalledWith('pp.createdAt', 'DESC');
  });

  it('un Proveedor solo recibe las de su empresa, filtrado en la consulta', async () => {
    const { repo, dataSource, servicio } = crearServicio();
    const q = qb();
    repo.createQueryBuilder.mockReturnValue(q);
    dataSource.query.mockResolvedValueOnce([{ id: 'prov-1', activo: true }]);

    await servicio.findAll(proveedorUsuario, {});

    expect(q.andWhere).toHaveBeenCalledWith('pp.supplierId = :supplierId', { supplierId: 'prov-1' });
  });

  it('un Proveedor inactivo todavía puede consultar sus propuestas', async () => {
    const { repo, dataSource, servicio } = crearServicio();
    repo.createQueryBuilder.mockReturnValue(qb());
    dataSource.query.mockResolvedValueOnce([{ id: 'prov-1', activo: false }]);

    await expect(servicio.findAll(proveedorUsuario, {})).resolves.toMatchObject({ total: 0 });
  });

  it('con status=pendiente es una cola: la más antigua primero', async () => {
    const { repo, servicio } = crearServicio();
    const q = qb();
    repo.createQueryBuilder.mockReturnValue(q);

    await servicio.findAll(interno, { status: 'pendiente' });

    expect(q.andWhere).toHaveBeenCalledWith('pp.status = :status', { status: 'pendiente' });
    expect(q.orderBy).toHaveBeenCalledWith('pp.createdAt', 'ASC');
  });
});

describe('PriceProposalsService.approve', () => {
  const pendiente = { id: 'prop-1', presentationId: 'pres-1', proposedPrice: '38.00', status: 'pendiente' };
  const dto = { storeIds: ['t1', 't2'], effectiveDate: '2026-10-05' };

  function escenarioValido(ctx: ReturnType<typeof crearServicio>) {
    ctx.repo.findOne.mockResolvedValue(pendiente);
    ctx.dataSource.query
      .mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]) // tiendas existen
      .mockResolvedValueOnce([filaPropuesta('prop-1', { estatus: 'aprobado' })]); // detalle final
  }

  it('una propuesta inexistente responde 404 y una ya resuelta 409', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValueOnce(null);
    await expect(servicio.approve('x', dto, gerente)).rejects.toBeInstanceOf(NotFoundException);

    repo.findOne.mockResolvedValueOnce({ ...pendiente, status: 'rechazado' });
    await expect(servicio.approve('x', dto, gerente)).rejects.toBeInstanceOf(ConflictException);
  });

  it('tiendas inexistentes responde 400 y nombra cuáles', async () => {
    const { repo, dataSource, dataSource: ds, servicio } = crearServicio();
    repo.findOne.mockResolvedValue(pendiente);
    dataSource.query.mockResolvedValueOnce([{ id: 't1' }]);

    await expect(servicio.approve('prop-1', dto, gerente)).rejects.toThrow(/t2/);
    expect(ds.transaction).not.toHaveBeenCalled();
  });

  it('aplica el precio propuesto a cada tienda, con origen de propuesta y al revisor como autor', async () => {
    const ctx = crearServicio();
    escenarioValido(ctx);

    const resultado = await ctx.servicio.approve('prop-1', dto, gerente, '10.0.0.1');

    expect(ctx.prices.registrarPrecio).toHaveBeenCalledTimes(2);
    expect(ctx.prices.registrarPrecio).toHaveBeenNthCalledWith(1, ctx.manager, {
      presentationId: 'pres-1',
      storeId: 't1',
      price: '38.00',
      effectiveDate: '2026-10-05',
      origen: 'propuesta_proveedor_aprobada',
      createdBy: 'u-ger',
    });
    expect(ctx.prices.registrarPrecio.mock.calls[1][1]).toMatchObject({ storeId: 't2' });
    expect(resultado.prices.map((p) => p.id)).toEqual(['precio-1', 'precio-2']);
    expect(resultado.proposal.id).toBe('prop-1');
  });

  it('la propuesta se marca aprobada con una condición atómica (solo si sigue pendiente), en la misma transacción', async () => {
    const ctx = crearServicio();
    escenarioValido(ctx);

    await ctx.servicio.approve('prop-1', dto, gerente);

    expect(ctx.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(ctx.manager.update).toHaveBeenCalledWith(
      PriceProposal,
      { id: 'prop-1', status: 'pendiente' },
      expect.objectContaining({ status: 'aprobado', reviewedBy: 'u-ger' }),
    );
  });

  it('si otro revisor ganó la carrera (0 filas afectadas) responde 409 y no crea precios', async () => {
    const ctx = crearServicio();
    ctx.repo.findOne.mockResolvedValue(pendiente);
    ctx.dataSource.query.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]);
    ctx.manager.update.mockResolvedValue({ affected: 0 });

    await expect(ctx.servicio.approve('prop-1', dto, gerente)).rejects.toThrow(/otro revisor/);
    expect(ctx.prices.registrarPrecio).not.toHaveBeenCalled();
    expect(ctx.audit.reportar).not.toHaveBeenCalled();
  });

  it('si una tienda tiene un precio vigente más reciente, responde 409 indicando cuál y no audita ni invalida', async () => {
    const ctx = crearServicio();
    ctx.repo.findOne.mockResolvedValue(pendiente);
    ctx.dataSource.query.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]);
    ctx.prices.registrarPrecio
      .mockResolvedValueOnce({ id: 'precio-1', precioPrevio: null })
      .mockRejectedValueOnce(new ConflictException('Ya existe un precio vigente con fecha igual o posterior a la indicada.'));

    await expect(ctx.servicio.approve('prop-1', dto, gerente)).rejects.toThrow(/tienda t2.*ningún precio/s);
    expect(ctx.audit.reportar).not.toHaveBeenCalled();
    expect(ctx.prices.invalidarProducto).not.toHaveBeenCalled();
  });

  it('un registro simultáneo (23505) responde 409', async () => {
    const ctx = crearServicio();
    ctx.repo.findOne.mockResolvedValue(pendiente);
    ctx.dataSource.query.mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }]);
    ctx.prices.registrarPrecio.mockRejectedValueOnce(errorSql('23505'));

    await expect(ctx.servicio.approve('prop-1', dto, gerente)).rejects.toThrow(/al mismo tiempo/);
  });

  it('audita la resolución y cada precio creado, e invalida la caché del producto, solo después de confirmar', async () => {
    const ctx = crearServicio();
    escenarioValido(ctx);

    await ctx.servicio.approve('prop-1', dto, gerente);

    const eventos = ctx.audit.reportar.mock.calls.map((c) => c[0]);
    expect(eventos).toHaveLength(3); // 1 de la propuesta + 2 precios
    expect(eventos[0]).toMatchObject({ tabla: 'precios_propuestos_proveedor', accion: 'update', registroId: 'prop-1' });
    expect(eventos[1]).toMatchObject({ tabla: 'precios', accion: 'insert', registroId: 'precio-1' });
    expect(eventos[1].cambios).toEqual([
      { campo: 'precio_anterior', previo: '40.00', posterior: null },
      { campo: 'precio', previo: null, posterior: '38.00' },
    ]);
    expect(ctx.prices.invalidarProducto).toHaveBeenCalledWith('prod-1');
    expect(ctx.dataSource.transaction.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.audit.reportar.mock.invocationCallOrder[0],
    );
  });

  it('sin fecha usa hoy y normaliza un ISO con hora', async () => {
    const ctx = crearServicio();
    escenarioValido(ctx);
    await ctx.servicio.approve('prop-1', { storeIds: ['t1', 't2'] }, gerente);
    expect(ctx.prices.registrarPrecio.mock.calls[0][1].effectiveDate).toBe(new Date().toISOString().slice(0, 10));

    const otra = crearServicio();
    escenarioValido(otra);
    await otra.servicio.approve('prop-1', { storeIds: ['t1', 't2'], effectiveDate: '2026-10-05T23:30:00Z' }, gerente);
    expect(otra.prices.registrarPrecio.mock.calls[0][1].effectiveDate).toBe('2026-10-05');
  });
});

describe('PriceProposalsService.reject', () => {
  const pendiente = { id: 'prop-1', status: 'pendiente' };
  const dto = { rejectionReason: 'Excede el límite de variación de la zona.' };

  it('una propuesta inexistente responde 404 y una ya resuelta 409', async () => {
    const { repo, servicio } = crearServicio();
    repo.findOne.mockResolvedValueOnce(null);
    await expect(servicio.reject('x', dto, gerente)).rejects.toBeInstanceOf(NotFoundException);

    repo.findOne.mockResolvedValueOnce({ ...pendiente, status: 'aprobado' });
    await expect(servicio.reject('x', dto, gerente)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza con motivo, revisor y fecha, con condición atómica de seguir pendiente', async () => {
    const { repo, dataSource, audit, servicio } = crearServicio();
    repo.findOne.mockResolvedValue(pendiente);
    dataSource.query.mockResolvedValueOnce([filaPropuesta('prop-1', { estatus: 'rechazado' })]);

    const resultado = await servicio.reject('prop-1', dto, gerente);

    expect(repo.update).toHaveBeenCalledWith(
      { id: 'prop-1', status: 'pendiente' },
      expect.objectContaining({ status: 'rechazado', rejectionReason: dto.rejectionReason, reviewedBy: 'u-ger' }),
    );
    expect(audit.reportar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'precios_propuestos_proveedor', accion: 'update', registroId: 'prop-1' }),
      undefined,
    );
    expect(resultado.status).toBe('rechazado');
  });

  it('si otro revisor ganó la carrera responde 409 y no audita', async () => {
    const { repo, audit, servicio } = crearServicio();
    repo.findOne.mockResolvedValue(pendiente);
    repo.update.mockResolvedValue({ affected: 0 });

    await expect(servicio.reject('prop-1', dto, gerente)).rejects.toBeInstanceOf(ConflictException);
    expect(audit.reportar).not.toHaveBeenCalled();
  });
});
