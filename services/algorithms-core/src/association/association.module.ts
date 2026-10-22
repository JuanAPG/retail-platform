import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionGuard } from '../common/auth/session.guard';
import { AssociationExclusion } from '../entities/association-exclusion.entity';
import { ReportesModule } from '../common/reportes/reportes.module';
import { FuenteDatosModule } from '../fuente-datos/fuente-datos.module';
import { AssociationController } from './association.controller';
import { AssociationService } from './association.service';
import { CorridaAsociacionMongo, CorridaAsociacionSchema } from './corrida-asociacion.schema';
import { CorridasAsociacion } from './corridas-asociacion.repository';

/**
 * M10 — Reglas de asociación (Apriori y FP-Growth), trasladado del monolito.
 *
 * Soporte y confianza configurables (RF-15); guarda la CORRIDA COMPLETA
 * (parámetros, fecha, usuario, foto de los datos y resultados) en MongoDB
 * (D3, colección `analysis_runs`) para poder reproducirla (D-15). Las
 * canastas, productos y usuarios llegan por FuenteDatos; de Postgres solo
 * lee sus exclusiones de categorías (RN-10).
 *
 * JwtModule y SessionGuard van aquí (como en catalog-service): el guard
 * necesita JwtService y cada módulo solo ve lo que importa.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AssociationExclusion]),
    MongooseModule.forFeature([{ name: CorridaAsociacionMongo.name, schema: CorridaAsociacionSchema }]),
    FuenteDatosModule,
    ReportesModule,
    JwtModule.register({}),
  ],
  controllers: [AssociationController],
  providers: [AssociationService, CorridasAsociacion, SessionGuard],
  exports: [AssociationService],
})
export class AssociationModule {}
