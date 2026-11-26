// La resolución DNS (getaddrinfo) usa el threadpool de libuv, de 4 hilos por defecto. El reporte consulta a
// varios servicios a la vez y el DNS de un servicio apagado tarda ~2.5 s en fallar: con 4 hilos esas
// búsquedas bloquean las de los servicios sanos y los marcan "no disponibles" por timeout. Debe fijarse
// ANTES de la primera operación que use el pool.
process.env.UV_THREADPOOL_SIZE ??= '32';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configurarApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configurarApp(app);

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
