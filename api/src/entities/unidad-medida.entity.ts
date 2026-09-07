import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Catálogo de unidades. Antes era el texto libre `productos.unidad_medida`. */
@Entity({ name: 'unidades_medida' })
export class UnidadMedidaEntity {
  @PrimaryGeneratedColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', length: 10 })
  clave: string;

  @Column({ type: 'varchar', length: 40 })
  nombre: string;

  @Column({ type: 'varchar', length: 20 })
  tipo: string;

  /** Factor a la unidad base de su tipo: permite comparar precio por kilo. */
  @Column({ name: 'factor_base', type: 'numeric', precision: 12, scale: 6 })
  factorBase: string;
}
