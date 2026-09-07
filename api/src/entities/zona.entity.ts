import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MunicipioEntity } from './municipio.entity';

/**
 * Identidad de la zona únicamente. Su clasificación por segmento de
 * ingreso vive en `zona_clasificaciones` (con historial) y sus medidas
 * —ingreso estimado, población, disponibilidad— en `indicador_valores`,
 * porque cambian con el tiempo y no son atributos de la zona.
 */
@Entity({ name: 'zonas' })
export class ZonaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  nombre: string;

  @Column({ name: 'municipio_id', type: 'smallint' })
  municipioId: number;

  @ManyToOne(() => MunicipioEntity, { eager: true })
  @JoinColumn({ name: 'municipio_id' })
  municipio: MunicipioEntity;

  @Column({ type: 'text', nullable: true })
  descripcion: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
