import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Extrae y valida el access token del header `Authorization: Bearer <token>`.
 * Se ejecuta en CADA request protegido por JwtAuthGuard.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  async validate(payload: JwtPayload) {
    const usuario = await this.usersService.findById(payload.sub);

    if (!usuario || !usuario.activo) {
      // Cubre el caso de un usuario desactivado DESPUÉS de emitido el token:
      // el token seguiría siendo válido criptográficamente, pero aquí se
      // corta el acceso en cada request (defensa adicional mientras no
      // exista una lista de revocación en Redis, planeada para el
      // segundo parcial).
      throw new UnauthorizedException('El usuario no existe o está inactivo.');
    }

    // Esto queda disponible como `request.user` en los controladores y es
    // lo que responde GET /auth/me, que el front usa para rehidratar la
    // sesión al recargar: debe tener la misma forma que el `usuario` del
    // login (incluido `activo`).
    return {
      id: usuario.id,
      email: usuario.email,
      nombre: usuario.nombre,
      rol: usuario.rol.nombre,
      rolId: usuario.rolId,
      activo: usuario.activo,
    };
  }
}
