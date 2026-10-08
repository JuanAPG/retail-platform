import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PriceObservationsService } from './price-observations.service';

const capturador = { id: 'u-cap', email: 'a@retail.mx', rol: 'Analista comercial', rolId: 2 };
const revisor = { id: 'u-prec', email: 'p@retail.mx', rol: 'Responsable de precios', rolId: 4 };
const dto = { presentationId: 'pres-1', storeId: 't-1', price: 27.5, lat: 25.68, lng: -100.31 };

function fila(extra: Record<string, unknown> = {}) {
  return {
    id: 'obs-1', presentacion_id: 'pres-1', tienda_id: 't-1', precio: '27.50', observado_en: new Date('2026-10-08T15:00:00Z'),
    lat: 25.68, lng: -100.31, estatus: 'pendiente', motivo_rechazo: null, capturado_por: 'u-cap', revisado_por: null,
    revisado_en: null, precio_id: null, created_at: new Date(), producto_id: 'prod-1', pres_nombre: '1 L', sku: 'LDN-LEC',
    prod_nombre: 'Leche entera', tienda_nombre: 'Super Valle', zona_id: 'z-1', ...extra,
  };
}

function armar() {
  const manager = { query: jest.fn(async (_sql: string, _params?: unknown[]): Promise<any> => []) };
  const dataSource = {
    query: jest.fn(async (_sql: string, _params?: unknown[]): Promise<any> => []),
    transaction: jest.fn(async (fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const audit = { reportar: jest.fn().mockResolvedValue(undefined) };
  const prices = {
    registrarPrecio: jest.fn(async () => ({ id: 'precio-1', precioPrevio: '25.00' })),
    invalidarProducto: jest.fn().mockResolvedValue(undefined),
  };
  const alertas = { evaluar: jest.fn().mockResolvedValue({ alerta: false }) };
  const servicio = new PriceObservationsService(dataSource as never, audit as never, prices as never, alertas as never);
  return { servicio, dataSource, manager, audit, prices, alertas };
}

/** `create` consulta: presentación (con estatus del producto), tienda, INSERT, detalle. */
function preparaCreate(ctx: ReturnType<typeof armar>, estatus = 'activo') {
  ctx.dataSource.query
    .mockResolvedValueOnce([{ estatus }])
    .mockResolvedValueOnce([{ '?column?': 1 }])
    .mockResolvedValueOnce([{ id: 'obs-1' }])
    .mockResolvedValueOnce([fila()]);
}

describe('PriceObservationsService.create (PRI-09, D-16)', () => {
  it('nace pendiente con el usuario del token como autor, marcada observado_en_campo y auditada', async () => {
    const ctx = armar();
    preparaCreate(ctx);

    const r = await ctx.servicio.create(dto, capturador, '10.0.0.1', 'Bearer t');

    const insert = ctx.dataSource.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO precios_observados'))!;
    expect(insert[1]).toEqual(['pres-1', 't-1', 27.5, expect.any(Date), 25.68, -100.31, 'u-cap']);
    expect(r).toMatchObject({ status: 'pendiente', origin: 'observado_en_campo', priceId: null, capturedBy: 'u-cap' });
    const [evento] = ctx.audit.reportar.mock.calls[0];
    expect(evento).toMatchObject({ tabla: 'precios_observados', accion: 'insert', registroId: 'obs-1' });
    expect(evento.cambios).toContainEqual({ campo: 'origen', previo: null, posterior: 'observado_en_campo' });
    expect(evento.cambios).toContainEqual({ campo: 'capturado_por', previo: null, posterior: 'u-cap' });
  });

  it('una observación pendiente NO toca el historial de precios ni invalida la caché', async () => {
    const ctx = armar();
    preparaCreate(ctx);
    await ctx.servicio.create(dto, capturador);
    expect(ctx.prices.registrarPrecio).not.toHaveBeenCalled();
    expect(ctx.prices.invalidarProducto).not.toHaveBeenCalled();
  });

  it('rechaza presentación o tienda inexistente (400) y producto no activo (409, D-08)', async () => {
    const a = armar();
    await expect(a.servicio.create(dto, capturador)).rejects.toBeInstanceOf(BadRequestException); // presentación

    const b = armar();
    b.dataSource.query.mockResolvedValueOnce([{ estatus: 'activo' }]).mockResolvedValueOnce([]);
    await expect(b.servicio.create(dto, capturador)).rejects.toBeInstanceOf(BadRequestException); // tienda

    const c = armar();
    c.dataSource.query.mockResolvedValueOnce([{ estatus: 'pendiente_aprobacion' }]).mockResolvedValueOnce([{ x: 1 }]);
    await expect(c.servicio.create(dto, capturador)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza una fecha futura y lat sin lng (400)', async () => {
    const a = armar();
    a.dataSource.query.mockResolvedValueOnce([{ estatus: 'activo' }]).mockResolvedValueOnce([{ x: 1 }]);
    const manana = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await expect(a.servicio.create({ ...dto, observedAt: manana }, capturador)).rejects.toThrow(/futura/);

    const b = armar();
    b.dataSource.query.mockResolvedValueOnce([{ estatus: 'activo' }]).mockResolvedValueOnce([{ x: 1 }]);
    await expect(b.servicio.create({ ...dto, lng: undefined }, capturador)).rejects.toThrow(/lat y lng van juntas/);
  });
});

describe('PriceObservationsService.approve / reject', () => {
  const pendiente = { id: 'obs-1', presentacion_id: 'pres-1', tienda_id: 't-1', precio: '27.50', capturado_por: 'u-cap', estatus: 'pendiente' };

  it('aprobar registra un precio NORMAL (origen interno) con quien aprueba como autor, y ata el precio a la observación', async () => {
    const ctx = armar();
    ctx.dataSource.query.mockResolvedValueOnce([pendiente]).mockResolvedValueOnce([fila({ estatus: 'aprobado', precio_id: 'precio-1' })]);
    ctx.manager.query.mockResolvedValueOnce([[], 1]).mockResolvedValueOnce([]);

    const r = await ctx.servicio.approve('obs-1', { effectiveDate: '2026-10-09' }, revisor, '10.0.0.1', 'Bearer t');

    expect(ctx.dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(ctx.prices.registrarPrecio).toHaveBeenCalledWith(ctx.manager, {
      presentationId: 'pres-1', storeId: 't-1', price: '27.50', effectiveDate: '2026-10-09', origen: 'interno', createdBy: 'u-prec',
    });
    expect(ctx.manager.query.mock.calls[1][1]).toEqual(['obs-1', 'precio-1']);
    expect(r).toMatchObject({ status: 'aprobado', priceId: 'precio-1' });
    expect(ctx.prices.invalidarProducto).toHaveBeenCalledWith('prod-1');
    expect(ctx.alertas.evaluar).toHaveBeenCalledWith({ presentationId: 'pres-1', storeId: 't-1', nuevoPrecio: 27.5, effectiveDate: '2026-10-09' }, 'Bearer t');
  });

  it('la auditoría de aprobar dice "observado en campo", quién capturó y quién aprobó; y el precio creado también', async () => {
    const ctx = armar();
    ctx.dataSource.query.mockResolvedValueOnce([pendiente]).mockResolvedValueOnce([fila({ estatus: 'aprobado' })]);
    ctx.manager.query.mockResolvedValueOnce([[], 1]).mockResolvedValueOnce([]);

    await ctx.servicio.approve('obs-1', {}, revisor, undefined, 'Bearer t');

    const eventos = ctx.audit.reportar.mock.calls.map(([e]) => e);
    const obs = eventos.find((e) => e.tabla === 'precios_observados')!;
    expect(obs).toMatchObject({ accion: 'aprobar', registroId: 'obs-1' });
    expect(obs.cambios).toEqual(expect.arrayContaining([
      { campo: 'origen', previo: null, posterior: 'observado_en_campo' },
      { campo: 'capturado_por', previo: null, posterior: 'u-cap' },
      { campo: 'aprobado_por', previo: null, posterior: 'u-prec' },
    ]));
    const precio = eventos.find((e) => e.tabla === 'precios')!;
    expect(precio).toMatchObject({ accion: 'insert', registroId: 'precio-1' });
    expect(precio.cambios).toContainEqual({ campo: 'origen', previo: null, posterior: 'observado_en_campo' });
  });

  it('si otro revisor ganó la carrera (0 filas) responde 409 y no crea precio', async () => {
    const ctx = armar();
    ctx.dataSource.query.mockResolvedValueOnce([pendiente]);
    ctx.manager.query.mockResolvedValueOnce([[], 0]);

    await expect(ctx.servicio.approve('obs-1', {}, revisor)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.prices.registrarPrecio).not.toHaveBeenCalled();
    expect(ctx.audit.reportar).not.toHaveBeenCalled();
  });

  it('una observación inexistente es 404 y una ya resuelta 409', async () => {
    const a = armar();
    await expect(a.servicio.approve('x', {}, revisor)).rejects.toBeInstanceOf(NotFoundException);
    const b = armar();
    b.dataSource.query.mockResolvedValueOnce([{ ...pendiente, estatus: 'rechazado' }]);
    await expect(b.servicio.reject('x', { rejectionReason: 'x'.repeat(12) }, revisor)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechazar guarda el motivo, no crea precio y audita rechazar con origen observado_en_campo', async () => {
    const ctx = armar();
    ctx.dataSource.query.mockResolvedValueOnce([pendiente]).mockResolvedValueOnce([[], 1]).mockResolvedValueOnce([fila({ estatus: 'rechazado', motivo_rechazo: 'La foto no coincide.' })]);

    const r = await ctx.servicio.reject('obs-1', { rejectionReason: 'La foto no coincide.' }, revisor, undefined, 'Bearer t');

    expect(r).toMatchObject({ status: 'rechazado', rejectionReason: 'La foto no coincide.' });
    expect(ctx.prices.registrarPrecio).not.toHaveBeenCalled();
    const [evento] = ctx.audit.reportar.mock.calls[0];
    expect(evento).toMatchObject({ tabla: 'precios_observados', accion: 'rechazar' });
    expect(evento.cambios).toContainEqual({ campo: 'origen', previo: null, posterior: 'observado_en_campo' });
    expect(evento.cambios).toContainEqual({ campo: 'rechazado_por', previo: null, posterior: 'u-prec' });
  });
});

describe('PriceObservationsService.findAll', () => {
  it('el Analista solo ve las que capturó; el Responsable ve todas', async () => {
    const a = armar();
    a.dataSource.query.mockResolvedValueOnce([{ n: 0 }]).mockResolvedValueOnce([]);
    await a.servicio.findAll(capturador, { status: 'pendiente' });
    const conteo = a.dataSource.query.mock.calls[0];
    expect(String(conteo[0])).toContain('po.capturado_por = $2');
    expect(conteo[1]).toEqual(['pendiente', 'u-cap']);

    const b = armar();
    b.dataSource.query.mockResolvedValueOnce([{ n: 0 }]).mockResolvedValueOnce([]);
    await b.servicio.findAll(revisor, {});
    expect(String(b.dataSource.query.mock.calls[0][0])).not.toContain('capturado_por');
  });

  it('la cola pendiente va de la más antigua a la más reciente; el resto, al revés', async () => {
    const a = armar();
    a.dataSource.query.mockResolvedValueOnce([{ n: 0 }]).mockResolvedValueOnce([]);
    await a.servicio.findAll(revisor, { status: 'pendiente' });
    expect(String(a.dataSource.query.mock.calls[1][0])).toContain('ORDER BY po.created_at ASC');

    const b = armar();
    b.dataSource.query.mockResolvedValueOnce([{ n: 0 }]).mockResolvedValueOnce([]);
    await b.servicio.findAll(revisor, {});
    expect(String(b.dataSource.query.mock.calls[1][0])).toContain('ORDER BY po.created_at DESC');
  });
});
