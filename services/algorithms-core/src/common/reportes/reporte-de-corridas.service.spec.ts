import { AuditReporter } from '../audit/audit-reporter.service';
import { NotificationsReporter } from '../notifications/notifications-reporter.service';
import { ReporteDeCorridas } from './reporte-de-corridas.service';

function armar() {
  const auditoria = { reportar: jest.fn().mockResolvedValue(undefined) };
  const avisos = { emitir: jest.fn().mockResolvedValue(undefined) };
  const reporte = new ReporteDeCorridas(auditoria as unknown as AuditReporter, avisos as unknown as NotificationsReporter);
  return { reporte, auditoria, avisos };
}

const COMPLETADA = {
  runId: 'r-1',
  tipo: 'elasticidad' as const,
  nombre: 'Elasticidad',
  estado: 'completada' as const,
  resumen: '4 resultado(s) y 7 combinación(es) sin datos suficientes.',
  periodo: { start: '2026-08-02', end: '2026-09-20' },
};

describe('ReporteDeCorridas (ALG-10)', () => {
  it('una corrida completada deja ejecutar_corrida en la bitácora y avisa a quien la lanzó, con su token e IP', async () => {
    const { reporte, auditoria, avisos } = armar();

    await reporte.terminada(COMPLETADA, 'u-precios', { token: 'Bearer t', ip: '10.0.0.1' });

    expect(auditoria.reportar).toHaveBeenCalledWith(
      {
        tabla: 'analisis_corridas',
        registroId: 'r-1',
        accion: 'ejecutar_corrida',
        descripcion: 'Elasticidad completada: 4 resultado(s) y 7 combinación(es) sin datos suficientes.',
        cambios: [
          { campo: 'tipo', previo: null, posterior: 'elasticidad' },
          { campo: 'estado', previo: null, posterior: 'completada' },
          { campo: 'periodo', previo: null, posterior: '2026-08-02 a 2026-09-20' },
        ],
        ip: '10.0.0.1',
      },
      'Bearer t',
    );
    expect(avisos.emitir).toHaveBeenCalledWith(
      {
        eventType: 'corrida.terminada',
        relatedEntityType: 'corrida',
        relatedEntityId: 'r-1',
        title: 'Elasticidad: corrida terminada',
        message: COMPLETADA.resumen,
        priority: 'info',
        recipientUserId: 'u-precios',
      },
      'Bearer t',
    );
  });

  it('una corrida de asociación apunta a la colección de Mongo (D3), no a analisis_corridas', async () => {
    const { reporte, auditoria } = armar();

    await reporte.terminada({ ...COMPLETADA, tipo: 'asociacion', nombre: 'Apriori' }, 'u-analista');

    expect(auditoria.reportar.mock.calls[0][0]).toMatchObject({ tabla: 'analysis_runs', registroId: 'r-1' });
  });

  it('una corrida fallida también se reporta, y el aviso sale como advertencia', async () => {
    const { reporte, auditoria, avisos } = armar();

    await reporte.terminada({ ...COMPLETADA, estado: 'fallida', resumen: 'quedó registrada como fallida.' }, 'u-1');

    expect(auditoria.reportar.mock.calls[0][0]).toMatchObject({ descripcion: 'Elasticidad fallida: quedó registrada como fallida.' });
    expect(avisos.emitir.mock.calls[0][0]).toMatchObject({ title: 'Elasticidad: la corrida falló', priority: 'warning' });
  });

  it('sin id de corrida (ni la fallida se pudo guardar) solo queda la bitácora: el aviso no tendría a qué enlazar', async () => {
    const { reporte, auditoria, avisos } = armar();

    await reporte.terminada({ ...COMPLETADA, runId: null, estado: 'fallida' }, 'u-1');

    expect(auditoria.reportar).toHaveBeenCalledTimes(1);
    expect(avisos.emitir).not.toHaveBeenCalled();
  });

  it('manda los dos en paralelo: espera al más lento, no la suma', async () => {
    const { reporte, auditoria, avisos } = armar();
    const tarda = () => new Promise<void>((r) => setTimeout(r, 300));
    auditoria.reportar.mockImplementation(tarda);
    avisos.emitir.mockImplementation(tarda);

    const inicio = Date.now();
    await reporte.terminada(COMPLETADA, 'u-1');

    expect(Date.now() - inicio).toBeLessThan(550);
  });
});
