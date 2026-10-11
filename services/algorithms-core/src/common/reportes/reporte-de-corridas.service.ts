import { Injectable } from '@nestjs/common';
import { AuditReporter } from '../audit/audit-reporter.service';
import { NotificationsReporter } from '../notifications/notifications-reporter.service';

/** Lo que el controlador sabe de la petición y los servicios no: el token y la IP. */
export interface ContextoPeticion {
  /** `Authorization` de quien lanzó la corrida: audit y notifications lo exigen. */
  token?: string;
  ip?: string | null;
}

/** Una corrida que acaba de terminar, completada o fallida. */
export interface CorridaTerminada {
  /** null si ni siquiera se pudo registrar la corrida fallida. */
  runId: string | null;
  /** `analisis_corridas.tipo`. */
  tipo: 'asociacion' | 'elasticidad';
  /** Cómo se le muestra al usuario: "Apriori", "Elasticidad". */
  nombre: string;
  estado: 'completada' | 'fallida';
  /** Una línea: qué salió (o que falló). Va a la bitácora y al aviso. */
  resumen: string;
  periodo?: { start: string; end: string };
}

/**
 * ALG-10 (QA-ALG56-03): toda corrida, completada o fallida, deja un evento
 * `ejecutar_corrida` en la bitácora (RF-30) y avisa `corrida.terminada` a
 * quien la lanzó. Los dos van en paralelo y nunca rompen la corrida: cada
 * reporter corta a los 1.5 s y se traga sus errores, así que con audit o
 * notifications caídos la respuesta tarda a lo más eso de más.
 */
@Injectable()
export class ReporteDeCorridas {
  constructor(
    private readonly auditoria: AuditReporter,
    private readonly avisos: NotificationsReporter,
  ) {}

  async terminada(corrida: CorridaTerminada, usuarioId: string, contexto: ContextoPeticion = {}): Promise<void> {
    const completada = corrida.estado === 'completada';
    const envios: Promise<void>[] = [
      this.auditoria.reportar(
        {
          tabla: 'analisis_corridas',
          registroId: corrida.runId,
          accion: 'ejecutar_corrida',
          descripcion: `${corrida.nombre} ${corrida.estado}: ${corrida.resumen}`,
          cambios: [
            { campo: 'tipo', previo: null, posterior: corrida.tipo },
            { campo: 'estado', previo: null, posterior: corrida.estado },
            ...(corrida.periodo
              ? [{ campo: 'periodo', previo: null, posterior: `${corrida.periodo.start} a ${corrida.periodo.end}` }]
              : []),
          ],
          ip: contexto.ip ?? null,
        },
        contexto.token,
      ),
    ];
    // El aviso apunta a la corrida: sin id no hay a qué enlazarlo.
    if (corrida.runId) {
      envios.push(
        this.avisos.emitir(
          {
            eventType: 'corrida.terminada',
            relatedEntityType: 'corrida',
            relatedEntityId: corrida.runId,
            title: completada ? `${corrida.nombre}: corrida terminada` : `${corrida.nombre}: la corrida falló`,
            message: corrida.resumen,
            priority: completada ? 'info' : 'warning',
            recipientUserId: usuarioId,
          },
          contexto.token,
        ),
      );
    }
    await Promise.all(envios);
  }
}
