import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { Auditoria } from './entities/auditoria.entity';
import { AuditoriaCambio } from './entities/auditoria-cambio.entity';

/**
 * audit-service: bitácora append-only y consultas históricas. Dueño de
 * `auditoria` y `auditoria_cambios`. Los demás servicios reportan con
 * `POST /v1/auditoria` reenviando el `Authorization` del usuario que
 * originó el evento (SessionGuard: JWT + sesión activa en Redis); la
 * lectura exige Administrador o Auditor.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    TypeOrmModule.forFeature([Auditoria, AuditoriaCambio]),
    JwtModule.register({}),
  ],
  controllers: [HealthController, AuditController],
  providers: [AuditService, SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
