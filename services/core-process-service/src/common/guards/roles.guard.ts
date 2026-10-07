import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Debe usarse SIEMPRE después de `SessionGuard`, que es quien puebla
 * `request.user` con la sesión verificada contra Redis.
 *
 * Cubre el nivel "¿puede entrar a esta ruta?" (RBAC simple por nombre de
 * rol, declarado con `@Roles(...)`). El nivel más fino de la matriz
 * (Total/Lectura/Propone/Aprueba por módulo, tabla `rol_modulo_permiso`)
 * NO se valida todavía en ningún servicio: la tabla existe en el esquema
 * pero no tiene seed. Pendiente de equipo; hoy el control efectivo es el
 * de este guard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // Ruta sin restricción de rol adicional.
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user?.rol);
  }
}
