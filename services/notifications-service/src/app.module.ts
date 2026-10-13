import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health/health.controller';
import { SessionGuard } from './common/auth/session.guard';
import { AuditReporter } from './common/audit/audit-reporter.service';
import { NotificationsController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { crearMiddlewareCuerpoXml } from './common/middleware/xml-body.middleware';
import { MongooseModule } from '@nestjs/mongoose';
import { NOTIFICATIONS_REPOSITORY } from './notifications/notifications.repository';
import { MongoNotificationsRepository } from './notifications/mongo.repository';
import { NotificacionMongo, NotificacionSchema } from './notifications/schemas/notification.schema';

/**
 * notifications-service: notificaciones internas en MongoDB (colección
 * `notificaciones`) detrás del puerto NOTIFICATIONS_REPOSITORY; el
 * adaptador en memoria queda para las unitarias.
 *
 * `serverSelectionTimeoutMS` corto y sin buffer (patrón de
 * documents-service): si Mongo se cae en marcha, el health sale
 * `degraded` y las rutas de notificaciones responden 503 al instante.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({}),
    ScheduleModule.forRoot(),
    MongooseModule.forRoot(process.env.MONGO_URL ?? 'mongodb://localhost:27017/retaildb', {
      serverSelectionTimeoutMS: 2000,
      bufferCommands: false,
    }),
    MongooseModule.forFeature([{ name: NotificacionMongo.name, schema: NotificacionSchema }]),
  ],
  controllers: [HealthController, NotificationsController],
  providers: [
    NotificationsService,
    AuditReporter,
    SessionGuard,
    { provide: NOTIFICATIONS_REPOSITORY, useClass: MongoNotificationsRepository },
  ],
  exports: [SessionGuard],
})
export class AppModule implements NestModule {
  /**
   * `POST /v1/notifications` acepta también `application/xml` con raíz
   * `<notificacionRequest>` (XSD del contrato); el resto, solo JSON.
   */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(crearMiddlewareCuerpoXml('notificacionRequest'))
      .forRoutes({ path: 'notifications', method: RequestMethod.POST });
  }
}
