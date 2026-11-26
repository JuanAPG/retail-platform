import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AvisosService } from '../common/avisos/avisos.service';
import { LIMITE_DEFAULT, LIMITE_MAXIMO, PAGINA_DEFAULT, Pagina } from '../common/dto/pagination.dto';
import { esFechaValida, finDelDia, inicioDelDia } from '../common/fechas';
import {
  ALMACEN_RAPIDO,
  AlmacenRapido,
  CapturaEnCache,
  CapturaGuardada,
  FiltroLotes,
  LoteGuardado,
  REPOSITORIO_SYNC,
  RepositorioSync,
} from './almacen/puertos';
import { DESTINO_CAPTURAS, DestinoCapturas, RespuestaDestino } from './destinos/destino';
import {
  aUtc,
  huellaCaptura,
  huellaLote,
  idsRepetidos,
  llaveDato,
  perdedorasDentroDelLote,
  puedeEnviarTipo,
  ROLES_QUE_LEEN_TODO,
  validarCaptura,
} from './reglas';
import {
  Acuse,
  CapturaEntrada,
  EstadoFinal,
  ESTADOS_CAPTURA,
  LoteEntrada,
  Motivo,
  resultado,
  ResultadoCaptura,
  resumir,
  VERSION_CONTRATO,
} from './tipos';

export interface Solicitante {
  id: string;
  rol: string;
}

/** Candado del lote en Redis (contrato §4.8). */
const CANDADO_MS = 60_000;

/** Lo que se sabe de una captura que ya se había recibido (caché de Redis o Mongo). */
interface Previa {
  userId: string;
  batchId: string;
  hash: string;
  status: CapturaGuardada['status'];
  retryable: boolean;
  target: CapturaGuardada['target'];
  serverCapturedAt: string | null;
  reason: Motivo | null;
  /** El documento de Mongo, si se leyó de ahí (para reprocesar). */
  doc?: CapturaGuardada;
}

/** Resultado de una captura: lo que se responde y lo que se guarda en el acuse del lote. */
interface Salida {
  respuesta: ResultadoCaptura;
  guardado: ResultadoCaptura;
  /** `true` si en este envío se procesó (no fue `duplicada` ni ajena). */
  nueva: boolean;
}

function esFinal(p: Pick<Previa, 'status' | 'retryable'>): p is Previa & { status: EstadoFinal } {
  return p.status !== 'procesando' && !(p.status === 'rechazada' && p.retryable);
}

function igual(salida: ResultadoCaptura, nueva = true): Salida {
  return { respuesta: salida, guardado: salida, nueva };
}

/**
 * Orquesta la sincronización (contrato §4): candado del lote, idempotencia
 * por `captureId`, reglas por captura, conflicto (D-42), envío al destino y
 * acuse. Los almacenes y el destino entran por puertos, así que las pruebas
 * unitarias corren con adaptadores en memoria.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger('sync');
  /** Avisos en vuelo (solo para que las pruebas puedan esperarlos). */
  private readonly enVuelo = new Set<Promise<void>>();

  constructor(
    @Inject(REPOSITORIO_SYNC) private readonly repo: RepositorioSync,
    @Inject(ALMACEN_RAPIDO) private readonly rapido: AlmacenRapido,
    @Inject(DESTINO_CAPTURAS) private readonly destino: DestinoCapturas,
    private readonly avisos: AvisosService,
  ) {}

  // ======================= POST /v1/sync/batches =======================

  async recibir(
    lote: LoteEntrada,
    usuario: Solicitante,
    token: string,
    correlationId: string,
    ahora = new Date(),
  ): Promise<Acuse> {
    if (lote.contractVersion !== VERSION_CONTRATO) {
      throw new BadRequestException([
        `contractVersion ${lote.contractVersion} no está soportada; la versión vigente es ${VERSION_CONTRATO}.`,
      ]);
    }
    const repetidos = idsRepetidos(lote.captures);
    if (repetidos.length) {
      throw new BadRequestException(repetidos.map((id) => `captureId repetido en el lote: ${id}`));
    }

    const hash = huellaLote(lote);
    const dueno = randomUUID();
    // Sin candado (Redis caído) → 503 del almacén y no se procesa nada.
    if (!(await this.rapido.tomarCandado(lote.batchId, dueno, CANDADO_MS))) {
      throw new ConflictException('El lote se está procesando; reintenta en unos segundos.');
    }
    try {
      // Sin Mongo → 503 aquí, antes de enviar cualquier captura.
      let existente = await this.repo.buscarLote(lote.batchId);
      if (!existente) {
        const nuevo = this.loteNuevo(lote, usuario, hash, correlationId, ahora);
        if (!(await this.repo.crearLote(nuevo))) existente = await this.repo.buscarLote(lote.batchId);
      }
      if (existente && (existente.userId !== usuario.id || existente.hash !== hash)) {
        throw new ConflictException('El batchId ya se usó con otro contenido. Un lote nuevo lleva un batchId nuevo.');
      }

      const salidas = await this.procesar(lote, usuario, token, correlationId, ahora);

      const guardados = this.combinar(existente?.resultados ?? null, salidas.map((s) => s.guardado));
      await this.repo.guardarResultados(
        lote.batchId,
        guardados,
        resumir(guardados),
        [...new Set(guardados.map((r) => r.status))],
      );

      const respuesta = salidas.map((s) => s.respuesta);
      const acuse: Acuse = {
        batchId: lote.batchId,
        deviceId: lote.deviceId,
        userId: usuario.id,
        client: lote.client,
        contractVersion: lote.contractVersion,
        receivedAt: (existente?.receivedAt ?? ahora).toISOString(),
        resend: Boolean(existente),
        correlationId: existente?.correlationId ?? correlationId,
        summary: resumir(respuesta),
        results: respuesta,
      };

      const nuevas = salidas.filter((s) => s.nueva).map((s) => s.respuesta);
      if (nuevas.length > 0) this.despacharAvisos(acuse, nuevas, existente ? 'update' : 'insert', token);
      this.logger.log(
        JSON.stringify({
          evento: 'lote_procesado',
          correlationId,
          correlationIdOriginal: acuse.correlationId,
          batchId: lote.batchId,
          resend: acuse.resend,
          ...acuse.summary,
        }),
      );
      return acuse;
    } finally {
      await this.rapido.soltarCandado(lote.batchId, dueno).catch((e) =>
        this.logger.warn(`No se pudo soltar el candado de ${lote.batchId}: ${String(e)} (vence solo en 60 s).`),
      );
    }
  }

  private loteNuevo(lote: LoteEntrada, usuario: Solicitante, hash: string, correlationId: string, ahora: Date): LoteGuardado {
    return {
      batchId: lote.batchId,
      userId: usuario.id,
      deviceId: lote.deviceId,
      client: lote.client,
      contractVersion: lote.contractVersion,
      sentAt: lote.sentAt ? new Date(lote.sentAt) : null,
      hash,
      correlationId,
      receivedAt: ahora,
      estado: 'procesando',
      captureIds: lote.captures.map((c) => c.captureId),
      resultados: null,
      resumen: null,
      estados: [],
      delivery: { audit: 'pendiente', auditError: null, notification: 'pendiente', notificationError: null },
      updatedAt: ahora,
    };
  }

  /**
   * El acuse guardado conserva lo que se respondió la primera vez; solo se
   * reemplazan las capturas reintentables que se volvieron a procesar.
   */
  private combinar(anteriores: ResultadoCaptura[] | null, nuevos: ResultadoCaptura[]): ResultadoCaptura[] {
    if (!anteriores) return nuevos;
    return anteriores.map((anterior, i) => (anterior.retryable && nuevos[i] ? nuevos[i] : anterior));
  }

  // ======================= Procesar cada captura =======================

  private async procesar(
    lote: LoteEntrada,
    usuario: Solicitante,
    token: string,
    correlationId: string,
    ahora: Date,
  ): Promise<Salida[]> {
    const previas = await this.buscarPrevias(lote.captures.map((c) => c.captureId));
    const salidas: Salida[] = new Array(lote.captures.length);
    const porProcesar: Array<{ i: number; c: CapturaEntrada; previa?: Previa }> = [];

    // 1. Idempotencia por captureId (§4.8).
    lote.captures.forEach((c, i) => {
      const previa = previas.get(c.captureId);
      if (!previa) return void porProcesar.push({ i, c });
      const base = { captureId: c.captureId, type: c.type, capturedAt: aUtc(c.capturedAt) };
      if (previa.userId !== usuario.id) {
        salidas[i] = igual(
          resultado({ ...base, status: 'rechazada', reason: { code: 'CONFLICT', message: 'Ese captureId ya fue usado por otra captura.' } }),
          false,
        );
      } else if (previa.hash !== huellaCaptura(c)) {
        salidas[i] = igual(
          resultado({
            ...base,
            status: 'rechazada',
            reason: { code: 'CONFLICT', message: 'El captureId ya se usó con otro contenido; un dato corregido lleva un captureId nuevo.' },
          }),
          false,
        );
      } else if (esFinal(previa)) {
        const datos = {
          ...base,
          target: previa.target,
          serverCapturedAt: previa.serverCapturedAt,
          reason: previa.reason,
        };
        const duplicada = resultado({ ...datos, status: 'duplicada', originalStatus: previa.status });
        // Si la captura es de este mismo lote, el acuse guardado conserva su estado original.
        const guardado = previa.batchId === lote.batchId ? resultado({ ...datos, status: previa.status }) : duplicada;
        salidas[i] = { respuesta: duplicada, guardado, nueva: false };
      } else {
        // Reservada sin terminar (caída a medio lote) o reintentable: se reprocesa.
        porProcesar.push({ i, c, previa });
      }
    });

    // 2. Reglas por captura y permiso por tipo (§4.4, §2).
    const candidatas: Array<{ i: number; c: CapturaEntrada; previa?: Previa }> = [];
    for (const item of porProcesar) {
      const motivo =
        validarCaptura(item.c, ahora) ??
        (puedeEnviarTipo(usuario.rol, item.c.type)
          ? null
          : ({ code: 'FORBIDDEN', message: `Tu rol (${usuario.rol}) no puede enviar capturas de tipo ${item.c.type}.` } as Motivo));
      if (motivo) {
        salidas[item.i] = await this.cerrarAntesDelDestino(item, lote.batchId, usuario, ahora, 'rechazada', motivo, null);
      } else {
        candidatas.push(item);
      }
    }

    // 3. Conflicto dentro del mismo lote (§4.7, paso 1).
    const perdedoras = perdedorasDentroDelLote(candidatas.map((x) => x.c));
    const ganadoras: typeof candidatas = [];
    for (const item of candidatas) {
      const perdio = perdedoras.get(item.c.captureId);
      if (!perdio) {
        ganadoras.push(item);
        continue;
      }
      const cuando = aUtc(perdio.ganadora.capturedAt);
      salidas[item.i] = await this.cerrarAntesDelDestino(item, lote.batchId, usuario, ahora, 'conflicto', {
        code: 'CONFLICT',
        message: `Hay una captura más reciente de esta tienda y presentación en el mismo lote (${perdio.ganadora.captureId}, capturada el ${cuando}). No se sobrescribió; la captura quedó guardada.`,
      }, cuando);
    }

    // 4. Las que siguen: último estado (paso 2) y destino (paso 3), en orden.
    for (const item of ganadoras) {
      salidas[item.i] = await this.enviarAlDestino(item, lote, usuario, token, correlationId, ahora);
    }
    return salidas;
  }

  private async buscarPrevias(ids: string[]): Promise<Map<string, Previa>> {
    const previas = new Map<string, Previa>();
    const enCache = await this.rapido.leerCapturas(ids);
    enCache.forEach((c: CapturaEnCache, id) =>
      previas.set(id, { ...c, retryable: false, serverCapturedAt: c.serverCapturedAt }),
    );
    const faltan = ids.filter((id) => !previas.has(id));
    const enMongo = await this.repo.buscarCapturas(faltan);
    enMongo.forEach((doc, id) =>
      previas.set(id, {
        userId: doc.userId,
        batchId: doc.batchId,
        hash: doc.hash,
        status: doc.status,
        retryable: doc.retryable,
        target: doc.target,
        serverCapturedAt: doc.serverCapturedAt ? doc.serverCapturedAt.toISOString() : null,
        reason: doc.reason,
        doc,
      }),
    );
    return previas;
  }

  private documento(c: CapturaEntrada, batchId: string, usuario: Solicitante, ahora: Date, previa?: Previa): CapturaGuardada {
    return {
      captureId: c.captureId,
      batchId,
      userId: usuario.id,
      type: c.type,
      storeId: c.storeId ?? null,
      presentationId: c.presentationId ?? null,
      capturedAt: new Date(c.capturedAt),
      contractVersion: c.contractVersion,
      content: c.content,
      hash: huellaCaptura(c),
      status: 'procesando',
      retryable: false,
      target: null,
      serverCapturedAt: null,
      reason: null,
      receivedAt: previa?.doc?.receivedAt ?? ahora,
      updatedAt: ahora,
    };
  }

  /** Cierra una captura que no llega al destino (rechazo por reglas o conflicto dentro del lote). */
  private async cerrarAntesDelDestino(
    item: { c: CapturaEntrada; previa?: Previa },
    batchId: string,
    usuario: Solicitante,
    ahora: Date,
    status: 'rechazada' | 'conflicto',
    reason: Motivo,
    serverCapturedAt: string | null,
  ): Promise<Salida> {
    const doc: CapturaGuardada = {
      ...this.documento(item.c, batchId, usuario, ahora, item.previa),
      status,
      reason,
      serverCapturedAt: serverCapturedAt ? new Date(serverCapturedAt) : null,
    };
    if (item.previa) {
      await this.repo.guardarCaptura(doc);
    } else if (!(await this.repo.reservarCaptura(doc))) {
      return igual(this.enOtroEnvio(item.c), false);
    }
    await this.rapido.guardarCaptura(this.aCache(doc));
    return igual(this.aResultado(doc));
  }

  private async enviarAlDestino(
    item: { c: CapturaEntrada; previa?: Previa },
    lote: LoteEntrada,
    usuario: Solicitante,
    token: string,
    correlationId: string,
    ahora: Date,
  ): Promise<Salida> {
    const { c } = item;
    const doc = this.documento(c, lote.batchId, usuario, ahora, item.previa);

    // Escritura adelantada: la captura queda reservada ANTES de ir al destino.
    // Si el proceso se cae después de enviarla, el siguiente envío la
    // encuentra `procesando` y la reprocesa (el destino es idempotente).
    if (!item.previa && !(await this.repo.reservarCaptura(doc))) {
      return igual(this.enOtroEnvio(c), false);
    }

    // Paso 2: contra lo que este servicio ya aceptó (último estado, D-47).
    const llave = llaveDato(c);
    let ultimo = await this.rapido.leerUltimo(llave);
    if (!ultimo && c.storeId && c.presentationId) {
      const deMongo = await this.repo.ultimaAceptada(c.type, c.storeId, c.presentationId);
      if (deMongo) {
        ultimo = deMongo.toISOString();
        await this.rapido.subirUltimo(llave, ultimo);
      }
    }
    const capturedAt = aUtc(c.capturedAt);
    let respuesta: RespuestaDestino;
    if (ultimo && ultimo >= capturedAt) {
      respuesta = {
        resultado: 'conflicto',
        target: null,
        serverCapturedAt: ultimo,
        message: `El servidor ya tiene un dato de esta tienda y presentación capturado el ${ultimo}, más reciente que esta captura. No se sobrescribió; la captura quedó guardada.`,
      };
    } else {
      // Paso 3: el destino (hoy SIMULADO; el mapeo real está PENDIENTE).
      respuesta = await this.destino.enviar(c, { token, correlationId, userId: usuario.id, client: lote.client });
    }

    const final = this.aplicar(doc, respuesta, ahora);
    await this.repo.guardarCaptura(final);
    if (esFinal(final)) await this.rapido.guardarCaptura(this.aCache(final));
    if (final.status === 'aceptada') await this.rapido.subirUltimo(llave, capturedAt);
    return igual(this.aResultado(final));
  }

  private aplicar(doc: CapturaGuardada, r: RespuestaDestino, ahora: Date): CapturaGuardada {
    const base = { ...doc, updatedAt: ahora };
    switch (r.resultado) {
      case 'aceptada':
        return { ...base, status: 'aceptada', target: r.target };
      case 'conflicto':
        return {
          ...base,
          status: 'conflicto',
          target: r.target,
          serverCapturedAt: new Date(r.serverCapturedAt),
          reason: { code: 'CONFLICT', message: r.message },
        };
      case 'rechazada':
        return { ...base, status: 'rechazada', reason: { code: r.code, message: r.message } };
      case 'no_disponible':
        return { ...base, status: 'rechazada', retryable: true, reason: { code: 'SERVICE_UNAVAILABLE', message: r.message } };
    }
  }

  private enOtroEnvio(c: CapturaEntrada): ResultadoCaptura {
    return resultado({
      captureId: c.captureId,
      type: c.type,
      capturedAt: aUtc(c.capturedAt),
      status: 'rechazada',
      reason: { code: 'CONFLICT', message: 'La captura se está procesando en otro envío; reintenta el lote.' },
      retryable: true,
    });
  }

  private aResultado(doc: CapturaGuardada): ResultadoCaptura {
    return resultado({
      captureId: doc.captureId,
      type: doc.type,
      status: doc.status as EstadoFinal,
      capturedAt: doc.capturedAt.toISOString(),
      target: doc.target,
      serverCapturedAt: doc.serverCapturedAt ? doc.serverCapturedAt.toISOString() : null,
      reason: doc.reason,
      retryable: doc.retryable,
    });
  }

  private aCache(doc: CapturaGuardada): CapturaEnCache {
    return {
      captureId: doc.captureId,
      batchId: doc.batchId,
      userId: doc.userId,
      type: doc.type,
      hash: doc.hash,
      status: doc.status as EstadoFinal,
      capturedAt: doc.capturedAt.toISOString(),
      target: doc.target,
      serverCapturedAt: doc.serverCapturedAt ? doc.serverCapturedAt.toISOString() : null,
      reason: doc.reason,
    };
  }

  // ======================= Auditoría y avisos (§8) =======================

  private despacharAvisos(acuse: Acuse, nuevas: ResultadoCaptura[], accion: 'insert' | 'update', token: string): void {
    const r = resumir(nuevas);
    const conflictos = r.conflictos;
    const tarea = (async () => {
      const [auditoria, aviso] = await Promise.all([
        this.avisos.auditar(
          {
            tabla: 'lotes_sync',
            registroId: acuse.batchId,
            accion,
            descripcion: `Lote de ${acuse.summary.total} capturas (cliente ${acuse.client}): ${r.aceptadas} aceptadas, ${r.conflictos} en conflicto, ${r.rechazadas} rechazadas, ${acuse.summary.duplicadas} duplicadas.`,
          },
          token,
        ),
        conflictos > 0
          ? this.avisos.notificar(
              {
                eventType: 'sync.conflicto',
                relatedEntityType: 'lote_sync',
                relatedEntityId: acuse.batchId,
                recipientUserId: acuse.userId,
                title: 'Capturas en conflicto',
                message: `${conflictos} captura(s) del lote no se aplicaron porque el servidor ya tenía un dato más reciente. Quedaron guardadas.`,
                priority: 'warning',
              },
              token,
            )
          : Promise.resolve({ estado: 'no_aplica' as const, error: null }),
      ]);
      await this.repo.marcarEntrega(acuse.batchId, 'audit', auditoria.estado, auditoria.error);
      await this.repo.marcarEntrega(acuse.batchId, 'notification', aviso.estado, aviso.error);
    })().catch((e) => this.logger.warn(`No se pudo guardar el estado de los avisos de ${acuse.batchId}: ${String(e)}`));
    this.enVuelo.add(tarea);
    void tarea.finally(() => this.enVuelo.delete(tarea));
  }

  /** Para las pruebas: espera a que terminen los avisos en vuelo. */
  async esperarAvisos(): Promise<void> {
    await Promise.all([...this.enVuelo]);
  }

  // ======================= Consultas =======================

  async obtener(batchId: string, usuario: Solicitante): Promise<Acuse> {
    const lote = await this.repo.buscarLote(batchId);
    const leeTodo = (ROLES_QUE_LEEN_TODO as readonly string[]).includes(usuario.rol);
    // Ajeno = inexistente (no se confirma que exista).
    if (!lote || (!leeTodo && lote.userId !== usuario.id)) throw new NotFoundException('Lote no encontrado.');
    if (!lote.resultados || !lote.resumen) {
      throw new ConflictException('El lote no terminó de procesarse; reenvíalo para recuperar el acuse.');
    }
    return {
      batchId: lote.batchId,
      deviceId: lote.deviceId,
      userId: lote.userId,
      client: lote.client,
      contractVersion: lote.contractVersion,
      receivedAt: lote.receivedAt.toISOString(),
      resend: false,
      correlationId: lote.correlationId,
      summary: lote.resumen,
      results: lote.resultados,
    };
  }

  async listar(
    q: { deviceId?: string; status?: string; dateFrom?: string; dateTo?: string; userId?: string; page?: number; limit?: number },
    usuario: Solicitante,
  ): Promise<Pagina<Pick<Acuse, 'batchId' | 'deviceId' | 'userId' | 'client' | 'receivedAt' | 'summary'>>> {
    const leeTodo = (ROLES_QUE_LEEN_TODO as readonly string[]).includes(usuario.rol);
    if (q.userId && !leeTodo) throw new ForbiddenException('Solo el Administrador y el Auditor filtran por userId.');
    const errores: string[] = [];
    if (q.status && !(ESTADOS_CAPTURA as readonly string[]).includes(q.status)) {
      errores.push(`status debe ser uno de: ${ESTADOS_CAPTURA.join(', ')}`);
    }
    if (q.dateFrom && !esFechaValida(q.dateFrom)) errores.push('dateFrom debe ser una fecha YYYY-MM-DD');
    if (q.dateTo && !esFechaValida(q.dateTo)) errores.push('dateTo debe ser una fecha YYYY-MM-DD');
    if (!errores.length && q.dateFrom && q.dateTo && q.dateFrom > q.dateTo) errores.push('dateFrom no puede ser posterior a dateTo');
    if (q.page && q.page > 1_000_000) errores.push('page debe ser menor o igual a 1000000');
    if (errores.length) throw new BadRequestException(errores);

    const filtro: FiltroLotes = {
      userId: leeTodo ? q.userId : usuario.id,
      deviceId: q.deviceId,
      status: q.status,
      desde: q.dateFrom ? inicioDelDia(q.dateFrom) : undefined,
      hasta: q.dateTo ? finDelDia(q.dateTo) : undefined,
    };
    const page = q.page ?? PAGINA_DEFAULT;
    const limit = Math.min(q.limit ?? LIMITE_DEFAULT, LIMITE_MAXIMO);
    const { filas, total } = await this.repo.listarLotes(filtro, (page - 1) * limit, limit);
    return {
      data: filas.map((l) => ({
        batchId: l.batchId,
        deviceId: l.deviceId,
        userId: l.userId,
        client: l.client,
        receivedAt: l.receivedAt.toISOString(),
        summary: l.resumen ?? resumir([]),
      })),
      total,
      page,
      limit,
    };
  }
}
