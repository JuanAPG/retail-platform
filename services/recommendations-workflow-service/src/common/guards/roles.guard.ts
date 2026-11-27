import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';
export const MENSAJE_403_KEY = 'mensaje403';

/** `@Roles(ROL.X, ROL.Y)`: usa SIEMPRE la constante `ROL`, nunca literales. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Mensaje del 403 de esa ruta, cuando el contrato lo fija (p. ej. "Solo el
 * responsable asignado puede mover este seguimiento."). Sin él, uno genérico.
 */
export const MensajeProhibido = (mensaje: string) => SetMetadata(MENSAJE_403_KEY, mensaje);

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
    const destinos = [context.getHandler(), context.getClass()];
    const permitidos = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, destinos);
    if (!permitidos || permitidos.length === 0) return true;
    const { user } = context.switchToHttp().getRequest();
    if (permitidos.includes(user?.rol)) return true;
    const mensaje = this.reflector.getAllAndOverride<string>(MENSAJE_403_KEY, destinos);
    throw new ForbiddenException(mensaje ?? `Tu rol (${user?.rol ?? 'sin rol'}) no tiene permiso sobre esta ruta.`);
  }
}
