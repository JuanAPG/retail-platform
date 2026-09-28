import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Auditoria } from '../entities/auditoria.entity';
import { AuditoriaCambio } from '../entities/auditoria-cambio.entity';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

/**
 * M15 — Auditoría.
 *
 * Responsable: Juan Angel Galván
 * Rama:        `feature/m15-auditoria`
 *
 * Alcance:
 * - Bitácora inmutable de operaciones: usuario, acción, entidad y estado
 *   previo/posterior. Registro append-only, sin edición ni borrado. La
 *   escritura NO debe poder tumbar la operación de negocio que la origina
 *   (`AuditService.log()` nunca lanza).
 *
 * Es `@Global` a propósito: la auditoría es transversal como la
 * configuración (todos los módulos de negocio la inyectan para registrar
 * sus operaciones). Así ninguna rama tiene que editar el `*.module.ts`
 * de otro equipo para importar este módulo; los hooks viven en cada
 * servicio con parámetros opcionales que no rompen a sus llamadores.
 *
 * Las entidades compartidas viven en `src/entities/`; los guards y los
 * nombres de rol, en `src/common/`.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Auditoria, AuditoriaCambio])],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
