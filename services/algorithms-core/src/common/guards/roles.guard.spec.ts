import { Reflector } from '@nestjs/core';
import { Roles } from '../decorators/roles.decorator';
import { ROL } from '../roles';
import { RolesGuard } from './roles.guard';

/**
 * Rutas de prueba con el decorador real: así se prueba que @Roles y el
 * guard funcionan juntos, no el guard aislado con metadatos inventados.
 */
class Rutas {
  consultar() {}

  @Roles(ROL.ADMINISTRADOR, ROL.ANALISTA)
  correrApriori() {}
}

function contexto(ruta: keyof Rutas, user?: { rol: string }) {
  return {
    getHandler: () => Rutas.prototype[ruta],
    getClass: () => Rutas,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe('RolesGuard (RBAC por ruta)', () => {
  const guard = new RolesGuard(new Reflector());

  it('deja pasar una ruta sin @Roles a cualquier usuario autenticado', () => {
    expect(guard.canActivate(contexto('consultar', { rol: ROL.AUDITOR }))).toBe(true);
  });

  it('deja pasar a un rol incluido en @Roles', () => {
    expect(guard.canActivate(contexto('correrApriori', { rol: ROL.ANALISTA }))).toBe(true);
  });

  it('rechaza a un rol que no está en @Roles (Planeador no crea corridas)', () => {
    expect(guard.canActivate(contexto('correrApriori', { rol: ROL.PLANEADOR }))).toBe(false);
  });

  it('rechaza si no hay usuario (SessionGuard olvidado o puesto después)', () => {
    expect(guard.canActivate(contexto('correrApriori'))).toBe(false);
  });
});
