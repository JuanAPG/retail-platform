import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationError, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
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

  const serviceName = process.env.SERVICE_NAME ?? 'unknown-service';
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle(serviceName)
      .setDescription(`Microservicio ${serviceName} — Plataforma minorista. Responde JSON y XML según Accept.`)
      .setVersion(process.env.SERVICE_VERSION ?? '1.0.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`${serviceName} escuchando en http://localhost:${port}`);
}
bootstrap();
