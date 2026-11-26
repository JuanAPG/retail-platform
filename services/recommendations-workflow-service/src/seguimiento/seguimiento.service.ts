import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AvisosService, ResultadoEntrega } from '../common/avisos/avisos.service';
import { correlacionActual } from '../common/correlation/correlacion';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, Pagina } from '../common/dto/pagination.dto';
import { diaLocal } from '../common/fechas';
import { DecisionCliente } from './decision';
import { AsignarDto, EvaluarDto, ImplementarDto, ListarDto } from './dto';
import { conflictoDeTransicion, esFecha, Estado, revisarEvaluacion, ROLES_ASIGNABLES, Transicion, variacionPct, DESDE } from './reglas';
import { AHORA, Cambios, EventoFila, RepositorioSeguimientos, SeguimientoFila } from './repositorio';

export interface Solicitante {
  id: string;
  rol: string;
}

/** `seguimientoResponse` (§5), con los campos en el orden del XSD. */
export function aRespuesta(s: SeguimientoFila) {
  const ev = s.evaluacion;
  return {
    id: s.id,
    recommendationId: s.recomendacionId,
    status: s.estado,
    assigneeUserId: s.asignadoA,
    assignedBy: s.asignadoPor,
    assignedAt: s.asignadoEn.toISOString(),
    dueDate: s.fechaCompromiso,
    assignmentNote: s.notaAsignacion,
    startedAt: s.iniciadoEn ? s.iniciadoEn.toISOString() : null,
    implementedOn: s.implementadoEl,
    implementedAt: s.implementadoEn ? s.implementadoEn.toISOString() : null,
    implementationNote: s.notaImplementacion,
    evaluatedBy: s.evaluadoPor,
    evaluatedAt: s.evaluadoEn ? s.evaluadoEn.toISOString() : null,
    evaluation: ev
      ? {
          metric: ev.metrica,
          unit: ev.unidad,
          scope: {
            ...(ev.zonaId ? { zoneId: ev.zonaId } : {}),
            ...(ev.tiendaId ? { storeId: ev.tiendaId } : {}),
            ...(ev.presentacionId ? { presentationId: ev.presentacionId } : {}),
          },
          before: { from: ev.antes.desde, to: ev.antes.hasta, value: ev.antes.valor },
          after: { from: ev.despues.desde, to: ev.despues.hasta, value: ev.despues.valor },
          variationPct: ev.variacionPct,
          source: ev.fuente,
          ...(ev.comentario ? { comment: ev.comentario } : {}),
        }
      : null,
  };
}

/** Un evento de `/:id/history` (§9), en el orden del XSD. */
function aEvento(e: EventoFila) {
  return {
    event: e.evento,
    ...(e.estadoPrevio ? { fromStatus: e.estadoPrevio } : {}),
    toStatus: e.estadoNuevo,
    actorId: e.actorId,
    at: e.ocurridoEn.toISOString(),
    correlationId: e.correlationId ?? '',
    audit: e.auditoria,
    notification: e.aviso,
  };
}

/**
 * recommendations-workflow-service (contrato docs/contratos/recommendations-workflow-service.md, D-41).
 * Verifica la recomendación por HTTP en decision-service; escribe SOLO
 * `recomendacion_seguimientos` y `seguimiento_eventos`.
 */
@Injectable()
export class SeguimientoService {
  private readonly logger = new Logger('seguimiento');
  /** Reloj inyectable para las pruebas de fechas. */
  ahora: () => Date = () => new Date();
  private readonly enVuelo = new Set<Promise<void>>();

  constructor(
    private readonly repo: RepositorioSeguimientos,
    private readonly decision: DecisionCliente,
    private readonly avisos: AvisosService,
  ) {}

  private hoy(): string {
    return diaLocal(this.ahora());
  }

  // ============================ Asignar (§5) ============================

  /** `creado: false` = reintento con el mismo responsable (200, sin auditar ni avisar). */
  async asignar(dto: AsignarDto, gerente: Solicitante, token: string): Promise<{ creado: boolean; cuerpo: ReturnType<typeof aRespuesta> }> {
    // 1. El cuerpo.
    const errores: string[] = [];
    if (dto.assigneeUserId.toLowerCase() === gerente.id.toLowerCase()) {
      errores.push('assigneeUserId no puede ser el mismo Gerente que asigna: quien evalúa no implementa');
    }
    if (dto.dueDate !== undefined) {
      if (!esFecha(dto.dueDate)) errores.push('dueDate no es una fecha válida');
      else if (dto.dueDate < this.hoy()) errores.push(`dueDate no puede ser pasada (hoy es ${this.hoy()})`);
    }
    if (errores.length) throw new BadRequestException({ message: 'Datos inválidos.', details: errores });

    // 2. La recomendación debe estar aceptada en decision-service.
    const recomendacion = await this.decision.recomendacion(dto.recommendationId, token);
    if (!recomendacion) throw new NotFoundException('La recomendación no existe en decision-service.');
    if (recomendacion.status !== 'aceptada') {
      throw new ConflictException({
        message: 'La recomendación no está aprobada; solo una recomendación aceptada entra al seguimiento.',
        details: [`estado en decision-service: ${recomendacion.status}`],
      });
    }

    // 3. Un solo seguimiento por recomendación.
    const r = await this.repo.asignar(
      {
        recomendacionId: dto.recommendationId,
        asignadoA: dto.assigneeUserId,
        asignadoPor: gerente.id,
        fechaCompromiso: dto.dueDate ?? null,
        nota: dto.note ?? null,
      },
      correlacionActual() ?? null,
    );
    if (!r.creado) {
      if (r.seguimiento.asignadoA.toLowerCase() === dto.assigneeUserId.toLowerCase()) {
        return { creado: false, cuerpo: aRespuesta(r.seguimiento) };
      }
      throw new ConflictException({
        message: 'La recomendación ya tiene responsable asignado; la reasignación no está definida.',
        details: [`seguimiento: ${r.seguimiento.id}`],
      });
    }

    // 4. Auditoría y aviso, después de guardar (§10).
    const s = r.seguimiento;
    this.despachar(r.eventoId, [
      this.avisos.auditar(
        {
          tabla: 'recomendacion_seguimientos',
          registroId: s.id,
          accion: 'insert',
          descripcion: `Recomendación ${s.recomendacionId} asignada a ${s.asignadoA}.`,
        },
        token,
      ),
      this.avisos.notificar(
        {
          eventType: 'seguimiento.asignado',
          relatedEntityType: 'recomendacion_seguimiento',
          relatedEntityId: s.id,
          recipientUserId: s.asignadoA,
          title: 'Recomendación asignada',
          message: `Se te asignó la implementación de la recomendación ${s.recomendacionId}${s.fechaCompromiso ? ` (compromiso: ${s.fechaCompromiso})` : ''}.`,
          priority: 'info',
        },
        token,
      ),
    ]);
    return { creado: true, cuerpo: aRespuesta(s) };
  }

  // ============================ Mover estados (§6, §7) ============================

  async iniciar(id: string, usuario: Solicitante, token: string) {
    const s = await this.exigirAsignado(id, usuario);
    this.exigirOrden(s.estado, 'en_implementacion');
    const r = await this.transicionar(s, 'en_implementacion', usuario, { iniciado_en: AHORA }, true);
    this.despachar(r.eventoId, [
      this.avisos.auditar(
        {
          tabla: 'recomendacion_seguimientos',
          registroId: s.id,
          accion: 'update',
          descripcion: `Seguimiento ${s.id} iniciado por el responsable asignado.`,
          cambios: [{ campo: 'estado', previo: 'asignada', posterior: 'en_implementacion' }],
        },
        token,
      ),
      this.avance(r.seguimiento, 'inició la implementación', token),
    ]);
    return aRespuesta(r.seguimiento);
  }

  async implementar(id: string, dto: ImplementarDto, usuario: Solicitante, token: string) {
    const s = await this.exigirAsignado(id, usuario);
    this.exigirOrden(s.estado, 'implementada');
    const hoy = this.hoy();
    const implementadoEl = dto.implementedOn ?? hoy;
    const desde = diaLocal(s.iniciadoEn as Date);
    if (!esFecha(implementadoEl)) {
      throw new BadRequestException({ message: 'Datos inválidos.', details: ['implementedOn no es una fecha válida'] });
    }
    if (implementadoEl < desde || implementadoEl > hoy) {
      throw new BadRequestException({
        message: 'Datos inválidos.',
        details: [`implementedOn debe estar entre el día en que se inició (${desde}) y hoy (${hoy})`],
      });
    }
    const r = await this.transicionar(
      s,
      'implementada',
      usuario,
      { implementado_el: implementadoEl, implementado_en: AHORA, nota_implementacion: dto.note },
      true,
    );
    this.despachar(r.eventoId, [
      this.avisos.auditar(
        {
          tabla: 'recomendacion_seguimientos',
          registroId: s.id,
          accion: 'update',
          descripcion: `Seguimiento ${s.id} marcado implementado: ${dto.note}`,
          cambios: [
            { campo: 'estado', previo: 'en_implementacion', posterior: 'implementada' },
            { campo: 'implementado_el', previo: null, posterior: implementadoEl },
          ],
        },
        token,
      ),
      this.avance(r.seguimiento, `la marcó implementada el ${implementadoEl}`, token),
    ]);
    return aRespuesta(r.seguimiento);
  }

  // ============================ Evaluar (§8) ============================

  async evaluar(id: string, dto: EvaluarDto, gerente: Solicitante, token: string) {
    const s = await this.exigir(id);
    this.exigirOrden(s.estado, 'evaluada');
    const { incompatibles, errores } = revisarEvaluacion(dto, s.implementadoEl as string, this.hoy());
    if (incompatibles.length) throw new BadRequestException({ message: 'Unidades incompatibles.', details: incompatibles });
    if (errores.length) throw new BadRequestException({ message: 'Datos inválidos.', details: errores });

    const variacion = variacionPct(dto.before.value, dto.after.value);
    const r = await this.transicionar(
      s,
      'evaluada',
      gerente,
      {
        evaluado_por: gerente.id,
        evaluado_en: AHORA,
        metrica: dto.metric,
        unidad: dto.unit,
        alcance_zona_id: dto.scope.zoneId ?? null,
        alcance_tienda_id: dto.scope.storeId ?? null,
        alcance_presentacion_id: dto.scope.presentationId ?? null,
        antes_desde: dto.before.from,
        antes_hasta: dto.before.to,
        antes_valor: dto.before.value,
        despues_desde: dto.after.from,
        despues_hasta: dto.after.to,
        despues_valor: dto.after.value,
        variacion_pct: variacion,
        fuente: dto.source,
        comentario: dto.comment ?? null,
      },
      false,
    );
    this.despachar(r.eventoId, [
      this.avisos.auditar(
        {
          tabla: 'recomendacion_seguimientos',
          registroId: s.id,
          accion: 'update',
          descripcion: `Seguimiento ${s.id} evaluado: ${dto.metric} ${dto.before.value} → ${dto.after.value} ${dto.unit} (${variacion} %). Fuente: ${dto.source}`,
          cambios: [
            { campo: 'estado', previo: 'implementada', posterior: 'evaluada' },
            { campo: 'metrica', previo: null, posterior: dto.metric },
            { campo: 'variacion_pct', previo: null, posterior: String(variacion) },
          ],
        },
        token,
      ),
      // §10: al asignado; la copia al rol Auditor la agrega notifications-service (como D-12).
      this.avisos.notificar(
        {
          eventType: 'seguimiento.evaluado',
          relatedEntityType: 'recomendacion_seguimiento',
          relatedEntityId: s.id,
          recipientUserId: s.asignadoA,
          title: 'Seguimiento evaluado',
          message: `La recomendación ${s.recomendacionId} se evaluó: ${dto.metric} varió ${variacion} %.`,
          priority: 'info',
        },
        token,
      ),
    ]);
    return aRespuesta(r.seguimiento);
  }

  // ============================ Consultas (§9) ============================

  async listar(q: ListarDto, usuario: Solicitante) {
    const page = q.page ?? PAGINA_DEFAULT;
    const limit = Math.min(q.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);
    if (q.mine === 'true' && q.assigneeUserId && q.assigneeUserId.toLowerCase() !== usuario.id.toLowerCase()) {
      // mine=true y otro assigneeUserId no pueden cumplirse a la vez: página vacía, no error.
      return { data: [], total: 0, page, limit } as Pagina<ReturnType<typeof aRespuesta>>;
    }
    const { filas, total } = await this.repo.listar(
      { estado: q.status, asignadoA: q.mine === 'true' ? usuario.id : q.assigneeUserId, recomendacionId: q.recommendationId },
      page,
      limit,
    );
    return { data: filas.map(aRespuesta), total, page, limit };
  }

  async obtener(id: string) {
    return aRespuesta(await this.exigir(id));
  }

  async historial(id: string) {
    await this.exigir(id);
    const eventos = await this.repo.historial(id);
    return { assignmentId: id, data: eventos.map(aEvento) };
  }

  // ============================ Comunes ============================

  private async exigir(id: string): Promise<SeguimientoFila> {
    const s = await this.repo.buscar(id);
    if (!s) throw new NotFoundException('El seguimiento no existe.');
    return s;
  }

  /**
   * §2: solo el usuario asignado mueve start/implement (otro usuario, aunque
   * tenga el mismo rol → 403), y su rol debe ser asignable.
   */
  private async exigirAsignado(id: string, usuario: Solicitante): Promise<SeguimientoFila> {
    const s = await this.exigir(id);
    if (s.asignadoA.toLowerCase() !== usuario.id.toLowerCase()) {
      throw new ForbiddenException('Solo el responsable asignado puede mover este seguimiento.');
    }
    if (!(ROLES_ASIGNABLES as readonly string[]).includes(usuario.rol)) {
      throw new ForbiddenException(`Tu rol (${usuario.rol}) no puede ser responsable de un seguimiento.`);
    }
    return s;
  }

  private exigirOrden(actual: Estado, pedida: Transicion): void {
    const conflicto = conflictoDeTransicion(actual, pedida);
    if (conflicto) throw new ConflictException(conflicto);
  }

  /** Transición atómica; si otra llegó antes, 409 con el estado que quedó. */
  private async transicionar(s: SeguimientoFila, hacia: Transicion, actor: Solicitante, cambios: Cambios, soloAsignado: boolean) {
    const r = await this.repo.transicion(s.id, DESDE[hacia], hacia, actor.id, cambios, correlacionActual() ?? null, soloAsignado);
    if (r) return r;
    const actual = await this.exigir(s.id);
    throw new ConflictException(
      conflictoDeTransicion(actual.estado, hacia) ?? { message: 'Otra operación cambió el seguimiento; vuelve a consultarlo.', details: [`estado actual: ${actual.estado}`] },
    );
  }

  private avance(s: SeguimientoFila, que: string, token: string): Promise<ResultadoEntrega> {
    return this.avisos.notificar(
      {
        eventType: 'seguimiento.avance',
        relatedEntityType: 'recomendacion_seguimiento',
        relatedEntityId: s.id,
        recipientUserId: s.asignadoPor,
        title: 'Avance de un seguimiento',
        message: `El responsable de la recomendación ${s.recomendacionId} ${que}.`,
        priority: 'info',
      },
      token,
    );
  }

  /** §10: guarda en `seguimiento_eventos` cómo terminó cada entrega. No bloquea ni lanza. */
  private despachar(eventoId: string, entregas: [Promise<ResultadoEntrega>, Promise<ResultadoEntrega>]): void {
    const tarea = (async () => {
      const [auditoria, aviso] = await Promise.all(entregas);
      await this.repo.marcarEntrega(eventoId, auditoria, aviso);
    })().catch((e) => this.logger.warn(`No se pudo guardar el estado de entrega del evento ${eventoId}: ${String(e)}`));
    this.enVuelo.add(tarea);
    void tarea.finally(() => this.enVuelo.delete(tarea));
  }

  /** Para las pruebas: espera a que terminen las entregas en vuelo. */
  async esperarEntregas(): Promise<void> {
    await Promise.all([...this.enVuelo]);
  }
}
