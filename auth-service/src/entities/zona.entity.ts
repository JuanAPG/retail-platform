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

  @Column({ name: 'segmento_ingreso_id', type: 'smallint', nullable: true })
  segmentoIngresoId: number | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
