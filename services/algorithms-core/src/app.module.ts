import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssociationModule } from './association/association.module';
import databaseConfig from './config/database.config';
import { ElasticityModule } from './elasticity/elasticity.module';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';

/**
 * algorithms-core: Apriori (M10), elasticidad y sustitución (M11). Lo
 * transversal (filtros, interceptores, SessionGuard) viene de la plantilla
 * y no se modifica; aquí solo se agregan módulos de negocio.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    JwtModule.register({}),
    AssociationModule,
    ElasticityModule,
  ],
  controllers: [HealthController],
  providers: [SessionGuard],
  exports: [SessionGuard],
})
export class AppModule {}
