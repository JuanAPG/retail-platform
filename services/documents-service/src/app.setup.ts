import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { middlewareCorrelacion } from './common/correlation/correlacion';
import { HttpErrorFilter } from './common/filters/http-error.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { XmlInterceptor } from './common/interceptors/xml.interceptor';

/**
 * Lo transversal de la app (correlación, CORS, prefijo, validación, errores,
 * logging, XML). Lo usan `main.ts` y las pruebas de integración en proceso,
 * para que prueben exactamente lo que corre en el contenedor.
 */
export function configurarApp(app: INestApplication): void {
  // Antes que todo (guards incluidos): hasta un 401 lleva su X-Correlation-Id (T-02).
  app.use(middlewareCorrelacion);
  // El web lee el nombre del archivo exportado y cita los ids de la operación.
  app.enableCors({ exposedHeaders: ['Content-Disposition', 'X-Correlation-Id', 'x-request-id'] });
  // Todas las rutas cuelgan de /v1/ (estándar transversal).
  // `/docs` queda fuera del prefijo para no versionar la documentación.
  app.setGlobalPrefix('v1', { exclude: ['docs', 'docs-json'] });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new HttpErrorFilter());
  // El XmlInterceptor necesita el Reflector para leer `@XmlRoot` y poner la
  // raíz que declara el XSD del endpoint.
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new XmlInterceptor(app.get(Reflector)),
  );

}
