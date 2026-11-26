import { HttpException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateXML } from 'xmllint-wasm';
import { ResultadoEntrega } from '../common/avisos/avisos.service';
import { serializarXml } from '../common/interceptors/xml.interceptor';
import { EvaluarDto } from './dto';
import { DESDE, Estado, EVENTO } from './reglas';
import { AHORA, Cambios, EventoFila, SeguimientoFila } from './repositorio';
import { SeguimientoService } from './seguimiento.service';

/**
 * SeguimientoService con dobles en memoria (sin Postgres ni HTTP): flujo de
 * §4 a §9, permisos del asignado, reintento de asignación, fechas de
 * Monterrey y cada respuesta en XML contra el XSD OFICIAL.
 */
const XSD = readFileSync(resolve(__dirname, '../../../../docs/contratos/recommendations-workflow-service.xsd'), 'utf8');

async function erroresXsd(datos: unknown, raiz: string): Promise<string[]> {
  const xml = serializarXml(datos, { raiz, namespace: 'workflow/v1' });
  const r = await validateXML({ xml: [{ fileName: `${raiz}.xml`, contents: xml }], schema: [{ fileName: 'w.xsd', contents: XSD }] });
  return r.valid ? [] : r.errors.map((e) => e.rawMessage.trim());
}

const GERENTE = { id: '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d', rol: 'Gerente de categoría' };
const PRECIOS = { id: '3b4c5d6e-7f80-4b9c-8d1e-2f3a4b5c6d7e', rol: 'Responsable de precios' };
const OTRO_PRECIOS = { id: '4c5d6e7f-8091-4cad-9e2f-3a4b5c6d7e8f', rol: 'Responsable de precios' };
const ADMIN_ASIGNADO = { id: '5d6e7f80-91a2-4bbe-8f30-4b5c6d7e8f90', rol: 'Administrador' };
const TOKEN = 'Bearer prueba';
const ACEPTADA = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const PROPUESTA = 'aaaaaaaa-0000-4000-8000-000000000001';
const DESCARTADA = 'aaaaaaaa-0000-4000-8000-000000000002';

/** Repositorio en memoria con la MISMA semántica: llave única y transición atómica. */
class RepoFalso {
  filas = new Map<string, SeguimientoFila>();
  eventos: Array<EventoFila & { id: string; seguimientoId: string; auditoria: string; aviso: string }> = [];
  reloj = new Date('2026-10-30T17:00:00.000Z');

  async asignar(d: { recomendacionId: string; asignadoA: string; asignadoPor: string; fechaCompromiso: string | null; nota: string | null }, correlationId: string | null) {
    const existente = [...this.filas.values()].find((s) => s.recomendacionId === d.recomendacionId);
    if (existente) return { creado: false as const, seguimiento: existente };
    const s: SeguimientoFila = {
      id: randomUUID(), recomendacionId: d.recomendacionId, estado: 'asignada', asignadoA: d.asignadoA, asignadoPor: d.asignadoPor,
      asignadoEn: this.reloj, fechaCompromiso: d.fechaCompromiso, notaAsignacion: d.nota, iniciadoEn: null, implementadoEl: null,
      implementadoEn: null, notaImplementacion: null, evaluadoPor: null, evaluadoEn: null, evaluacion: null,
    };
    this.filas.set(s.id, s);
    return { creado: true as const, seguimiento: s, eventoId: this.evento(s.id, null, 'asignada', d.asignadoPor, correlationId) };
  }
  async buscar(id: string) {
    return this.filas.get(id) ?? null;
  }
  async listar(f: { estado?: Estado; asignadoA?: string }, page: number, limit: number) {
    const filas = [...this.filas.values()].filter((s) => (!f.estado || s.estado === f.estado) && (!f.asignadoA || s.asignadoA === f.asignadoA));
    return { filas, total: filas.length, page, limit };
  }
  async transicion(id: string, desde: Estado, hacia: Estado, actor: string, c: Cambios, correlationId: string | null, soloAsignado: boolean) {
    const s = this.filas.get(id);
    if (!s || s.estado !== desde || (soloAsignado && s.asignadoA !== actor)) return null;
    const ahora = new Date('2026-12-01T16:00:00.000Z');
    s.estado = hacia;
    if (c.iniciado_en === AHORA) s.iniciadoEn = new Date('2026-10-31T15:00:00.000Z');
    if (hacia === 'implementada') Object.assign(s, { implementadoEl: c.implementado_el, implementadoEn: ahora, notaImplementacion: c.nota_implementacion });
    if (hacia === 'evaluada') {
      s.evaluadoPor = c.evaluado_por as string;
      s.evaluadoEn = ahora;
      s.evaluacion = {
        metrica: c.metrica as never, unidad: c.unidad as never, zonaId: c.alcance_zona_id as string | null, tiendaId: c.alcance_tienda_id as string | null,
        presentacionId: c.alcance_presentacion_id as string | null,
        antes: { desde: c.antes_desde as string, hasta: c.antes_hasta as string, valor: c.antes_valor as number },
        despues: { desde: c.despues_desde as string, hasta: c.despues_hasta as string, valor: c.despues_valor as number },
        variacionPct: c.variacion_pct as number, fuente: c.fuente as string, comentario: c.comentario as string | null,
      };
    }
    return { seguimiento: s, eventoId: this.evento(id, desde, hacia, actor, correlationId) };
  }
  async historial(id: string) {
    return this.eventos.filter((e) => e.seguimientoId === id);
  }
  async marcarEntrega(eventoId: string, a: ResultadoEntrega, b: ResultadoEntrega) {
    Object.assign(this.eventos.find((e) => e.id === eventoId)!, { auditoria: a.estado, aviso: b.estado });
  }
  private evento(seguimientoId: string, previo: Estado | null, nuevo: Estado, actor: string, correlationId: string | null) {
    const id = randomUUID();
    this.eventos.push({ id, seguimientoId, evento: EVENTO[nuevo], estadoPrevio: previo, estadoNuevo: nuevo, actorId: actor, ocurridoEn: new Date(), correlationId: correlationId ?? 'corr-prueba', auditoria: 'pendiente', aviso: 'pendiente' });
    return id;
  }
}

function armar() {
  const repo = new RepoFalso();
  const decision = {
    recomendacion: jest.fn(async (id: string) =>
      id === ACEPTADA ? { recommendationId: id, status: 'aceptada' } : id === PROPUESTA ? { recommendationId: id, status: 'propuesta' } : id === DESCARTADA ? { recommendationId: id, status: 'descartada' } : null,
    ),
  };
  const avisos = {
    auditar: jest.fn(async (): Promise<ResultadoEntrega> => ({ estado: 'enviado', error: null })),
    notificar: jest.fn(async (): Promise<ResultadoEntrega> => ({ estado: 'fallido', error: 'HTTP 400' })),
  };
  const servicio = new SeguimientoService(repo as never, decision as never, avisos as never);
  servicio.ahora = () => new Date('2026-10-30T18:00:00.000Z'); // 30-oct-2026, mediodía en Monterrey
  return { servicio, repo, decision, avisos };
}

async function fallo(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    const ex = e as HttpException;
    const r = ex.getResponse() as string | { message: string; details?: string[] };
    return typeof r === 'string' ? { status: ex.getStatus(), message: r } : { status: ex.getStatus(), message: r.message, details: r.details };
  }
  throw new Error('Se esperaba un error.');
}

const EVALUACION: EvaluarDto = {
  metric: 'precio_unitario',
  unit: 'MXN/kg',
  scope: { zoneId: 'f2670df2-6c1a-4b8e-9d3f-7a5b2c1e0d44', presentationId: '8c3e1f20-4d5a-4b6c-9d7e-0f1a2b3c4d5e' },
  before: { from: '2026-10-02', to: '2026-10-31', value: 27.5 },
  after: { from: '2026-11-01', to: '2026-11-30', value: 25 },
  source: 'pricing-service GET /v1/prices/variation, presentación arroz 1 kg, Zona Centro',
  comment: 'El precio por kilo bajó como se recomendó.',
};

/** Asigna, inicia e implementa el 1-nov (lo deja listo para evaluar el 1-dic). */
async function hastaImplementada() {
  const h = armar();
  const { cuerpo } = await h.servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: PRECIOS.id, dueDate: '2026-11-15', note: 'Aplicar el ajuste de precio del arroz 1 kg en Zona Centro.' }, GERENTE, TOKEN);
  await h.servicio.iniciar(cuerpo.id, PRECIOS, TOKEN);
  h.servicio.ahora = () => new Date('2026-11-01T18:00:00.000Z');
  await h.servicio.implementar(cuerpo.id, { implementedOn: '2026-11-01', note: 'Precio del arroz 1 kg bajado de $27.50 a $25.00.' }, PRECIOS, TOKEN);
  h.servicio.ahora = () => new Date('2026-12-01T16:00:00.000Z');
  return { ...h, id: cuerpo.id };
}

describe('asignar (§5)', () => {
  it('201: asignada; audita "insert" y avisa al asignado; XML válido', async () => {
    const { servicio, repo, avisos } = armar();
    const { creado, cuerpo } = await servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: PRECIOS.id }, GERENTE, TOKEN);
    expect(creado).toBe(true);
    expect(cuerpo).toMatchObject({ status: 'asignada', assigneeUserId: PRECIOS.id, assignedBy: GERENTE.id, startedAt: null, evaluation: null });
    expect(Object.keys(cuerpo)).toEqual([
      'id', 'recommendationId', 'status', 'assigneeUserId', 'assignedBy', 'assignedAt', 'dueDate', 'assignmentNote', 'startedAt',
      'implementedOn', 'implementedAt', 'implementationNote', 'evaluatedBy', 'evaluatedAt', 'evaluation',
    ]);
    expect(await erroresXsd(cuerpo, 'seguimientoResponse')).toEqual([]);
    await servicio.esperarEntregas();
    expect(avisos.auditar).toHaveBeenCalledWith(expect.objectContaining({ tabla: 'recomendacion_seguimientos', accion: 'insert', registroId: cuerpo.id }), TOKEN);
    expect(avisos.notificar).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'seguimiento.asignado', recipientUserId: PRECIOS.id }), TOKEN);
    expect(repo.eventos[0]).toMatchObject({ evento: 'asignada', auditoria: 'enviado', aviso: 'fallido' });
  });

  it('reintento con el mismo responsable: 200 con el existente, sin evento nuevo, sin auditar ni avisar', async () => {
    const { servicio, repo, avisos } = armar();
    const primero = await servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: PRECIOS.id }, GERENTE, TOKEN);
    await servicio.esperarEntregas();
    const segundo = await servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: PRECIOS.id }, GERENTE, TOKEN);
    expect(segundo).toEqual({ creado: false, cuerpo: primero.cuerpo });
    expect(repo.eventos).toHaveLength(1);
    expect(avisos.auditar).toHaveBeenCalledTimes(1);
    expect(avisos.notificar).toHaveBeenCalledTimes(1);
  });

  it('otro responsable → 409 con el id del seguimiento en details', async () => {
    const { servicio } = armar();
    const { cuerpo } = await servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: PRECIOS.id }, GERENTE, TOKEN);
    expect(await fallo(servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: OTRO_PRECIOS.id }, GERENTE, TOKEN))).toEqual({
      status: 409,
      message: 'La recomendación ya tiene responsable asignado; la reasignación no está definida.',
      details: [`seguimiento: ${cuerpo.id}`],
    });
  });

  it.each([
    [PROPUESTA, 'propuesta'],
    [DESCARTADA, 'descartada'],
  ])('recomendación %s (%s) → 409 con el estado en details; no se audita', async (id, estado) => {
    const { servicio, avisos } = armar();
    expect(await fallo(servicio.asignar({ recommendationId: id, assigneeUserId: PRECIOS.id }, GERENTE, TOKEN))).toEqual({
      status: 409,
      message: 'La recomendación no está aprobada; solo una recomendación aceptada entra al seguimiento.',
      details: [`estado en decision-service: ${estado}`],
    });
    expect(avisos.auditar).not.toHaveBeenCalled();
  });

  it('recomendación inexistente → 404', async () => {
    const { servicio } = armar();
    expect((await fallo(servicio.asignar({ recommendationId: randomUUID(), assigneeUserId: PRECIOS.id }, GERENTE, TOKEN))).status).toBe(404);
  });

  it('400: asignarse a sí mismo o dueDate pasada (día local de Monterrey)', async () => {
    const { servicio, decision } = armar();
    expect((await fallo(servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: GERENTE.id }, GERENTE, TOKEN))).status).toBe(400);
    // 31-oct 05:59:59 UTC = 30-oct 23:59:59 en Monterrey: el 30 todavía es hoy.
    servicio.ahora = () => new Date('2026-10-31T05:59:59.000Z');
    await expect(servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: PRECIOS.id, dueDate: '2026-10-30' }, GERENTE, TOKEN)).resolves.toMatchObject({ creado: true });
    servicio.ahora = () => new Date('2026-10-31T06:00:00.000Z');
    expect(await fallo(servicio.asignar({ recommendationId: PROPUESTA, assigneeUserId: PRECIOS.id, dueDate: '2026-10-30' }, GERENTE, TOKEN))).toMatchObject({
      status: 400,
      details: ['dueDate no puede ser pasada (hoy es 2026-10-31)'],
    });
    expect(decision.recomendacion).toHaveBeenCalledTimes(1); // el 400 se decide antes de llamar a decision-service
  });
});

describe('mover estados: solo el asignado (§2, §6, §7)', () => {
  async function asignado(a = PRECIOS) {
    const h = armar();
    const { cuerpo } = await h.servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: a.id }, GERENTE, TOKEN);
    return { ...h, id: cuerpo.id };
  }

  it('otro usuario con el MISMO rol → 403 (no 404)', async () => {
    const { servicio, id } = await asignado();
    expect(await fallo(servicio.iniciar(id, OTRO_PRECIOS, TOKEN))).toEqual({ status: 403, message: 'Solo el responsable asignado puede mover este seguimiento.', details: undefined });
  });

  it('asignado con un rol NO asignable (Administrador) → 403 al iniciar', async () => {
    const { servicio, id } = await asignado(ADMIN_ASIGNADO);
    expect((await fallo(servicio.iniciar(id, ADMIN_ASIGNADO, TOKEN))).status).toBe(403);
  });

  it('iniciar: 200 en_implementacion con startedAt; iniciar otra vez → 409 repetida; avisa al Gerente que asignó', async () => {
    const { servicio, avisos, id } = await asignado();
    const r = await servicio.iniciar(id, PRECIOS, TOKEN);
    expect(r).toMatchObject({ status: 'en_implementacion', startedAt: '2026-10-31T15:00:00.000Z' });
    expect(await erroresXsd(r, 'seguimientoResponse')).toEqual([]);
    expect(await fallo(servicio.iniciar(id, PRECIOS, TOKEN))).toMatchObject({ status: 409, details: ['estado actual: en_implementacion', 'transición pedida: en_implementacion', 'ya se inició (start)'] });
    await servicio.esperarEntregas();
    expect(avisos.notificar).toHaveBeenLastCalledWith(expect.objectContaining({ eventType: 'seguimiento.avance', recipientUserId: GERENTE.id }), TOKEN);
  });

  it('implementar sin iniciar → 409 con los details del contrato', async () => {
    const { servicio, id } = await asignado();
    expect(await fallo(servicio.implementar(id, { note: 'Se aplicó el cambio en tienda.' }, PRECIOS, TOKEN))).toEqual({
      status: 409,
      message: 'Transición fuera de orden.',
      details: ['estado actual: asignada', 'transición pedida: implementada', 'primero se inicia (start)'],
    });
  });

  it('implementedOn: entre el día de inicio y hoy; por omisión, hoy', async () => {
    const { servicio, id } = await asignado();
    await servicio.iniciar(id, PRECIOS, TOKEN); // startedAt 31-oct 15:00Z = 31-oct local
    servicio.ahora = () => new Date('2026-11-02T18:00:00.000Z');
    const nota = 'Precio bajado en las tiendas de la zona.';
    expect(await fallo(servicio.implementar(id, { implementedOn: '2026-10-30', note: nota }, PRECIOS, TOKEN))).toMatchObject({ status: 400 });
    expect(await fallo(servicio.implementar(id, { implementedOn: '2026-11-03', note: nota }, PRECIOS, TOKEN))).toMatchObject({
      status: 400,
      details: ['implementedOn debe estar entre el día en que se inició (2026-10-31) y hoy (2026-11-02)'],
    });
    await expect(servicio.implementar(id, { note: nota }, PRECIOS, TOKEN)).resolves.toMatchObject({ status: 'implementada', implementedOn: '2026-11-02' });
  });
});

describe('evaluar (§8)', () => {
  it('caso de control 27.50 → 25.00: evaluada con variationPct −9.09; XML válido; audita y avisa al asignado', async () => {
    const { servicio, avisos, id } = await hastaImplementada();
    const r = await servicio.evaluar(id, EVALUACION, GERENTE, TOKEN);
    expect(r.status).toBe('evaluada');
    expect(r.evaluation).toMatchObject({ metric: 'precio_unitario', unit: 'MXN/kg', variationPct: -9.09 });
    expect(await erroresXsd(r, 'seguimientoResponse')).toEqual([]);
    await servicio.esperarEntregas();
    expect(avisos.auditar).toHaveBeenLastCalledWith(
      expect.objectContaining({ accion: 'update', cambios: expect.arrayContaining([{ campo: 'variacion_pct', previo: null, posterior: '-9.09' }]) }),
      TOKEN,
    );
    expect(avisos.notificar).toHaveBeenLastCalledWith(expect.objectContaining({ eventType: 'seguimiento.evaluado', recipientUserId: PRECIOS.id }), TOKEN);
    // Evaluar otra vez → 409 repetida.
    expect((await fallo(servicio.evaluar(id, EVALUACION, GERENTE, TOKEN))).details).toEqual(['estado actual: evaluada', 'transición pedida: evaluada', 'ya se evaluó']);
  });

  it('caso de control 1,000 → 1,150 pza = 15.00', async () => {
    const { servicio, id } = await hastaImplementada();
    const r = await servicio.evaluar(id, { ...EVALUACION, metric: 'ventas_unidades', unit: 'pza', before: { ...EVALUACION.before, value: 1000 }, after: { ...EVALUACION.after, value: 1150 } }, GERENTE, TOKEN);
    expect(r.evaluation?.variationPct).toBe(15);
  });

  it('evaluar antes de implementar → 409 (falta marcarla implementada)', async () => {
    const { servicio } = armar();
    const { cuerpo } = await servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: PRECIOS.id }, GERENTE, TOKEN);
    await servicio.iniciar(cuerpo.id, PRECIOS, TOKEN);
    expect((await fallo(servicio.evaluar(cuerpo.id, EVALUACION, GERENTE, TOKEN))).details).toEqual([
      'estado actual: en_implementacion', 'transición pedida: evaluada', 'falta marcarla implementada',
    ]);
  });

  it('400: unidad incompatible ("Unidades incompatibles."), base 0 y after en el futuro; nada se audita', async () => {
    const { servicio, avisos, id } = await hastaImplementada();
    const antes = avisos.auditar.mock.calls.length;
    expect(await fallo(servicio.evaluar(id, { ...EVALUACION, unit: 'MXN' }, GERENTE, TOKEN))).toEqual({
      status: 400,
      message: 'Unidades incompatibles.',
      details: ['unit MXN no corresponde a la métrica precio_unitario (usa MXN/kg, MXN/l o MXN/pza)'],
    });
    expect((await fallo(servicio.evaluar(id, { ...EVALUACION, before: { ...EVALUACION.before, value: 0 } }, GERENTE, TOKEN))).status).toBe(400);
    servicio.ahora = () => new Date('2026-11-30T05:59:59.000Z'); // 29-nov local: after.to (30-nov) es futuro
    expect((await fallo(servicio.evaluar(id, EVALUACION, GERENTE, TOKEN))).details).toEqual(['after.to no puede ser futuro (hoy es 2026-11-29)']);
    await servicio.esperarEntregas();
    expect(avisos.auditar.mock.calls.length).toBe(antes);
  });
});

describe('consultas (§9)', () => {
  it('historial: un evento por transición, en orden, con estados de entrega; XML válido', async () => {
    const { servicio, id } = await hastaImplementada();
    await servicio.evaluar(id, EVALUACION, GERENTE, TOKEN);
    await servicio.esperarEntregas();
    const h = await servicio.historial(id);
    expect(h.data.map((e) => [e.event, e.fromStatus, e.toStatus])).toEqual([
      ['asignada', undefined, 'asignada'],
      ['iniciada', 'asignada', 'en_implementacion'],
      ['implementada', 'en_implementacion', 'implementada'],
      ['evaluada', 'implementada', 'evaluada'],
    ]);
    expect(h.data.every((e) => e.audit === 'enviado' && e.notification === 'fallido')).toBe(true);
    expect(await erroresXsd(h, 'historialSeguimientoResponse')).toEqual([]);
  });

  it('lista con mine=true; XML válido', async () => {
    const { servicio } = armar();
    await servicio.asignar({ recommendationId: ACEPTADA, assigneeUserId: PRECIOS.id }, GERENTE, TOKEN);
    expect((await servicio.listar({ mine: 'true' }, PRECIOS)).total).toBe(1);
    expect((await servicio.listar({ mine: 'true' }, OTRO_PRECIOS)).total).toBe(0);
    expect(await erroresXsd(await servicio.listar({}, GERENTE), 'seguimientoListResponse')).toEqual([]);
  });

  it('inexistente → 404', async () => {
    const { servicio } = armar();
    expect((await fallo(servicio.obtener(randomUUID()))).status).toBe(404);
    expect((await fallo(servicio.historial(randomUUID()))).status).toBe(404);
  });
});

it('DESDE describe la cadena de estados de D-41', () => {
  expect(DESDE).toEqual({ en_implementacion: 'asignada', implementada: 'en_implementacion', evaluada: 'implementada' });
});
