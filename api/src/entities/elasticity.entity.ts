import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, ValueTransformer } from 'typeorm';
import { AnalysisRun } from './analysis-run.entity';
import { ProductoPresentacionEntity } from './producto-presentacion.entity';
import { ZonaEntity } from './zona.entity';

/**
 * Valores del enum `clasificacion_elasticidad` en Postgres. El contrato
 * expone 'elastic' | 'inelastic' | 'unitary'; la traducción la hace
 * ElasticityService.classify.
 */
export type ElasticityClassification = 'elastica' | 'inelastica' | 'unitaria';

/**
 * NUMERIC llega como texto desde Postgres; la elasticidad y el R² son
 * razones con pocos decimales, así que se leen como número. Mismo
 * transformer que AssociationRule (M10), que no está exportado.
 */
const numericAsNumber: ValueTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

/**
 * M11 — Elasticidad precio-demanda de una presentación en una zona
 * (`elasticidades`), producida por una corrida de tipo 'elasticidad'.
 * Apunta a la PRESENTACIÓN, no al producto: el precio vive ahí.
 */
@Entity({ name: 'elasticidades' })
export class Elasticity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'corrida_id', type: 'uuid' })
  runId: string;

  @ManyToOne(() => AnalysisRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'corrida_id' })
  run: AnalysisRun;

  @Column({ name: 'presentacion_id', type: 'uuid' })
  presentationId: string;

  @ManyToOne(() => ProductoPresentacionEntity)
  @JoinColumn({ name: 'presentacion_id' })
  presentation: ProductoPresentacionEntity;

  /** NULL = agregado nacional. */
  @Column({ name: 'zona_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @ManyToOne(() => ZonaEntity, { nullable: true })
  @JoinColumn({ name: 'zona_id' })
  zone: ZonaEntity | null;

  /** Elasticidad E: pendiente de ln(cantidad) contra ln(precio). */
  @Column({ name: 'valor', type: 'numeric', precision: 10, scale: 4, transformer: numericAsNumber })
  value: number;

  /**
   * Columna GENERADA en Postgres a partir de `valor` (|E| > 1.05
   * elástica, < 0.95 inelástica, si no unitaria): solo se lee, así no
   * puede contradecir al valor.
   */
  @Column({ name: 'clasificacion', type: 'varchar', insert: false, update: false })
  classification: ElasticityClassification;

  /** Qué tanto explica el precio los cambios en la demanda (0–1). */
  @Column({
    name: 'r_cuadrada',
    type: 'numeric',
    precision: 6,
    scale: 5,
    nullable: true,
    transformer: numericAsNumber,
  })
  rSquared: number | null;

  /** Observaciones que respaldan el valor (> 0). */
  @Column({ name: 'observaciones', type: 'int' })
  observations: number;
}
