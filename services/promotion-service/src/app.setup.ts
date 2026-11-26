import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { middlewareCorrelacion } from './common/correlation/correlacion';
import { HttpErrorFilter } from './common/filters/http-error.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { XmlInterceptor } from './common/interceptors/xml.interceptor';

/**
 * Lo transversal de la plantilla (correlación, /v1, validación, error
 * estándar, logging, XML, Swagger), en una función para que `main.ts` y las
 * pruebas armen la app EXACTAMENTE igual.
 */
export function configurarApp(app: INestApplication): OpenAPIObject {
  // Antes que todo (guards incluidos): hasta un 401 lleva su X-Correlation-Id.
  app.use(middlewareCorrelacion);
  app.enableCors({ exposedHeaders: ['X-Correlation-Id', 'x-request-id'] });
  app.setGlobalPrefix('v1', { exclude: ['docs', 'docs-json'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new XmlInterceptor(app.get(Reflector)));

  const servicio = process.env.SERVICE_NAME ?? 'promotion-service';
  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(servicio)
      .setDescription(
        `Microservicio ${servicio} — promociones (D-39): descuento porcentual, paquete y tamaño de empaque. ` +
          'Responde JSON y XML según Accept; recibe JSON o XML (namespace promotion/v1). Contrato: docs/contratos/promotion-service.md.',
      )
      .setVersion(process.env.SERVICE_VERSION ?? '1.0.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, documento);
  return documento;
}
