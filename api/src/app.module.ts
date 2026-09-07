import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import jwtConfig from './config/jwt.config';

// --- Plataforma (ya implementados) ---
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

// --- Catálogo maestro ---
import { StoresModule } from './stores/stores.module';
import { ZonesModule } from './zones/zones.module';
import { ProductsModule } from './products/products.module';
import { SegmentsModule } from './segments/segments.module';
import { PricesModule } from './prices/prices.module';

// --- Cadena de negocio: transacciones -> canastas -> análisis ---
import { TransactionsModule } from './transactions/transactions.module';
import { BasketsModule } from './baskets/baskets.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AssociationModule } from './association/association.module';
import { ElasticityModule } from './elasticity/elasticity.module';
import { AccessibilityModule } from './accessibility/accessibility.module';
import { SimulationModule } from './simulation/simulation.module';
import { RecommendationsModule } from './recommendations/recommendations.module';

// --- Transversal ---
import { AuditModule } from './audit/audit.module';

/**
 * MONOLITO MODULAR. Un solo proceso NestJS; cada módulo de negocio es
 * una carpeta bajo `src/` con sus controladores, servicios y DTO.
 *
 * No se crean microservicios: es una decisión de equipo tomada a
 * propósito y pospuesta al Parcial 2 (ver CLAUDE.md). Tampoco se
 * renombran módulos como `*-service`.
 *
 * Los módulos de M05 en adelante están registrados aunque estén vacíos,
 * para que cada quien trabaje su rama sin tocar este archivo: si las
 * cuatro ramas editaran `app.module.ts`, todas chocarían aquí al mergear.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, jwtConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),

    // M01 Usuarios y acceso
    AuthModule,
    UsersModule,

    // M02-M05, M08 Catálogo maestro
    StoresModule,
    ZonesModule,
    ProductsModule,
    SegmentsModule,
    PricesModule,

    // M06, M07, M09-M14 Cadena de negocio
    TransactionsModule,
    BasketsModule,
    AnalyticsModule,
    AssociationModule,
    ElasticityModule,
    AccessibilityModule,
    SimulationModule,
    RecommendationsModule,

    // M15 Auditoría
    AuditModule,
  ],
})
export class AppModule {}
