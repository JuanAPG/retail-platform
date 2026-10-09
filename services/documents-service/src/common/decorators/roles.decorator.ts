import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Uso: @Roles('Administrador', 'Auditor')
 * Los nombres deben coincidir EXACTAMENTE con roles.nombre en la BD
 * (ver seed de S0_Matriz_de_Perfiles_y_Permisos).
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
