import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AuditarInterceptor } from './auditar.interceptor';

function contexto(req: Record<string, unknown>, meta: unknown) {
  const handler = () => undefined;
  const reflector = { get: jest.fn(() => meta) } as unknown as Reflector;
  const ctx = { getHandler: () => handler, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { ctx, reflector };
}

function armar(meta: unknown, req: Record<string, unknown>, filas: Array<Record<string, unknown> | undefined>) {
  const { ctx, reflector } = contexto(req, meta);
  const consultas: unknown[][] = [];
  const dataSource = {
    query: jest.fn(async (_sql: string, params: unknown[]) => {
      consultas.push(params);
      const f = filas.shift();
      return f ? [f] : [];
    }),
  };
  const audit = { reportar: jest.fn().mockResolvedValue(undefined) };
  const interceptor = new AuditarInterceptor(reflector, dataSource as never, audit as never);
  return { ctx, interceptor, dataSource, audit, consultas };
}

const req = (extra: Record<string, unknown> = {}) => ({
  params: {},
  body: {},
  headers: { authorization: 'Bearer t' },
  ip: '10.0.0.1',
  ...extra,
});

const correr = (interceptor: AuditarInterceptor, ctx: ExecutionContext, handler: CallHandler) =>
  lastValueFrom(interceptor.intercept(ctx, handler));

describe('AuditarInterceptor (CAT-08)', () => {
  it('sin @Auditar en el handler no hace nada', async () => {
    const { ctx, interceptor, audit, dataSource } = armar(undefined, req(), []);
    const r = await correr(interceptor, ctx, { handle: () => of({ id: 'x' }) });
    expect(r).toEqual({ id: 'x' });
    expect(audit.reportar).not.toHaveBeenCalled();
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('una edición reporta SOLO las columnas que cambiaron, con valor previo y posterior, el token y la ip', async () => {
    const antes = { id: 'p-1', nombre: 'Arroz', estatus: 'activo', updated_at: new Date('2026-01-01') };
    const despues = { id: 'p-1', nombre: 'Arroz integral', estatus: 'activo', updated_at: new Date('2026-02-02') };
    const { ctx, interceptor, audit } = armar({ tabla: 'productos', accion: 'update', idDe: 'ruta' }, req({ params: { id: 'p-1' } }), [antes, despues]);

    const r = await correr(interceptor, ctx, { handle: () => of({ id: 'p-1' }) });

    expect(r).toEqual({ id: 'p-1' }); // la respuesta pasa tal cual
    expect(audit.reportar).toHaveBeenCalledTimes(1);
    const [evento, token] = audit.reportar.mock.calls[0];
    expect(evento).toMatchObject({ tabla: 'productos', registroId: 'p-1', accion: 'update', ip: '10.0.0.1' });
    expect(evento.cambios).toEqual([{ campo: 'nombre', previo: 'Arroz', posterior: 'Arroz integral' }]); // updated_at no cuenta
    expect(token).toBe('Bearer t');
  });

  it('un alta toma el id de la respuesta y no lleva "previo"', async () => {
    const { ctx, interceptor, audit, consultas } = armar({ tabla: 'tiendas', accion: 'insert', idDe: 'ruta' }, req(), [{ id: 't-9', nombre: 'Nueva', activo: true }]);

    await correr(interceptor, ctx, { handle: () => of({ id: 't-9' }) });

    expect(consultas).toEqual([['t-9']]); // una sola lectura: la de después
    const evento = audit.reportar.mock.calls[0][0];
    expect(evento).toMatchObject({ tabla: 'tiendas', registroId: 't-9', accion: 'insert' });
    expect(evento.cambios).toContainEqual({ campo: 'nombre', previo: null, posterior: 'Nueva' });
  });

  it('un alta anidada (presentación de un producto) usa el id de la RESPUESTA, no el :id de la ruta', async () => {
    const { ctx, interceptor, audit } = armar(
      { tabla: 'producto_presentaciones', accion: 'insert', idDe: 'respuesta' },
      req({ params: { id: 'producto-1' } }),
      [{ id: 'pres-5', nombre: '500 g' }],
    );

    await correr(interceptor, ctx, { handle: () => of({ id: 'pres-5' }) });

    expect(audit.reportar.mock.calls[0][0]).toMatchObject({ tabla: 'producto_presentaciones', registroId: 'pres-5' });
  });

  it('un DELETE que borró de verdad se reporta como delete; el que solo desactivó, como desactivar (D-07)', async () => {
    const borrado = armar({ tabla: 'tiendas', accion: 'delete', idDe: 'ruta' }, req({ params: { id: 't-1' } }), [{ id: 't-1', activo: true }, undefined]);
    await correr(borrado.interceptor, borrado.ctx, { handle: () => of(undefined) });
    expect(borrado.audit.reportar.mock.calls[0][0]).toMatchObject({ accion: 'delete', registroId: 't-1' });

    const desactivado = armar({ tabla: 'tiendas', accion: 'delete', idDe: 'ruta' }, req({ params: { id: 't-2' } }), [
      { id: 't-2', activo: true },
      { id: 't-2', activo: false },
    ]);
    await correr(desactivado.interceptor, desactivado.ctx, { handle: () => of({ id: 't-2', activo: false }) });
    const evento = desactivado.audit.reportar.mock.calls[0][0];
    expect(evento).toMatchObject({ accion: 'desactivar', registroId: 't-2' });
    expect(evento.cambios).toEqual([{ campo: 'activo', previo: 'true', posterior: 'false' }]);
  });

  it('aprobar y rechazar dejan el cambio de estatus y, al rechazar, el motivo', async () => {
    const { ctx, interceptor, audit } = armar(
      { tabla: 'productos', accion: 'rechazar', idDe: 'ruta' },
      req({ params: { id: 'p-1' }, body: { motivoRechazo: 'Falta la ficha técnica.' } }),
      [{ id: 'p-1', estatus: 'pendiente_aprobacion' }, { id: 'p-1', estatus: 'rechazado' }],
    );

    await correr(interceptor, ctx, { handle: () => of({ id: 'p-1' }) });

    const evento = audit.reportar.mock.calls[0][0];
    expect(evento).toMatchObject({ accion: 'rechazar' });
    expect(evento.descripcion).toContain('Falta la ficha técnica.');
    expect(evento.cambios).toEqual([{ campo: 'estatus', previo: 'pendiente_aprobacion', posterior: 'rechazado' }]);
  });

  it('si la operación falla (4xx/5xx) NO se reporta nada y el error sigue su camino', async () => {
    const { ctx, interceptor, audit } = armar({ tabla: 'productos', accion: 'update', idDe: 'ruta' }, req({ params: { id: 'p-1' } }), [{ id: 'p-1' }]);

    await expect(correr(interceptor, ctx, { handle: () => throwError(() => new Error('409')) })).rejects.toThrow('409');
    expect(audit.reportar).not.toHaveBeenCalled();
  });

  it('con audit-service caído (el reporter lanza) la operación igual responde', async () => {
    const { ctx, interceptor, audit } = armar({ tabla: 'zonas', accion: 'insert', idDe: 'ruta' }, req(), [{ id: 'z-1' }]);
    audit.reportar.mockRejectedValue(new Error('audit caído'));

    await expect(correr(interceptor, ctx, { handle: () => of({ id: 'z-1' }) })).resolves.toEqual({ id: 'z-1' });
  });
});
