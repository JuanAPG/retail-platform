import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { PERFILES_INTERNOS, ROL } from '../roles';

function contexto(rol: string | undefined, roles: readonly string[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn(() => roles),
  } as unknown as Reflector;
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: rol ? { rol } : undefined }) }),
  } as never;
  return { guard: new RolesGuard(reflector), ctx, reflector };
}

describe('RolesGuard', () => {
  it('deja pasar al rol listado en @Roles', () => {
    const { guard, ctx } = contexto(ROL.ANALISTA, [ROL.ADMINISTRADOR, ROL.ANALISTA]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rechaza a un rol que no está listado', () => {
    const { guard, ctx } = contexto(ROL.PROVEEDOR, [ROL.ADMINISTRADOR, ROL.ANALISTA]);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('rechaza cuando no hay usuario en la petición', () => {
    const { guard, ctx } = contexto(undefined, [ROL.ADMINISTRADOR]);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('una ruta sin @Roles no restringe por rol', () => {
    for (const roles of [undefined, []]) {
      const { guard, ctx } = contexto(ROL.PROVEEDOR, roles);
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('los seis perfiles internos pasan en las rutas de lectura', () => {
    for (const rol of PERFILES_INTERNOS) {
      const { guard, ctx } = contexto(rol, PERFILES_INTERNOS);
      expect(guard.canActivate(ctx)).toBe(true);
    }
    // El Proveedor es externo: no entra a las rutas internas.
    const { guard, ctx } = contexto(ROL.PROVEEDOR, PERFILES_INTERNOS);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('el nombre del rol se compara exacto (acentos y mayúsculas incluidos)', () => {
    const { guard, ctx } = contexto('analista comercial', [ROL.ANALISTA]);
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
