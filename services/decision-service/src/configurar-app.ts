import { INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { middlewareCorrelacion } from './common/correlation/correlacion';
import { HttpErrorFilter } from './common/filters/http-error.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { XmlInterceptor } from './common/interceptors/xml.interceptor';

/** Pasa a español el error de propiedad no permitida, a cualquier profundidad. */
function traducirNoPermitidos(errores: ValidationError[]): void {
  for (const error of errores) {
    if (error.constraints?.whitelistValidation) {
      error.constraints.whitelistValidation = `${error.property} no es un parámetro permitido.`;
    }
    if (error.children?.length) traducirNoPermitidos(error.children);
  }
}

/**
 * Lo transversal de la app (sin cambios respecto a lo que hacía `main.ts`):
 * CORS, prefijo `/v1`, `ValidationPipe`, filtro de errores e interceptores.
 * Va aparte para que las pruebas en proceso usen exactamente la misma
 * configuración que el servicio real. Se llama antes de `listen`/`init`.
 */
export function configurarApp(app: INestApplication): void {
  // Antes que todo (guards incluidos): hasta un 401 lleva su X-Correlation-Id (T-02).
  app.use(middlewareCorrelacion);
  app.enableCors({ exposedHeaders: ['X-Correlation-Id', 'x-request-id'] });
  // Todas las rutas cuelgan de /v1/ (estándar transversal).
  // `/docs` queda fuera del prefijo para no versionar la documentación.
  app.setGlobalPrefix('v1', { exclude: ['docs', 'docs-json'] });

  // La fábrica por defecto de Nest arma el 400 de siempre; solo se le
  // traduce antes el mensaje de `forbidNonWhitelisted`, que class-validator
  // trae fijo en inglés.
  const fabricaPorDefecto = new ValidationPipe().createExceptionFactory();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errores) => {
        traducirNoPermitidos(errores);
        return fabricaPorDefecto(errores);
      },
    }),
  );
  app.useGlobalFilters(new HttpErrorFilter());
  // El XmlInterceptor necesita el Reflector para leer `@XmlRoot` y poner la
  // raíz que declara el XSD del endpoint.
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new XmlInterceptor(app.get(Reflector)),
  );
}
