import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'municipios' })
export class MunicipioEntity {
  @PrimaryGeneratedColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'varchar', length: 80, unique: true })
  nombre: string;
}
