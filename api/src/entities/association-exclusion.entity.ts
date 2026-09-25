import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * M10 — Par de categorías que no debe reportarse como asociación
 * (`reglas_exclusion_asociacion`, RN-10). M10 solo la lee.
 *
 * El hecho es simétrico, así que la base guarda el par ordenado
 * (chk_exclusion_par_canonico: categoria_a_id < categoria_b_id). Quien
 * busque un par debe ordenarlo igual antes de compararlo.
 */
@Entity({ name: 'reglas_exclusion_asociacion' })
export class AssociationExclusion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'categoria_a_id', type: 'smallint' })
  categoryAId: number;

  @Column({ name: 'categoria_b_id', type: 'smallint' })
  categoryBId: number;

  @Column({ name: 'descripcion', type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'activo', type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'creado_por', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
