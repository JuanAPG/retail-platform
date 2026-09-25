import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { AssociationRule } from './association-rule.entity';
import { ProductoEntity } from './producto.entity';

/** Valores del enum `lado_regla` en Postgres. */
export type AssociationRuleSide = 'antecedente' | 'consecuente';

/**
 * M10 — Un producto de un lado de una regla (`regla_asociacion_items`).
 * Apunta a PRODUCTO y no a presentación: comprar leche de 1 L o de 500 ml
 * es el mismo comportamiento de compra, así que Apriori trabaja con las
 * presentaciones agrupadas en su producto.
 */
@Entity({ name: 'regla_asociacion_items' })
export class AssociationRuleItem {
  @PrimaryColumn({ name: 'regla_id', type: 'uuid' })
  ruleId: string;

  @PrimaryColumn({ name: 'producto_id', type: 'uuid' })
  productId: string;

  /** Enum `lado_regla`, mapeado como varchar (ver AnalysisRun). */
  @PrimaryColumn({ name: 'lado', type: 'varchar' })
  side: AssociationRuleSide;

  @ManyToOne(() => AssociationRule, (r) => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'regla_id' })
  rule: AssociationRule;

  @ManyToOne(() => ProductoEntity)
  @JoinColumn({ name: 'producto_id' })
  product: ProductoEntity;
}
