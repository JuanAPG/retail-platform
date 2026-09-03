/**
 * Payload que se firma dentro del access token.
 * `rol` viaja como nombre (no solo id) para que los demás
 * microservicios puedan aplicar RBAC sin tener que consultar
 * la tabla `roles` en cada request.
 */
export interface JwtPayload {
  sub: string; // usuarios.id (UUID)
  email: string;
  rol: string; // roles.nombre, ej. 'Administrador', 'Proveedor'
  rolId: number; // roles.id
}

export interface RefreshTokenPayload {
  sub: string;
  tokenType: 'refresh';
}
