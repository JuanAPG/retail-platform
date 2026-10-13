import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { SesionUsuario } from '../common/auth/session.guard';
import { AuditReporter } from '../common/audit/audit-reporter.service';
import { ContextoPeticion } from '../common/audit/audit.module';
import { AvisoDecision, NotificationsReporter } from '../common/notifications/notifications-reporter.service';
import { ROL } from '../common/roles';
import { Pagina } from '../common/dto/pagination.dto';
import { paginar } from '../common/helpers/pagination.helper';
import { Recommendation, RecommendationStatus } from '../entities/recommendation.entity';
import {
  RecommendationEvidence,
  RecommendationEvidenceDimension,
} from '../entities/recommendation-evidence.entity';
import { RecommendationContextDto, RecommendationQueryDto } from './dto/recommendation-context.dto';
import { RecommendationExplanation, RecommendationSummary } from './dto/recommendation-explanation.dto';

interface EvidenceDraft {
  dimension: RecommendationEvidenceDimension;
  referenceId: string;
  description: string;
}

/** Borrador de recomendación: lo que arma `evaluateRules`, sin persistir todavía. */
export interface RecommendationDraft {
  corridaId: string | null;
  escenarioId: string | null;
  zonaId: string | null;
  title: string;
  whatRecommends: string;
  why: string;
  estimatedImpact: string;
  evidence: EvidenceDraft[];
}

const ELASTICITY_HIGH = 2;
const ELASTICITY_LOW = 0.3;
const ACCESSIBILITY_LOW = 0.4;
const REVENUE_VARIATION_MIN_PCT = 15;
const ASSOCIATION_MIN_LIFT = 2;
const ASSOCIATION_MIN_CONFIDENCE = 0.5;

/**
 * M14 — Recomendaciones, según Contrato de Métodos y Endpoints. Motor de
 * reglas simple (no IA): cada regla lee resultados YA calculados por otros
 * módulos (M10 asociación, M11 elasticidad, M12 accesibilidad, M13
 * simulación) y arma una recomendación con las 4 preguntas que exige el
 * schema (qué, por qué, con qué datos, qué impacto). `recomendaciones` no
 * tiene `creado_por`, así que este servicio no necesita el usuario del JWT.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    @InjectRepository(Recommendation)
    private readonly recommendationRepo: Repository<Recommendation>,
    @InjectRepository(RecommendationEvidence)
    private readonly evidenceRepo: Repository<RecommendationEvidence>,
    private readonly dataSource: DataSource,
    /** Bitácora de cada recomendación creada (acción `generar_recomendacion`). */
    private readonly audit: AuditReporter,
    /** Avisos `recomendacion.generada` y `recomendacion.resuelta` (D-12). */
    private readonly avisos: NotificationsReporter,
  ) {}

  /** Corre las 4 reglas sobre el contexto dado. No escribe nada. */
  async evaluateRules(context: RecommendationContextDto): Promise<RecommendationDraft[]> {
    const [accesibilidad, elasticidad, simulacion, asociacion] = await Promise.all([
      this.reglaAccesibilidad(context.zoneId),
      this.reglaElasticidad(context.zoneId),
      this.reglaSimulacion(context.zoneId),
      this.reglaAsociacion(),
    ]);
    return [...accesibilidad, ...elasticidad, ...simulacion, ...asociacion];
  }

  /**
   * Evalúa las reglas y persiste cada resultado (recomendación + evidencia).
   * NO acumula pendientes: en la misma transacción reemplaza las
   * 'propuesta' del alcance evaluado (ver `borrarPendientes`); las
   * aceptadas/descartadas se conservan como historial. Sin borradores no
   * borra nada. `contexto` lleva el token y la IP para la bitácora: una
   * entrada por recomendación creada, después de confirmar la transacción.
   */
  async generate(context: RecommendationContextDto, contexto: ContextoPeticion = {}): Promise<Recommendation[]> {
    const borradores = await this.evaluateRules(context);
    if (borradores.length === 0) {
      return [];
    }

    const guardadas = await this.dataSource.transaction(async (manager) => {
      await this.borrarPendientes(manager, context.zoneId, borradores);
      const guardadas: Recommendation[] = [];
      for (const borrador of borradores) {
        const recomendacion = await manager.save(
          manager.create(Recommendation, {
            corridaId: borrador.corridaId,
            escenarioId: borrador.escenarioId,
            zonaId: borrador.zonaId,
            titulo: borrador.title,
            queRecomienda: borrador.whatRecommends,
            porQue: borrador.why,
            impactoEstimado: borrador.estimatedImpact,
            estatus: 'propuesta',
          }),
        );
        if (borrador.evidence.length > 0) {
          await manager.insert(
            RecommendationEvidence,
            borrador.evidence.map((e) => ({
              recomendacionId: recomendacion.id,
              dimension: e.dimension,
              referenciaId: e.referenceId,
              descripcion: e.description,
            })),
          );
        }
        guardadas.push(recomendacion);
      }
      return guardadas;
    });

    // Fuera de la transacción: reportar nunca lanza, y una bitácora caída no
    // debe deshacer recomendaciones ya guardadas.
    await Promise.all(
      guardadas.map((r) =>
        this.audit.reportar(
          {
            tabla: 'recomendaciones',
            registroId: r.id,
            accion: 'generar_recomendacion',
            descripcion: r.titulo,
            ip: contexto.ip ?? null,
          },
          contexto.token,
        ),
      ),
    );
    // D-12: un solo aviso por `generate` a la bandeja del Gerente de
    // categoría, que es quien decide. Solo ids y conteo, sin contenido.
    this.avisar(
      {
        evento: 'recomendacion.generada',
        recipientRole: ROL.GERENTE_CATEGORIA,
        payload: {
          relatedEntityId: guardadas[0].id,
          title: guardadas.length === 1 ? 'Nueva recomendación' : `${guardadas.length} recomendaciones nuevas`,
          message:
            `Se generaron ${guardadas.length} recomendación(es) pendientes de decisión: ` +
            `${guardadas.map((r) => r.id).join(', ')}.`,
        },
      },
      contexto,
    );
    return guardadas;
  }

  /**
   * Sin `await`: el aviso no retrasa la respuesta, y si notifications-service
   * falla (403, 5xx, timeout) la operación ya quedó hecha igual. Se reenvía
   * el token del usuario: con su rol el receptor valida el origen.
   */
  private avisar(aviso: AvisoDecision, contexto: ContextoPeticion): void {
    void this.avisos.notificar(aviso, { token: contexto.token }).catch(() => undefined);
  }

  /**
   * Borra las 'propuesta' que el `generate` actual reemplaza (la evidencia
   * se va con ellas: `recomendacion_evidencias` es ON DELETE CASCADE).
   * - Sin zona: se evaluaron todas las reglas en todas las zonas, así que
   *   se borran TODAS las 'propuesta'.
   * - Con zona: las 'propuesta' de esa zona, más las 'propuesta' sin zona
   *   con el mismo título que un borrador nuevo sin zona (las de asociación
   *   no dependen de la zona y se volverían duplicados).
   * Nunca toca 'aceptada' ni 'descartada'.
   */
  private async borrarPendientes(
    manager: EntityManager,
    zoneId: string | undefined,
    borradores: RecommendationDraft[],
  ): Promise<void> {
    if (!zoneId) {
      await manager.query(`DELETE FROM recomendaciones WHERE estatus = 'propuesta'`);
      return;
    }
    const titulosSinZona = [...new Set(borradores.filter((b) => b.zonaId === null).map((b) => b.title))];
    await manager.query(
      `
      DELETE FROM recomendaciones
      WHERE estatus = 'propuesta'
        AND (zona_id = $1 OR (zona_id IS NULL AND titulo = ANY($2::text[])))
      `,
      [zoneId, titulosSinZona],
    );
  }

  /** Lista paginada, recientes primero; filtros opcionales por zona y estatus. */
  async list(filtros: RecommendationQueryDto): Promise<Pagina<RecommendationSummary>> {
    const qb = this.recommendationRepo.createQueryBuilder('r');
    if (filtros.zoneId) qb.andWhere('r.zonaId = :zoneId', { zoneId: filtros.zoneId });
    if (filtros.status) qb.andWhere('r.estatus = :status', { status: filtros.status });
    const pagina = await paginar(qb.orderBy('r.generadaEn', 'DESC').addOrderBy('r.id', 'ASC'), filtros);
    return {
      ...pagina,
      data: pagina.data.map((r) => ({
        id: r.id,
        title: r.titulo,
        whatRecommends: r.queRecomienda,
        why: r.porQue,
        estimatedImpact: r.impactoEstimado,
        zoneId: r.zonaId,
        scenarioId: r.escenarioId,
        runId: r.corridaId,
        status: r.estatus,
        generatedAt: r.generadaEn,
      })),
    };
  }

  /** D-12: genera el Planeador, decide el Gerente. 'propuesta' → 'aceptada'. */
  approve(id: string, user: SesionUsuario, contexto: ContextoPeticion = {}): Promise<RecommendationExplanation> {
    return this.decidir(id, 'aceptada', user, contexto);
  }

  /** D-12: 'propuesta' → 'descartada'; el motivo queda en la bitácora. */
  reject(
    id: string,
    motivo: string,
    user: SesionUsuario,
    contexto: ContextoPeticion = {},
  ): Promise<RecommendationExplanation> {
    return this.decidir(id, 'descartada', user, contexto, motivo);
  }

  /**
   * Un solo UPDATE condicionado a `estatus = 'propuesta'`: si dos decisiones
   * llegan a la vez, solo una afecta la fila; la otra recibe 409.
   * D-12: la decisión se avisa al Planeador (`recomendacion.resuelta`); el
   * Auditor recibe copia automática desde notifications-service, así que
   * aquí NO se le manda un segundo aviso.
   */
  private async decidir(
    id: string,
    nuevo: Exclude<RecommendationStatus, 'propuesta'>,
    user: SesionUsuario,
    contexto: ContextoPeticion,
    motivo?: string,
  ): Promise<RecommendationExplanation> {
    const resultado = await this.recommendationRepo.update({ id, estatus: 'propuesta' }, { estatus: nuevo });
    if (!resultado.affected) {
      const actual = await this.recommendationRepo.findOne({ where: { id } });
      if (!actual) throw new NotFoundException(`No existe la recomendación ${id}.`);
      throw new ConflictException(
        `La recomendación ya fue decidida (estatus "${actual.estatus}"): solo se puede aprobar o rechazar una 'propuesta'.`,
      );
    }

    const aprobada = nuevo === 'aceptada';
    await this.audit.reportar(
      {
        tabla: 'recomendaciones',
        registroId: id,
        accion: aprobada ? 'aprobar' : 'rechazar',
        descripcion:
          `Recomendación ${aprobada ? 'aceptada' : 'descartada'} por ${user.email} (${user.id}, ${user.rol}).` +
          (motivo ? ` Motivo: ${motivo}` : ''),
        cambios: [{ campo: 'estatus', previo: 'propuesta', posterior: nuevo }],
        ip: contexto.ip ?? null,
      },
      contexto.token,
    );
    this.avisar(
      {
        evento: 'recomendacion.resuelta',
        recipientRole: ROL.PLANEADOR,
        payload: {
          relatedEntityId: id,
          title: 'Recomendación resuelta',
          message: `Recomendación ${id} ${aprobada ? 'aprobada' : 'rechazada'}.` + (motivo ? ` Motivo: ${motivo}` : ''),
        },
      },
      contexto,
    );
    return this.explain(id);
  }

  async explain(recommendationId: string): Promise<RecommendationExplanation> {
    const recomendacion = await this.recommendationRepo.findOne({ where: { id: recommendationId } });
    if (!recomendacion) {
      throw new NotFoundException(`No existe la recomendación ${recommendationId}.`);
    }
    const evidencia = await this.evidenceRepo.find({ where: { recomendacionId: recommendationId } });

    return {
      recommendationId: recomendacion.id,
      title: recomendacion.titulo,
      whatRecommends: recomendacion.queRecomienda,
      why: recomendacion.porQue,
      estimatedImpact: recomendacion.impactoEstimado,
      evidence: evidencia.map((e) => ({
        dimension: e.dimension,
        referenceId: e.referenciaId,
        description: e.descripcion,
      })),
      status: recomendacion.estatus,
      generatedAt: recomendacion.generadaEn,
    };
  }

  /** Regla 1 — accesibilidad baja: zonas con índice vigente por debajo del umbral. */
  private async reglaAccesibilidad(zoneId?: string): Promise<RecommendationDraft[]> {
    const filas: {
      zonaId: string;
      zona: string;
      indice: string;
      corridaId: string;
      ejecutadaEn: Date;
    }[] = await this.dataSource.query(
      `
      SELECT zona_id AS "zonaId", zona, indice::text AS indice, corrida_id AS "corridaId", ejecutada_en AS "ejecutadaEn"
      FROM v_dashboard_accesibilidad_zona
      WHERE indice < $1 AND ($2::uuid IS NULL OR zona_id = $2::uuid)
      `,
      [ACCESSIBILITY_LOW, zoneId ?? null],
    );

    return filas.map((f) => ({
      corridaId: f.corridaId,
      escenarioId: null,
      zonaId: f.zonaId,
      title: `Accesibilidad baja en zona ${f.zona}`,
      whatRecommends: `Revisar el precio o la disponibilidad de productos básicos en la zona "${f.zona}".`,
      why:
        `El índice de accesibilidad vigente de esta zona es ${f.indice} (por debajo del umbral de ${ACCESSIBILITY_LOW}), ` +
        'lo que indica que la canasta básica es poco alcanzable para el ingreso estimado de sus habitantes.',
      estimatedImpact:
        'Mejorar el componente más bajo (precio, disponibilidad o cobertura de básicos) subiría el índice y ' +
        'facilitaría el acceso a productos básicos en la zona.',
      evidence: [
        {
          dimension: 'zona',
          referenceId: f.zonaId,
          description: `Índice de accesibilidad ${f.indice}, calculado en la corrida del ${f.ejecutadaEn.toISOString()}.`,
        },
      ],
    }));
  }

  /**
   * Regla 2 — elasticidad extrema: presentaciones muy sensibles (|E| alta,
   * no subir precio) o muy poco sensibles (|E| baja, hay margen de subida).
   * Se queda solo con la corrida más reciente por presentación/zona.
   */
  private async reglaElasticidad(zoneId?: string): Promise<RecommendationDraft[]> {
    const filas: {
      presentacionId: string;
      producto: string;
      presentacion: string;
      zonaId: string | null;
      zona: string | null;
      valor: string;
      corridaId: string;
      ejecutadaEn: Date;
    }[] = await this.dataSource.query(
      `
      SELECT DISTINCT ON (e.presentacion_id, e.zona_id)
             e.presentacion_id AS "presentacionId", p.nombre AS producto, pp.nombre AS presentacion,
             e.zona_id AS "zonaId", z.nombre AS zona, e.valor::text AS valor,
             c.id AS "corridaId", c.ejecutada_en AS "ejecutadaEn"
      FROM elasticidades e
      JOIN analisis_corridas c ON c.id = e.corrida_id
      JOIN producto_presentaciones pp ON pp.id = e.presentacion_id
      JOIN productos p ON p.id = pp.producto_id
      LEFT JOIN zonas z ON z.id = e.zona_id
      WHERE c.tipo = 'elasticidad' AND c.estado = 'completada'
        AND ($1::uuid IS NULL OR e.zona_id = $1::uuid)
      ORDER BY e.presentacion_id, e.zona_id, c.ejecutada_en DESC
      `,
      [zoneId ?? null],
    );

    const recomendaciones: RecommendationDraft[] = [];
    for (const f of filas) {
      const valor = Number(f.valor);
      const nombre = `${f.producto} ${f.presentacion}`;
      const lugar = f.zona ? ` en la zona ${f.zona}` : ' a nivel nacional';
      const evidence: EvidenceDraft[] = [
        {
          dimension: 'producto',
          referenceId: f.presentacionId,
          description: `Elasticidad ${f.valor}${lugar}, calculada en la corrida del ${f.ejecutadaEn.toISOString()}.`,
        },
      ];

      if (Math.abs(valor) > ELASTICITY_HIGH) {
        recomendaciones.push({
          corridaId: f.corridaId,
          escenarioId: null,
          zonaId: f.zonaId,
          title: `${nombre} es muy sensible al precio${lugar}`,
          whatRecommends: `Evitar subir el precio de ${nombre}${lugar}; considerar promociones en vez de un alza.`,
          why: `Su elasticidad calculada es ${f.valor} (|E| > ${ELASTICITY_HIGH}): un aumento de precio genera una caída de demanda proporcionalmente mayor.`,
          estimatedImpact: 'Subir el precio aquí probablemente reduzca el ingreso total, no solo las unidades vendidas.',
          evidence,
        });
      } else if (Math.abs(valor) < ELASTICITY_LOW) {
        recomendaciones.push({
          corridaId: f.corridaId,
          escenarioId: null,
          zonaId: f.zonaId,
          title: `${nombre} tiene margen de ajuste de precio${lugar}`,
          whatRecommends: `Evaluar un incremento moderado de precio en ${nombre}${lugar}.`,
          why: `Su elasticidad calculada es ${f.valor} (|E| < ${ELASTICITY_LOW}): la demanda reacciona poco a cambios de precio.`,
          estimatedImpact: 'Un incremento de precio aquí probablemente suba el ingreso sin afectar mucho las unidades vendidas.',
          evidence,
        });
      }
    }
    return recomendaciones;
  }

  /**
   * Regla 3 — escenarios de simulación con buen impacto en ingreso
   * (indicador `ingreso_estimado`, variación positiva por encima del
   * umbral).
   */
  private async reglaSimulacion(zoneId?: string): Promise<RecommendationDraft[]> {
    const filas: {
      escenarioId: string;
      escenarioNombre: string;
      zonaId: string | null;
      zona: string | null;
      valorBase: string;
      valorSimulado: string;
      variacionPct: string;
      presentacionId: string | null;
    }[] = await this.dataSource.query(
      `
      SELECT r.escenario_id AS "escenarioId", e.nombre AS "escenarioNombre", e.zona_id AS "zonaId", z.nombre AS zona,
             r.valor_base::text AS "valorBase", r.valor_simulado::text AS "valorSimulado",
             r.variacion_pct::text AS "variacionPct",
             (SELECT ec.presentacion_id FROM escenario_cambios ec WHERE ec.escenario_id = e.id LIMIT 1) AS "presentacionId"
      FROM escenario_resultados r
      JOIN escenarios e ON e.id = r.escenario_id
      JOIN indicadores i ON i.id = r.indicador_id
      LEFT JOIN zonas z ON z.id = e.zona_id
      WHERE i.clave = 'ingreso_estimado' AND r.variacion_pct > $1
        AND ($2::uuid IS NULL OR e.zona_id = $2::uuid)
      `,
      [REVENUE_VARIATION_MIN_PCT, zoneId ?? null],
    );

    return filas.map((f) => {
      const lugar = f.zona ? ` en la zona ${f.zona}` : '';
      const evidence: EvidenceDraft = f.zonaId
        ? {
            dimension: 'zona',
            referenceId: f.zonaId,
            description: `Escenario "${f.escenarioNombre}": ingreso estimado de ${f.valorBase} a ${f.valorSimulado} (${f.variacionPct}%).`,
          }
        : {
            dimension: 'producto',
            referenceId: f.presentacionId ?? f.escenarioId,
            description: `Escenario "${f.escenarioNombre}": ingreso estimado de ${f.valorBase} a ${f.valorSimulado} (${f.variacionPct}%).`,
          };

      return {
        corridaId: null,
        escenarioId: f.escenarioId,
        zonaId: f.zonaId,
        title: `Escenario "${f.escenarioNombre}" mejora el ingreso estimado${lugar}`,
        whatRecommends: `Adoptar el cambio simulado en el escenario "${f.escenarioNombre}"${lugar}.`,
        why: `Este escenario proyecta un aumento de ${f.variacionPct}% en el ingreso estimado (de ${f.valorBase} a ${f.valorSimulado})${lugar}.`,
        estimatedImpact:
          'Si el comportamiento real de la demanda se parece al proyectado, aplicar este cambio incrementaría el ingreso en esa proporción.',
        evidence: [evidence],
      };
    });
  }

  /**
   * Regla 4 — asociación fuerte entre productos (M10): venta cruzada.
   * No se acota por zona: `reglas_asociacion` no tiene ese dato.
   */
  private async reglaAsociacion(): Promise<RecommendationDraft[]> {
    const filas: {
      reglaId: string;
      corridaId: string;
      soporte: string;
      confianza: string;
      lift: string;
      antecedente: string;
      consecuente: string;
    }[] = await this.dataSource.query(
      `
      SELECT regla_id AS "reglaId", corrida_id AS "corridaId", soporte::text AS soporte,
             confianza::text AS confianza, lift::text AS lift, antecedente, consecuente
      FROM v_dashboard_asociaciones
      WHERE lift > $1 AND confianza > $2 AND antecedente IS NOT NULL AND consecuente IS NOT NULL
      ORDER BY lift DESC
      LIMIT 20
      `,
      [ASSOCIATION_MIN_LIFT, ASSOCIATION_MIN_CONFIDENCE],
    );

    return filas.map((f) => ({
      corridaId: f.corridaId,
      escenarioId: null,
      zonaId: null,
      title: `Oportunidad de venta cruzada: ${f.antecedente} → ${f.consecuente}`,
      whatRecommends: `Promocionar o exhibir juntos "${f.antecedente}" y "${f.consecuente}".`,
      why:
        `Regla de asociación con soporte ${f.soporte}, confianza ${f.confianza} y lift ${f.lift}: quienes compran ` +
        `"${f.antecedente}" tienen ${f.lift}x más probabilidad de comprar también "${f.consecuente}" que el promedio.`,
      estimatedImpact: `Agruparlos en promociones o anaquel podría aumentar las ventas cruzadas de "${f.consecuente}".`,
      evidence: [
        {
          dimension: 'producto',
          referenceId: f.reglaId,
          description: `Regla de asociación: soporte ${f.soporte}, confianza ${f.confianza}, lift ${f.lift}.`,
        },
      ],
    }));
  }
}
