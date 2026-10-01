import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuditReporter } from './common/audit/audit-reporter.service';
import { UsersController } from './users/users.controller';
import { RolesController } from './users/roles.controller';
import { UsersService } from './users/users.service';
import { RolesService } from './users/roles.service';
import { ModuloEntity } from './entities/modulo.entity';
import { ProveedorEntity } from './entities/proveedor.entity';
import { RolModuloPermisoEntity } from './entities/rol-modulo-permiso.entity';
import { RoleEntity } from './entities/role.entity';
import { UsuarioEntity } from './entities/usuario.entity';

/**
 * auth-service: identidad completa (login/tokens/sesiones + usuarios +
 * roles y matriz). Dueño de `usuarios`, `roles`, `modulos`,
 * `rol_modulo_permiso` y `proveedores` (estas por el registro).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig, jwtConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    TypeOrmModule.forFeature([
      ModuloEntity,
      ProveedorEntity,
      RolModuloPermisoEntity,
      RoleEntity,
      UsuarioEntity,
    ]),
    JwtModule.register({}),
  ],
  controllers: [HealthController, AuthController, UsersController, RolesController],
  providers: [AuthService, UsersService, RolesService, AuditReporter, SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
