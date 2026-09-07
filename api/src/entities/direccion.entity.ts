import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MunicipioEntity } from './municipio.entity';

/**
 * Domicilio normalizado. Antes era el campo `tiendas.direccion TEXT`:
 * una cadena única impedía agrupar por colonia o por código postal, que
 * es justo lo que necesita el análisis territorial.
 */
@Entity({ name: 'direcciones' })
export class DireccionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  calle: string;

  @Column({ name: 'numero_exterior', type: 'varchar', length: 20, nullable: true })
  numeroExterior: string | null;

  @Column({ name: 'numero_interior', type: 'varchar', length: 20, nullable: true })
  numeroInterior: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  colonia: string | null;

  @Column({ name: 'codigo_postal', type: 'varchar', length: 10, nullable: true })
  codigoPostal: string | null;

  @Column({ name: 'municipio_id', type: 'smallint' })
  municipioId: number;

  @ManyToOne(() => MunicipioEntity, { eager: true })
  @JoinColumn({ name: 'municipio_id' })
  municipio: MunicipioEntity;

  @Column({ type: 'text', nullable: true })
  referencia: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  latitud: string | null;

  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true })
  longitud: string | null;
}
