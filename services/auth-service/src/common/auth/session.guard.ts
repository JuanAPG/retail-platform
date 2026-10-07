import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRedis } from './redis.client';

export interface SesionUsuario {
  id: string;
  email: string;
  rol: string;
  rolId: number;
}

/**
 * Guard de sesión — NO CAMBIAR su lógica, solo aplicarlo con `@UseGuards(SessionGuard)`.
 * Ningún microservicio confía ciegamente en el token:
 *  1. Firma válida con `JWT_ACCESS_SECRET` (si falla → 401 UNAUTHORIZED).
 *  2. `jti` NO está en `revoked:{jti}` (si está → 401, fue cerrado).
 *  3. Existe `session:{userId}` en Redis (si no → 401, sesión inactiva).
 *
 * Si Redis NO responde, se rechaza igual (fail-closed: nunca se abre la
 * puerta por una caída de infraestructura), pero con 503 y un mensaje
 * claro en vez de un 500 genérico: el cliente no debe confundir "la
 * sesión no vale" con "no pude verificar la sesión".
 * El usuario verificado queda en `request.user` (`SesionUsuario`).
 * `auth-service` es quien escribe `session:{userId}` al login y quien la
 * borra + marca `revoked:{jti}` al logout. Los otros 9 solo leen.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly logger = new Logger(SessionGuard.name);

  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: SesionUsuario;
    }>();
    const header = request.headers['authorization'] ?? '';
    const [esquema, token] = header.split(' ');
    if (esquema !== 'Bearer' || !token) {
      throw new UnauthorizedException('Falta el token de sesión (Bearer).');
    }

    let payload: { sub: string; email: string; rol: string; rolId: number; jti?: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Token inválido o expirado.');
    }

    const redis = getRedis();
    let revocado = 0;
    let sesion = 0;
    try {
      if (payload.jti) revocado = await redis.exists(`revoked:${payload.jti}`);
      sesion = await redis.exists(`session:${payload.sub}`);
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.error(`No se pudo verificar la sesión en Redis: ${motivo}`);
      throw new ServiceUnavailableException(
        'No se pudo verificar la sesión: el servicio de sesiones no responde.',
      );
    }

    if (revocado) throw new UnauthorizedException('Sesión cerrada. Vuelve a iniciar sesión.');
    if (!sesion) throw new UnauthorizedException('Sesión inactiva. Vuelve a iniciar sesión.');

    request.user = { id: payload.sub, email: payload.email, rol: payload.rol, rolId: payload.rolId };
    return true;
  }
}
