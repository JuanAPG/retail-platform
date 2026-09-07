import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ZonaEntity } from './zona.entity';
import { DireccionEntity } from './direccion.entity';
import { ProveedorEntity } from './proveedor.entity';

@Entity({ name: 'tiendas' })
export class TiendaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  nombre: string;

  @Column({ name: 'direccion_id', type: 'uuid' })
  direccionId: string;

  @ManyToOne(() => DireccionEntity, { eager: true })
  @JoinColumn({ name: 'direccion_id' })
  direccion: DireccionEntity;

  @Column({ name: 'zona_id', type: 'uuid' })
  zonaId: string;

  @ManyToOne(() => ZonaEntity, { eager: true })
  @JoinColumn({ name: 'zona_id' })
  zona: ZonaEntity;

  @Column({ name: 'proveedor_id', type: 'uuid', nullable: true })
  proveedorId: string | null;

  @ManyToOne(() => ProveedorEntity, { eager: true, nullable: true })
  @JoinColumn({ name: 'proveedor_id' })
  proveedor: ProveedorEntity | null;

  @Column({ type: 'varchar', length: 30 })
  formato: string;

  @Column({ name: 'numero_sucursal', type: 'varchar', length: 20, nullable: true })
  numeroSucursal: string | null;

  @Column({ type: 'boolean', default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
