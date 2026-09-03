import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Debe usarse SIEMPRE después de JwtAuthGuard (necesita request.user
 * ya poblado por JwtStrategy.validate()).
 *
 * Este guard cubre el nivel "¿puede entrar a esta ruta?" (RBAC simple
 * por rol). El nivel más fino de la matriz de permisos (Total/Lectura/
 * Propone/Aprueba por módulo) se valida en cada microservicio de
 * negocio consultando `rol_modulo_permiso`, no aquí — este servicio
 * solo emite y valida identidad/rol, no la matriz completa.
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
