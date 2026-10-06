import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { AuditReporter } from './common/audit/audit-reporter.service';
import { CatalogClient } from './common/catalog/catalog-client.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { AnalyticsService } from './analytics/analytics.service';
import { TransactionsController } from './transactions/transactions.controller';
import { TransactionsService } from './transactions/transactions.service';
import { BasketsController } from './baskets/baskets.controller';
import { BasketsService } from './baskets/baskets.service';
import { Basket } from './entities/basket.entity';
import { CategoriaProductoEntity } from './entities/categoria-producto.entity';
import { CodigoPostalEntity } from './entities/codigo-postal.entity';
import { DireccionEntity } from './entities/direccion.entity';
import { Importacion } from './entities/importacion.entity';
import { ImportacionError } from './entities/importacion-error.entity';
import { ImportacionFila } from './entities/importacion-fila.entity';
import { MunicipioEntity } from './entities/municipio.entity';
import { ProductoEntity } from './entities/producto.entity';
import { ProductoPresentacionEntity } from './entities/producto-presentacion.entity';
import { RoleEntity } from './entities/role.entity';
import { TiendaEntity } from './entities/tienda.entity';
import { Transaction } from './entities/transaction.entity';
import { TransactionDetail } from './entities/transaction-detail.entity';
import { UnidadMedidaEntity } from './entities/unidad-medida.entity';
import { UsuarioEntity } from './entities/usuario.entity';
import { ZonaEntity } from './entities/zona.entity';
import { ProveedorEntity } from './entities/proveedor.entity';

/**
 * core-process-service: proceso principal (M06 transacciones + importación
 * CSV, M07 canastas) más M09 analítica descriptiva sobre esos mismos datos.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.getOrThrow('database'),
    }),
    TypeOrmModule.forFeature([
      Basket,
      CategoriaProductoEntity,
      CodigoPostalEntity,
      DireccionEntity,
      Importacion,
      ImportacionError,
      ImportacionFila,
      MunicipioEntity,
      ProductoEntity,
      ProductoPresentacionEntity,
      RoleEntity,
      TiendaEntity,
      Transaction,
      TransactionDetail,
      UnidadMedidaEntity,
      UsuarioEntity,
      ZonaEntity,
      ProveedorEntity,
    ]),
    JwtModule.register({}),
  ],
  controllers: [HealthController, AnalyticsController, TransactionsController, BasketsController],
  providers: [
    AnalyticsService,
    TransactionsService,
    BasketsService,
    CatalogClient,
    AuditReporter,
    SessionGuard,
  ],
  exports: [SessionGuard],
})
export class AppModule {}
