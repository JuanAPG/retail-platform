import { Module } from '@nestjs/common';
import { FuenteDatos } from './fuente-datos.service';

/**
 * Datos de otros servicios para los módulos de algoritmos. Lo importa cada
 * módulo de negocio (association, elasticity, substitution); el
 * `DataSource` lo pone `TypeOrmModule` de app.module.
 */
@Module({
  providers: [FuenteDatos],
  exports: [FuenteDatos],
})
export class FuenteDatosModule {}
