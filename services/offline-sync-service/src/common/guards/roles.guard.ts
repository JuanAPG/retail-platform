import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

/** `@Roles(ROL.X, ROL.Y)`: usa SIEMPRE la constante `ROL`, nunca literales. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** El usuario que dejó `SessionGuard` en `request.user`. */
export const UsuarioActual = createParamDecorator((_dato: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user);

/**
 * RBAC por ruta. Va SIEMPRE después de `SessionGuard` (necesita
 * `request.user`). El rol sale del token verificado, nunca del cuerpo.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permitidos = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!permitidos || permitidos.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    if (permitidos.includes(user?.rol)) return true;
    throw new ForbiddenException(`Tu rol (${user?.rol ?? 'sin rol'}) no tiene permiso sobre esta ruta.`);
  }
}
