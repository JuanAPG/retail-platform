import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MunicipioEntity } from './municipio.entity';

/**
 * Catálogo CP -> municipio.
 *
 * Existe porque `codigo_postal -> municipio_id` es una dependencia
 * funcional cuyo determinante no es llave de `direcciones`: guardar el
 * municipio en cada dirección (esquema v3) permitía que dos direcciones
 * con el mismo CP declararan municipios distintos. Eso rompía FNBC.
 */
@Entity({ name: 'codigos_postales' })
export class CodigoPostalEntity {
  @PrimaryColumn({ name: 'codigo_postal', type: 'varchar', length: 10 })
  codigoPostal: string;

  @Column({ name: 'municipio_id', type: 'smallint' })
  municipioId: number;

  @ManyToOne(() => MunicipioEntity, { eager: true })
  @JoinColumn({ name: 'municipio_id' })
  municipio: MunicipioEntity;
}
