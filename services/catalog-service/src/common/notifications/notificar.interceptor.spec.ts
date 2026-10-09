import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { NotificarInterceptor } from './notificar.interceptor';

function armar(momento: 'propuesto' | 'resuelto' | undefined, body: Record<string, unknown> = {}) {
  const req = { headers: { authorization: 'Bearer t' }, body };
  const ctx = { getHandler: () => () => undefined, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  const reflector = { get: jest.fn(() => momento) } as unknown as Reflector;
  const dataSource = { query: jest.fn(async (): Promise<unknown[]> => [{ id: 'user-prov' }]) };
  const notificaciones = { emitir: jest.fn().mockResolvedValue(undefined) };
  const interceptor = new NotificarInterceptor(reflector, dataSource as never, notificaciones as never);
  return { ctx, interceptor, dataSource, notificaciones };
}

const correr = (i: NotificarInterceptor, ctx: ExecutionContext, h: CallHandler) => lastValueFrom(i.intercept(ctx, h));
const producto = (extra: Record<string, unknown> = {}) => ({ id: 'p-1', sku: 'SKU-1', nombre: 'Quinoa 500 g', estatus: 'pendiente_aprobacion', proveedor: { razonSocial: 'BioOrgánicos' }, ...extra });

describe('NotificarInterceptor (CAT-09)', () => {
  it('sin @NotificarProducto no hace nada', async () => {
    const { ctx, interceptor, notificaciones } = armar(undefined);
    await correr(interceptor, ctx, { handle: () => of(producto()) });
    expect(notificaciones.emitir).not.toHaveBeenCalled();
  });

  it('al proponer emite producto.propuesto con el token del Proveedor y SIN destinatario (lo fija el receptor: Gerente)', async () => {
    const { ctx, interceptor, notificaciones } = armar('propuesto');

    const r = await correr(interceptor, ctx, { handle: () => of(producto()) });

    expect(r).toMatchObject({ id: 'p-1' });
    const [evento, token] = notificaciones.emitir.mock.calls[0];
    expect(evento).toMatchObject({ eventType: 'producto.propuesto', relatedEntityType: 'producto', relatedEntityId: 'p-1' });
    expect(evento.message).toContain('BioOrgánicos');
    expect(evento.message).toContain('Quinoa 500 g');
    expect(evento).not.toHaveProperty('recipientUserId');
    expect(token).toBe('Bearer t');
  });

  it('al aprobar avisa al USUARIO que propuso (propuesta.resuelta), buscado por el correo de su empresa', async () => {
    const { ctx, interceptor, notificaciones, dataSource } = armar('resuelto');

    await correr(interceptor, ctx, { handle: () => of(producto({ estatus: 'activo' })) });

    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('u.email = pr.email'), ['p-1']);
    expect(notificaciones.emitir.mock.calls[0][0]).toMatchObject({
      eventType: 'propuesta.resuelta',
      recipientUserId: 'user-prov',
      title: 'Tu propuesta de producto fue aprobada',
      priority: 'info',
    });
  });

  it('al rechazar incluye el motivo y sube la prioridad a warning', async () => {
    const { ctx, interceptor, notificaciones } = armar('resuelto', { motivoRechazo: 'Falta la ficha técnica.' });

    await correr(interceptor, ctx, { handle: () => of(producto({ estatus: 'rechazado' })) });

    const evento = notificaciones.emitir.mock.calls[0][0];
    expect(evento.title).toBe('Tu propuesta de producto fue rechazada');
    expect(evento.message).toContain('Motivo: Falta la ficha técnica.');
    expect(evento.priority).toBe('warning');
  });

  it('un producto sin proveedor (alta directa) no genera aviso de resolución', async () => {
    const { ctx, interceptor, notificaciones, dataSource } = armar('resuelto');
    dataSource.query.mockResolvedValue([]);

    await correr(interceptor, ctx, { handle: () => of(producto({ estatus: 'activo', proveedor: null })) });

    expect(notificaciones.emitir).not.toHaveBeenCalled();
  });

  it('si la operación falla no se avisa; si notifications-service falla, la operación igual responde', async () => {
    const a = armar('propuesto');
    await expect(correr(a.interceptor, a.ctx, { handle: () => throwError(() => new Error('409')) })).rejects.toThrow('409');
    expect(a.notificaciones.emitir).not.toHaveBeenCalled();

    const b = armar('propuesto');
    b.notificaciones.emitir.mockRejectedValue(new Error('caído'));
    await expect(correr(b.interceptor, b.ctx, { handle: () => of(producto()) })).resolves.toMatchObject({ id: 'p-1' });
  });
});
