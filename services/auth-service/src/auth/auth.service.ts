import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { RoleEntity } from '../entities/role.entity';
import { UsuarioEntity } from '../entities/usuario.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { UsersService } from '../users/users.service';
import { SesionUsuario } from '../common/auth/session.guard';
import { getRedis } from '../common/auth/redis.client';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterProveedorDto } from './dto/register-proveedor.dto';

const PROVEEDOR_ROL_NOMBRE = 'Proveedor';

/** `15m`, `7d`, `3600` → segundos para los TTL de Redis. Exportada para probarla. */
export function aSegundos(expresion: string): number {
  const coincidencia = /^(\d+)([smhd])?$/.exec(expresion.trim());
  if (!coincidencia) return 900;
  const valor = parseInt(coincidencia[1], 10);
  const multiplicador = { s: 1, m: 60, h: 3600, d: 86400 }[coincidencia[2] ?? 's'] ?? 1;
  return valor * multiplicador;
}

/**
 * auth-service: emite y valida identidad. Diferencias con M01:
 * los tokens llevan `jti`, el refresh rota, existe logout con revocación
 * y cada login/refresh/logout deja `session:{userId}` o `revoked:{jti}`
 * en Redis (lo que el SessionGuard de los otros 9 consulta).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly auditoria: AuditReporter,
    @InjectRepository(RoleEntity)
    private readonly rolesRepo: Repository<RoleEntity>,
  ) {}

  // ---------------------------------------------------------------
  // REGISTRO (solo Proveedor externo)
  // ---------------------------------------------------------------
  async registerProveedor(dto: RegisterProveedorDto, ip?: string) {
    const rolProveedor = await this.rolesRepo.findOne({
      where: { nombre: PROVEEDOR_ROL_NOMBRE },
    });
    if (!rolProveedor) {
      throw new BadRequestException(
        'El rol "Proveedor" no está configurado en el sistema. Contacta al administrador.',
      );
    }

    const [usuarioExistente, proveedorExistente] = await Promise.all([
      this.usersService.findByEmail(dto.email),
      this.dataSource
        .getRepository(ProveedorEntity)
        .findOne({ where: { email: dto.email } }),
    ]);
    if (usuarioExistente || proveedorExistente) {
      throw new ConflictException('Ya existe una cuenta con este correo electrónico.');
    }

    const saltRounds = this.configService.getOrThrow<number>('jwt.bcryptSaltRounds');
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    // Ambos quedan INACTIVOS hasta aprobación del Administrador.
    const resultado = await this.dataSource.transaction(async (manager) => {
      const proveedor = manager.create(ProveedorEntity, {
        razonSocial: dto.razonSocial,
        rfc: dto.rfc,
        contactoNombre: dto.nombreContacto,
        email: dto.email,
        telefono: dto.telefono,
        activo: false,
      });
      await manager.save(proveedor);

      const usuario = manager.create(UsuarioEntity, {
        nombre: dto.nombreContacto,
        email: dto.email,
        passwordHash,
        rolId: rolProveedor.id,
        activo: false,
      });
      await manager.save(usuario);

      return {
        mensaje:
          'Solicitud de registro enviada. Tu cuenta será revisada por el Administrador antes de activarse.',
        proveedorId: proveedor.id,
        usuarioId: usuario.id,
      };
    });

    await this.auditoria.reportar({
      tabla: 'proveedores',
      registroId: resultado.proveedorId,
      accion: 'insert',
      descripcion: `Solicitud de registro de proveedor (${dto.email}).`,
      usuarioId: resultado.usuarioId,
      rolId: rolProveedor.id,
      ip,
    });

    return resultado;
  }

  // ---------------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------------
  async login(dto: LoginDto, ip?: string) {
    const usuario = await this.usersService.findByEmail(dto.email);

    // Mensaje genérico + sin auditar fallos: no enumerar cuentas.
    if (!usuario) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    if (!(await bcrypt.compare(dto.password, usuario.passwordHash))) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    if (!usuario.activo) {
      throw new UnauthorizedException(
        'Tu cuenta está inactiva o pendiente de aprobación por el Administrador.',
      );
    }

    const tokens = await this.emitirPar(usuario);

    // Sesión viva hasta que dure el refresh; el guard la exige.
    await getRedis().set(
      `session:${usuario.id}`,
      JSON.stringify({ refreshJti: tokens.refreshJti, accessJti: tokens.accessJti }),
      'EX',
      this.refreshTtl(),
    );

    await this.auditoria.reportar({
      tabla: 'usuarios',
      registroId: usuario.id,
      accion: 'login',
      descripcion: `Inicio de sesión (${usuario.email}).`,
      usuarioId: usuario.id,
      rolId: usuario.rolId,
      ip,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      usuario: this.usersService.toPublic(usuario),
    };
  }

  // ---------------------------------------------------------------
  // REFRESH (con rotación)
  // ---------------------------------------------------------------
  async refresh(dto: RefreshTokenDto, ip?: string) {
    let decodificado: { sub: string; jti: string; tokenType?: string };
    try {
      decodificado = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }
    if (decodificado.tokenType !== 'refresh') {
      throw new UnauthorizedException('Token no es de tipo refresh.');
    }

    const redis = getRedis();
    const sesion = await redis.get(`session:${decodificado.sub}`);
    if (!sesion) {
      throw new UnauthorizedException('Sesión inactiva. Vuelve a iniciar sesión.');
    }
    // Vinculación refresh↔sesión: si el jti no es el vigente, es reuso
    // (posible robo) y la sesión entera se invalida.
    if (JSON.parse(sesion).refreshJti !== decodificado.jti) {
      await redis.del(`session:${decodificado.sub}`);
      throw new UnauthorizedException('Sesión inválida. Vuelve a iniciar sesión.');
    }

    const usuario = await this.usersService.findById(decodificado.sub);
    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('El usuario no existe o está inactivo.');
    }

    // El refresh anterior muere aquí: rotación real, no re-emisión.
    await redis.set(`revoked:${decodificado.jti}`, '1', 'EX', this.refreshTtl());
    const tokens = await this.emitirPar(usuario);
    await redis.set(
      `session:${usuario.id}`,
      JSON.stringify({ refreshJti: tokens.refreshJti, accessJti: tokens.accessJti }),
      'EX',
      this.refreshTtl(),
    );

    await this.auditoria.reportar({
      tabla: 'usuarios',
      registroId: usuario.id,
      accion: 'login',
      descripcion: `Sesión renovada (${usuario.email}).`,
      usuarioId: usuario.id,
      rolId: usuario.rolId,
      ip,
    });

    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
  }

  // ---------------------------------------------------------------
  // LOGOUT
  // ---------------------------------------------------------------
  async logout(solicitante: SesionUsuario, ip?: string) {
    const redis = getRedis();
    const sesion = await redis.get(`session:${solicitante.id}`);
    if (sesion) {
      // Revoca el refresh vigente para que no se pueda rotar después.
      await redis.set(`revoked:${JSON.parse(sesion).refreshJti}`, '1', 'EX', this.refreshTtl());
      await redis.del(`session:${solicitante.id}`);
    }

    await this.auditoria.reportar({
      tabla: 'usuarios',
      registroId: solicitante.id,
      accion: 'login',
      descripcion: `Cierre de sesión (${solicitante.email}).`,
      usuarioId: solicitante.id,
      rolId: solicitante.rolId,
      ip,
    });

    // El access muere por sesión ausente aunque no expire: el guard lo rechaza.
    return { mensaje: 'Sesión cerrada.' };
  }

  // ---------------------------------------------------------------
  // VALIDATE (fallback para quien prefiera validar remoto)
  // ---------------------------------------------------------------
  async validate(token: string) {
    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
      });
      const redis = getRedis();
      if (payload.jti && (await redis.exists(`revoked:${payload.jti}`))) {
        return { active: false, user: null };
      }
      if (!(await redis.exists(`session:${payload.sub}`))) {
        return { active: false, user: null };
      }
      return {
        active: true,
        user: { id: payload.sub, email: payload.email, rol: payload.rol, rolId: payload.rolId },
      };
    } catch {
      return { active: false, user: null };
    }
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  private refreshTtl(): number {
    return aSegundos(this.configService.getOrThrow<string>('jwt.refreshExpiresIn'));
  }

  private accessTtl(): number {
    return aSegundos(this.configService.getOrThrow<string>('jwt.accessExpiresIn'));
  }

  private async emitirPar(usuario: UsuarioEntity) {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: usuario.id, email: usuario.email, rol: usuario.rol.nombre, rolId: usuario.rolId, jti: accessJti },
        {
          secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
          expiresIn: this.accessTtl(),
        },
      ),
      this.jwtService.signAsync(
        { sub: usuario.id, jti: refreshJti, tokenType: 'refresh' },
        {
          secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
          expiresIn: this.refreshTtl(),
        },
      ),
    ]);
    return { accessToken, refreshToken, accessJti, refreshJti };
  }
}
