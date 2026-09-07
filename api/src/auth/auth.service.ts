import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { RoleEntity } from '../entities/role.entity';
import { UsuarioEntity } from '../entities/usuario.entity';
import { ProveedorEntity } from '../entities/proveedor.entity';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterProveedorDto } from './dto/register-proveedor.dto';
import {
  JwtPayload,
  RefreshTokenPayload,
} from './interfaces/jwt-payload.interface';

const PROVEEDOR_ROL_NOMBRE = 'Proveedor';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(RoleEntity)
    private readonly rolesRepo: Repository<RoleEntity>,
  ) {}

  // ---------------------------------------------------------------
  // REGISTRO (solo Proveedor externo — HU wireframe "Registro")
  // ---------------------------------------------------------------
  async registerProveedor(dto: RegisterProveedorDto) {
    const rolProveedor = await this.rolesRepo.findOne({
      where: { nombre: PROVEEDOR_ROL_NOMBRE },
    });
    if (!rolProveedor) {
      // Señal de que el seed de roles no se corrió; no es un error del usuario.
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

    // Se crean `proveedores` y `usuarios` en una sola transacción: si algo
    // falla a mitad de camino, no debe quedar un usuario "huérfano" sin
    // su empresa (o viceversa). Ambos quedan INACTIVOS hasta que el
    // Administrador los apruebe desde el Portal Admin (RN: "Tu cuenta
    // será revisada por el Administrador antes de ser activada").
    return this.dataSource.transaction(async (manager) => {
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
  }

  // ---------------------------------------------------------------
  // LOGIN
  // ---------------------------------------------------------------
  async login(dto: LoginDto) {
    const usuario = await this.usersService.findByEmail(dto.email);

    // Mensaje deliberadamente genérico: no revelar si el correo existe o
    // no existe (evita enumeración de cuentas).
    if (!usuario) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    const passwordValida = await bcrypt.compare(dto.password, usuario.passwordHash);
    if (!passwordValida) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    if (!usuario.activo) {
      throw new UnauthorizedException(
        'Tu cuenta está inactiva o pendiente de aprobación por el Administrador.',
      );
    }

    return this.issueTokens(usuario);
  }

  // ---------------------------------------------------------------
  // REFRESH
  // ---------------------------------------------------------------
  async refresh(refreshToken: string) {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshTokenPayload>(
        refreshToken,
        { secret: this.configService.getOrThrow<string>('jwt.refreshSecret') },
      );
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    if (payload.tokenType !== 'refresh') {
      throw new UnauthorizedException('Token no es de tipo refresh.');
    }

    const usuario = await this.usersService.findById(payload.sub);
    if (!usuario || !usuario.activo) {
      throw new UnauthorizedException('El usuario no existe o está inactivo.');
    }

    // Solo se re-emite el access token; el refresh token original se
    // mantiene vigente hasta su expiración natural. La revocación
    // anticipada (logout global, cambio de contraseña) requiere la
    // lista negra en Redis planeada para el segundo parcial.
    return {
      accessToken: await this.signAccessToken(usuario),
    };
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  private async issueTokens(usuario: UsuarioEntity) {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(usuario),
      this.signRefreshToken(usuario),
    ]);

    return {
      accessToken,
      refreshToken,
      usuario: this.usersService.toPublic(usuario),
    };
  }

  private signAccessToken(usuario: UsuarioEntity): Promise<string> {
    const payload: JwtPayload = {
      sub: usuario.id,
      email: usuario.email,
      rol: usuario.rol.nombre,
      rolId: usuario.rolId,
    };
    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: this.configService.getOrThrow<string>('jwt.accessExpiresIn'),
    });
  }

  private signRefreshToken(usuario: UsuarioEntity): Promise<string> {
    const payload: RefreshTokenPayload = {
      sub: usuario.id,
      tokenType: 'refresh',
    };
    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      expiresIn: this.configService.getOrThrow<string>('jwt.refreshExpiresIn'),
    });
  }
}
