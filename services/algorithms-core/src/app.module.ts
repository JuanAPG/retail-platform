import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssociationModule } from './association/association.module';
import databaseConfig from './config/database.config';
import { ElasticityModule } from './elasticity/elasticity.module';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { SubstitutionModule } from './substitution/substitution.module';

/**
 * algorithms-core: Apriori (M10), elasticidad y sustitución (M11). Lo
 * transversal (filtros, interceptores, SessionGuard) viene de la plantilla
 * y no se modifica; aquí solo se agregan módulos de negocio.
 *
 * Dos almacenes: las corridas de Apriori y FP-Growth van a MongoDB (D3);
 * elasticidades y exclusiones siguen en Postgres. `serverSelectionTimeoutMS`
 * corto y sin buffer (patrón de notifications-service): si Mongo se cae, el
 * health sale `degraded` y las rutas de asociación responden 503 (D-25).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    MongooseModule.forRoot(process.env.MONGO_URL ?? 'mongodb://localhost:27017/retaildb', {
      serverSelectionTimeoutMS: 2000,
      bufferCommands: false,
    }),
    JwtModule.register({}),
    AssociationModule,
    ElasticityModule,
    SubstitutionModule,
  ],
  controllers: [HealthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
