import { Module } from '@nestjs/common';
import { AuditReporter } from './audit-reporter.service';

/**
 * Lo que el controlador pasa al servicio para la bitácora: el
 * `Authorization` del usuario (audit-service exige sesión, se reenvía tal
 * cual) y su IP. Mismo patrón que `ContextoPeticion` de algorithms-core.
 */
export interface ContextoPeticion {
  token?: string;
  ip?: string;
}

/** Bitácora en audit-service; lo importan simulación, recomendaciones y accesibilidad. */
@Module({
  providers: [AuditReporter],
  exports: [AuditReporter],
})
export class AuditModule {}
