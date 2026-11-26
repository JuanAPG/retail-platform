import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AvisosService, ResultadoEntrega } from '../common/avisos/avisos.service';
import { ROL } from '../common/roles';
import { AlmacenEnMemoria, RepositorioEnMemoria } from './almacen/memoria';
import { DestinoSimulado } from './destinos/destino-simulado';
import { Solicitante, SyncService } from './sync.service';
import { CapturaEntrada, LoteEntrada } from './tipos';

/**
 * Unitarias de la orquestación con adaptadores EN MEMORIA: cada prueba arma
 * su propio repositorio, Redis y destino (datos aislados).
 */

beforeAll(() => Logger.overrideLogger(false));

const AHORA = new Date('2026-10-30T15:02:01.120Z');
const TOKEN = 'Bearer token-de-prueba';
const TIENDA = '27f05c81-c6bf-456a-a273-150e4edb9900';
const LECHE = '5b0d6a0e-1c1e-4f43-9c5b-2a6f1c1e9d77';
const ARROZ = '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e';

const investigador: Solicitante = { id: '9d2e7f40-5a61-4c1b-8e3f-2b7c9a0d4e55', rol: ROL.INVESTIGADOR };
const otroInvestigador: Solicitante = { id: '11111111-2222-4333-8444-555555555555', rol: ROL.INVESTIGADOR };
const responsablePrecios: Solicitante = { id: '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e', rol: ROL.RESPONSABLE_PRECIOS };
const auditor: Solicitante = { id: '0a0b0c0d-0e0f-4a1b-8c2d-3e4f5a6b7c8d', rol: ROL.AUDITOR };

function disponibilidad(parcial: Partial<CapturaEntrada> = {}): CapturaEntrada {
  return {
    captureId: randomUUID(),
    type: 'disponibilidad',
    contractVersion: '1.0',
    capturedAt: '2026-10-26T09:30:00-06:00',
    storeId: TIENDA,
    presentationId: LECHE,
    content: { stock: 12 },
    ...parcial,
  };
}

function precio(parcial: Partial<CapturaEntrada> = {}): CapturaEntrada {
  return disponibilidad({ type: 'precio_observado', content: { price: 27.5, lat: 25.6866, lng: -100.3161 }, ...parcial });
}

function lote(captures: CapturaEntrada[], parcial: Partial<LoteEntrada> = {}): LoteEntrada {
  return {
    batchId: randomUUID(),
    deviceId: 'a3b4c5d6-1111-4222-8333-944455556666',
    contractVersion: '1.0',
    client: 'movil',
    sentAt: '2026-10-30T09:02:00-06:00',
    captures,
    ...parcial,
  };
}

function armar() {
  const repo = new RepositorioEnMemoria();
  const rapido = new AlmacenEnMemoria();
  const destino = new DestinoSimulado();
  const entregas: { auditar: jest.Mock; notificar: jest.Mock } = {
    auditar: jest.fn(async (): Promise<ResultadoEntrega> => ({ estado: 'enviado', error: null })),
    notificar: jest.fn(async (): Promise<ResultadoEntrega> => ({ estado: 'enviado', error: null })),
  };
  const servicio = new SyncService(repo, rapido, destino, entregas as unknown as AvisosService);
  return { repo, rapido, destino, entregas, servicio };
}

describe('SyncService · lote mixto (aceptada + duplicada + conflicto + rechazada)', () => {
  it('devuelve un acuse por captura, en el orden del lote, y guarda cada una', async () => {
    const { servicio, destino, repo } = armar();

    // Una captura que ya se había sincronizado en un lote anterior.
    const yaEnviada = disponibilidad({ storeId: randomUUID() });
    await servicio.recibir(lote([yaEnviada]), investigador, TOKEN, 'corr-previo', AHORA);

    // El destino ya tiene un dato del arroz capturado DESPUÉS (p. ej. corrección del Analista).
    destino.sembrarDato({ type: 'disponibilidad', storeId: TIENDA, presentationId: ARROZ }, '2026-10-28T16:00:00.000Z');

    const aceptada = disponibilidad();
    const conflicto = disponibilidad({ presentationId: ARROZ, capturedAt: '2026-10-27T10:00:00-06:00', content: { stock: 0 } });
    const rechazada = precio({ presentationId: ARROZ, content: { price: -3 } });
    const acuse = await servicio.recibir(lote([aceptada, yaEnviada, conflicto, rechazada]), investigador, TOKEN, 'corr-1', AHORA);

    expect(acuse.resend).toBe(false);
    expect(acuse.correlationId).toBe('corr-1');
    expect(acuse.summary).toEqual({ total: 4, aceptadas: 1, duplicadas: 1, conflictos: 1, rechazadas: 1 });
    expect(acuse.results.map((r) => [r.captureId, r.status])).toEqual([
      [aceptada.captureId, 'aceptada'],
      [yaEnviada.captureId, 'duplicada'],
      [conflicto.captureId, 'conflicto'],
      [rechazada.captureId, 'rechazada'],
    ]);

    const [rAceptada, rDuplicada, rConflicto, rRechazada] = acuse.results;
    expect(rAceptada.target).toEqual({ service: 'availability-service', id: aceptada.captureId });
    expect(rAceptada.capturedAt).toBe('2026-10-26T15:30:00.000Z'); // UTC
    expect(rDuplicada.originalStatus).toBe('aceptada');
    expect(rDuplicada.target?.service).toBe('availability-service');
    expect(rConflicto.serverCapturedAt).toBe('2026-10-28T16:00:00.000Z');
    expect(rConflicto.reason?.code).toBe('CONFLICT');
    expect(rRechazada.reason).toEqual({ code: 'VALIDATION_ERROR', message: 'content.price debe ser mayor a 0.' });
    expect(rRechazada.target).toBeNull();
    expect(rRechazada.retryable).toBe(false);

    // El conflicto NO se pierde: queda guardado con su contenido completo.
    const guardada = repo.capturas.get(conflicto.captureId)!;
    expect(guardada.status).toBe('conflicto');
    expect(guardada.content).toEqual({ stock: 0 });
    // La rechazada nunca llegó al destino; la duplicada no se volvió a enviar.
    expect(destino.llamadas.map((l) => l.captureId)).toEqual([yaEnviada.captureId, aceptada.captureId, conflicto.captureId]);
  });

  it('reenviar el mismo lote no duplica: todas duplicada con su estado original', async () => {
    const { servicio, destino } = armar();
    const capturas = [disponibilidad(), precio(), precio({ content: { price: 0 } })];
    const envio = lote(capturas);
    const primero = await servicio.recibir(envio, investigador, TOKEN, 'corr-1', AHORA);
    const llamadas = destino.llamadas.length;

    const segundo = await servicio.recibir({ ...envio, sentAt: '2026-10-30T09:15:00-06:00' }, investigador, TOKEN, 'corr-2', AHORA);

    expect(segundo.resend).toBe(true);
    expect(segundo.correlationId).toBe('corr-1'); // el del primer envío
    expect(segundo.receivedAt).toBe(primero.receivedAt);
    expect(segundo.results.every((r) => r.status === 'duplicada')).toBe(true);
    expect(segundo.results.map((r) => r.originalStatus)).toEqual(['aceptada', 'aceptada', 'rechazada']);
    expect(segundo.results[1].target).toEqual(primero.results[1].target);
    expect(segundo.summary.duplicadas).toBe(3);
    expect(destino.llamadas.length).toBe(llamadas);
  });

  it('una captura ya resuelta que llega en OTRO lote también sale duplicada', async () => {
    const { servicio } = armar();
    const c = precio();
    await servicio.recibir(lote([c]), investigador, TOKEN, 'c1', AHORA);
    const acuse = await servicio.recibir(lote([c, precio({ presentationId: ARROZ })]), investigador, TOKEN, 'c2', AHORA);
    expect(acuse.resend).toBe(false);
    expect(acuse.results.map((r) => r.status)).toEqual(['duplicada', 'aceptada']);
  });

  it('otra captura del mismo dato con el MISMO instante que una ya aceptada queda en conflicto (empate)', async () => {
    const { servicio } = armar();
    await servicio.recibir(lote([precio()]), investigador, TOKEN, 'c1', AHORA);
    const acuse = await servicio.recibir(lote([precio()]), investigador, TOKEN, 'c2', AHORA);
    expect(acuse.results[0].status).toBe('conflicto');
  });
});

describe('SyncService · repetición simultánea del mismo lote', () => {
  it('solo un envío procesa; el otro recibe 409 y nada se envía dos veces', async () => {
    const { servicio, destino, repo } = armar();
    destino.latencia(30);
    const envio = lote([disponibilidad(), precio(), disponibilidad({ presentationId: ARROZ })]);

    const resultados = await Promise.allSettled([
      servicio.recibir(envio, investigador, TOKEN, 'a', AHORA),
      servicio.recibir(envio, investigador, TOKEN, 'b', AHORA),
    ]);

    const procesados = resultados.filter((r) => r.status === 'fulfilled');
    const rechazados = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(procesados).toHaveLength(1);
    expect(rechazados).toHaveLength(1);
    expect(rechazados[0].reason).toBeInstanceOf(ConflictException);
    expect(destino.llamadas).toHaveLength(3);
    expect(repo.lotes.size).toBe(1);

    // Cuando el primero termina, un reenvío recupera el acuse.
    const reenvio = await servicio.recibir(envio, investigador, TOKEN, 'c', AHORA);
    expect(reenvio.resend).toBe(true);
    expect(destino.llamadas).toHaveLength(3);
  });
});

describe('SyncService · desconexión después de escribir y reanudación', () => {
  it('si se cae al guardar el acuse, el siguiente envío lo recupera sin reenviar al destino', async () => {
    const { servicio, destino, repo } = armar();
    const envio = lote([disponibilidad(), precio(), precio({ content: { price: -1 } })]);

    repo.fallarEn = { operacion: 'guardarResultados' };
    await expect(servicio.recibir(envio, investigador, TOKEN, 'corr-1', AHORA)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // Las capturas sí quedaron escritas; el acuse del lote no.
    expect(repo.lotes.get(envio.batchId)!.resultados).toBeNull();
    expect(repo.capturas.get(envio.captures[0].captureId)!.status).toBe('aceptada');
    const llamadas = destino.llamadas.length;

    const reanudado = await servicio.recibir(envio, investigador, TOKEN, 'corr-2', AHORA);
    expect(reanudado.resend).toBe(true);
    expect(reanudado.results.map((r) => [r.status, r.originalStatus])).toEqual([
      ['duplicada', 'aceptada'],
      ['duplicada', 'aceptada'],
      ['duplicada', 'rechazada'],
    ]);
    expect(destino.llamadas.length).toBe(llamadas);
    // El acuse guardado conserva el estado original, no "duplicada".
    expect(repo.lotes.get(envio.batchId)!.resultados!.map((r) => r.status)).toEqual(['aceptada', 'aceptada', 'rechazada']);
  });

  it('si se cae DESPUÉS de enviar una captura y antes de guardarla, se reprocesa y el destino no la repite', async () => {
    const { servicio, destino, repo } = armar();
    const c = precio();
    const envio = lote([c]);

    repo.fallarEn = { operacion: 'guardarCaptura' };
    await expect(servicio.recibir(envio, investigador, TOKEN, 'corr-1', AHORA)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(repo.capturas.get(c.captureId)!.status).toBe('procesando'); // escritura adelantada
    const primerTarget = (await destino.enviar(c, { token: TOKEN, correlationId: 'x', userId: investigador.id, client: 'movil' }));

    const reanudado = await servicio.recibir(envio, investigador, TOKEN, 'corr-2', AHORA);
    expect(reanudado.results[0].status).toBe('aceptada');
    // El destino devolvió el MISMO id: no creó una segunda observación.
    expect(reanudado.results[0].target).toEqual((primerTarget as { target: unknown }).target);
    expect(repo.capturas.get(c.captureId)!.status).toBe('aceptada');
  });

  it('una captura cuyo destino no respondió queda reintentable y el siguiente envío la procesa', async () => {
    const { servicio, destino, repo } = armar();
    const envio = lote([disponibilidad(), precio()]);
    destino.caer(true);
    const primero = await servicio.recibir(envio, investigador, TOKEN, 'c1', AHORA);
    expect(primero.results.map((r) => [r.status, r.retryable, r.reason?.code])).toEqual([
      ['rechazada', true, 'SERVICE_UNAVAILABLE'],
      ['rechazada', true, 'SERVICE_UNAVAILABLE'],
    ]);

    destino.caer(false);
    const segundo = await servicio.recibir(envio, investigador, TOKEN, 'c2', AHORA);
    expect(segundo.resend).toBe(true);
    expect(segundo.results.map((r) => r.status)).toEqual(['aceptada', 'aceptada']);
    // El acuse guardado se actualizó solo en las reintentables.
    expect(repo.lotes.get(envio.batchId)!.resultados!.map((r) => r.status)).toEqual(['aceptada', 'aceptada']);
  });
});

describe('SyncService · 503 cuando cae MongoDB o Redis', () => {
  it('MongoDB caído: 503 y no se envía ninguna captura; el candado se suelta', async () => {
    const { servicio, destino, repo, rapido } = armar();
    const envio = lote([disponibilidad()]);
    repo.fallarEn = { operacion: 'buscarLote', siempre: true };
    await expect(servicio.recibir(envio, investigador, TOKEN, 'c', AHORA)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(destino.llamadas).toHaveLength(0);
    expect([...rapido.valores.keys()].some((k) => k.startsWith('lock:'))).toBe(false);
  });

  it('Redis caído: 503 y no se procesa nada', async () => {
    const { servicio, destino, repo, rapido } = armar();
    rapido.caido = true;
    await expect(servicio.recibir(lote([disponibilidad()]), investigador, TOKEN, 'c', AHORA)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(destino.llamadas).toHaveLength(0);
    expect(repo.lotes.size).toBe(0);
  });
});

describe('SyncService · conflicto (D-42)', () => {
  it('dos capturas del mismo dato en el lote: la hecha después gana aunque venga primero', async () => {
    const { servicio, destino, repo } = armar();
    const nueva = disponibilidad({ capturedAt: '2026-10-27T11:00:00-06:00', content: { stock: 3 } });
    const vieja = disponibilidad({ capturedAt: '2026-10-27T10:00:00-06:00', content: { stock: 9 } });
    const acuse = await servicio.recibir(lote([nueva, vieja]), investigador, TOKEN, 'c', AHORA);
    expect(acuse.results.map((r) => r.status)).toEqual(['aceptada', 'conflicto']);
    expect(acuse.results[1].serverCapturedAt).toBe('2026-10-27T17:00:00.000Z');
    expect(acuse.results[1].reason?.message).toContain(nueva.captureId);
    expect(destino.llamadas.map((l) => l.captureId)).toEqual([nueva.captureId]);
    expect(repo.capturas.get(vieja.captureId)!.content).toEqual({ stock: 9 });
  });

  it('una captura del lunes subida el viernes pierde contra la del jueves que ya se aceptó (último estado)', async () => {
    const { servicio, destino } = armar();
    await servicio.recibir(lote([precio({ capturedAt: '2026-10-29T10:00:00-06:00' })]), investigador, TOKEN, 'c1', AHORA);
    const lunes = precio({ capturedAt: '2026-10-26T10:00:00-06:00' });
    const acuse = await servicio.recibir(lote([lunes]), investigador, TOKEN, 'c2', AHORA);
    expect(acuse.results[0].status).toBe('conflicto');
    expect(acuse.results[0].serverCapturedAt).toBe('2026-10-29T16:00:00.000Z');
    expect(acuse.results[0].target).toBeNull();
    expect(destino.llamadas.map((l) => l.captureId)).not.toContain(lunes.captureId);
  });

  it('sin el último estado en Redis, lo reconstruye desde Mongo', async () => {
    const { servicio, rapido } = armar();
    await servicio.recibir(lote([precio({ capturedAt: '2026-10-29T10:00:00-06:00' })]), investigador, TOKEN, 'c1', AHORA);
    for (const llave of [...rapido.valores.keys()]) if (llave.startsWith('ultimo:')) rapido.valores.delete(llave);
    const acuse = await servicio.recibir(lote([precio({ capturedAt: '2026-10-26T10:00:00-06:00' })]), investigador, TOKEN, 'c2', AHORA);
    expect(acuse.results[0].status).toBe('conflicto');
  });
});

describe('SyncService · permisos y reglas del lote', () => {
  it('el Responsable de precios no puede mandar disponibilidad: esa captura FORBIDDEN, las demás siguen', async () => {
    const { servicio } = armar();
    const acuse = await servicio.recibir(lote([disponibilidad(), precio()]), responsablePrecios, TOKEN, 'c', AHORA);
    expect(acuse.results.map((r) => [r.status, r.reason?.code ?? null])).toEqual([
      ['rechazada', 'FORBIDDEN'],
      ['aceptada', null],
    ]);
  });

  it('un captureId de otro usuario sale rechazada CONFLICT sin datos de la captura ajena', async () => {
    const { servicio } = armar();
    const c = precio();
    await servicio.recibir(lote([c]), otroInvestigador, TOKEN, 'c1', AHORA);
    const acuse = await servicio.recibir(lote([c]), investigador, TOKEN, 'c2', AHORA);
    expect(acuse.results[0]).toEqual(
      expect.objectContaining({ status: 'rechazada', target: null, reason: { code: 'CONFLICT', message: 'Ese captureId ya fue usado por otra captura.' } }),
    );
  });

  it('el mismo captureId con otro contenido sale rechazada CONFLICT', async () => {
    const { servicio } = armar();
    const c = precio();
    await servicio.recibir(lote([c]), investigador, TOKEN, 'c1', AHORA);
    const acuse = await servicio.recibir(lote([{ ...c, content: { price: 99 } }]), investigador, TOKEN, 'c2', AHORA);
    expect(acuse.results[0].reason?.message).toContain('captureId nuevo');
  });

  it('el mismo batchId con otro contenido → 409; de otro usuario → 409', async () => {
    const { servicio } = armar();
    const envio = lote([precio()]);
    await servicio.recibir(envio, investigador, TOKEN, 'c1', AHORA);
    await expect(servicio.recibir({ ...envio, captures: [precio()] }, investigador, TOKEN, 'c2', AHORA)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(servicio.recibir(envio, otroInvestigador, TOKEN, 'c3', AHORA)).rejects.toBeInstanceOf(ConflictException);
  });

  it('captureId repetido dentro del lote o versión de lote no soportada → 400', async () => {
    const { servicio } = armar();
    const c = precio();
    const repetido = await servicio.recibir(lote([c, c]), investigador, TOKEN, 'c', AHORA).catch((e) => e);
    expect(repetido).toBeInstanceOf(BadRequestException);
    expect(repetido.getResponse().message).toEqual([`captureId repetido en el lote: ${c.captureId}`]);
    const version = await servicio.recibir(lote([precio()], { contractVersion: '2.0' }), investigador, TOKEN, 'c', AHORA).catch((e) => e);
    expect(version).toBeInstanceOf(BadRequestException);
  });
});

describe('SyncService · correlación, auditoría y avisos (no bloqueantes)', () => {
  it('reenvía token y X-Correlation-Id al destino, audita el lote y avisa los conflictos', async () => {
    const { servicio, destino, entregas, repo } = armar();
    const nueva = disponibilidad({ capturedAt: '2026-10-27T11:00:00-06:00' });
    const vieja = disponibilidad({ capturedAt: '2026-10-27T10:00:00-06:00' });
    const envio = lote([nueva, vieja]);
    await servicio.recibir(envio, investigador, TOKEN, 'corr-xyz', AHORA);
    await servicio.esperarAvisos();

    expect(destino.llamadas[0]).toEqual(expect.objectContaining({ correlationId: 'corr-xyz', token: TOKEN }));
    expect(entregas.auditar).toHaveBeenCalledWith(
      expect.objectContaining({ tabla: 'lotes_sync', registroId: envio.batchId, accion: 'insert' }),
      TOKEN,
    );
    expect(entregas.notificar).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'sync.conflicto', recipientUserId: investigador.id, relatedEntityId: envio.batchId }),
      TOKEN,
    );
    expect(repo.lotes.get(envio.batchId)!.delivery).toEqual(
      expect.objectContaining({ audit: 'enviado', notification: 'enviado' }),
    );
  });

  it('si la auditoría falla, la sincronización igual responde y el lote queda marcado fallido', async () => {
    const { servicio, entregas, repo } = armar();
    entregas.auditar.mockResolvedValue({ estado: 'fallido', error: 'HTTP 400: servicio no permitido' });
    const envio = lote([precio()]);
    const acuse = await servicio.recibir(envio, investigador, TOKEN, 'c', AHORA);
    expect(acuse.results[0].status).toBe('aceptada');
    await servicio.esperarAvisos();
    expect(repo.lotes.get(envio.batchId)!.delivery).toEqual({
      audit: 'fallido',
      auditError: 'HTTP 400: servicio no permitido',
      notification: 'no_aplica',
      notificationError: null,
    });
  });

  it('un reenvío sin nada nuevo no vuelve a auditar', async () => {
    const { servicio, entregas } = armar();
    const envio = lote([precio()]);
    await servicio.recibir(envio, investigador, TOKEN, 'c1', AHORA);
    await servicio.recibir(envio, investigador, TOKEN, 'c2', AHORA);
    await servicio.esperarAvisos();
    expect(entregas.auditar).toHaveBeenCalledTimes(1);
  });
});

describe('SyncService · consultas', () => {
  it('GET de un lote: el autor y el Auditor lo ven; otro usuario recibe 404', async () => {
    const { servicio } = armar();
    const envio = lote([precio()]);
    await servicio.recibir(envio, investigador, TOKEN, 'c', AHORA);
    expect((await servicio.obtener(envio.batchId, investigador)).results[0].status).toBe('aceptada');
    expect((await servicio.obtener(envio.batchId, auditor)).batchId).toBe(envio.batchId);
    await expect(servicio.obtener(envio.batchId, otroInvestigador)).rejects.toBeInstanceOf(NotFoundException);
    await expect(servicio.obtener(randomUUID(), investigador)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listado: cada quien ve los suyos; el filtro userId solo para Admin y Auditor; status filtra', async () => {
    const { servicio } = armar();
    await servicio.recibir(lote([precio()]), investigador, TOKEN, 'c1', AHORA);
    await servicio.recibir(lote([precio({ content: { price: 0 } })]), investigador, TOKEN, 'c2', AHORA);
    await servicio.recibir(lote([precio()]), otroInvestigador, TOKEN, 'c3', AHORA);

    expect((await servicio.listar({}, investigador)).total).toBe(2);
    expect((await servicio.listar({}, auditor)).total).toBe(3);
    expect((await servicio.listar({ userId: otroInvestigador.id }, auditor)).total).toBe(1);
    expect((await servicio.listar({ status: 'rechazada' }, investigador)).total).toBe(1);
    await expect(servicio.listar({ userId: otroInvestigador.id }, investigador)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(servicio.listar({ status: 'procesado' }, investigador)).rejects.toThrow();
    await expect(servicio.listar({ dateFrom: '2026-10-31', dateTo: '2026-10-30' }, investigador)).rejects.toThrow();
  });

  it('listado por día local de Monterrey (inclusivo)', async () => {
    const { servicio } = armar();
    // 2026-10-31T03:00Z es todavía el 30-oct en Monterrey.
    await servicio.recibir(lote([precio()]), investigador, TOKEN, 'c', new Date('2026-10-31T03:00:00Z'));
    expect((await servicio.listar({ dateFrom: '2026-10-30', dateTo: '2026-10-30' }, investigador)).total).toBe(1);
    expect((await servicio.listar({ dateFrom: '2026-10-31' }, investigador)).total).toBe(0);
  });
});
