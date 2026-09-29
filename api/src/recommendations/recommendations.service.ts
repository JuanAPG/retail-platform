import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Recommendation } from '../entities/recommendation.entity';
import {
  RecommendationEvidence,
  RecommendationEvidenceDimension,
} from '../entities/recommendation-evidence.entity';
import { RecommendationContextDto } from './dto/recommendation-context.dto';
import { RecommendationExplanation } from './dto/recommendation-explanation.dto';

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

/** Fecha de ejecución en formato legible para las evidencias ("28/09/26, 02:15"), no ISO crudo. */
function formatearFecha(fecha: Date): string {
  return fecha.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
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

  /** Evalúa las reglas y persiste cada resultado (recomendación + evidencia). */
  async generate(context: RecommendationContextDto): Promise<Recommendation[]> {
    const borradores = await this.evaluateRules(context);
    if (borradores.length === 0) {
      return [];
    }

    return this.dataSource.transaction(async (manager) => {
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
          description: `Índice de accesibilidad ${f.indice}, calculado en el análisis del ${formatearFecha(f.ejecutadaEn)}.`,
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
          description: `Elasticidad ${f.valor}${lugar}, calculada en el análisis del ${formatearFecha(f.ejecutadaEn)}.`,
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
