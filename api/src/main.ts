import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  // whitelist: descarta campos no declarados en los DTO.
  // forbidNonWhitelisted: rechaza la petición si llegan campos extra.
  // transform: convierte payloads planos a instancias de clase (DTO).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Plataforma de Análisis de Ingreso y Patrones de Consumo Minorista')
    .setDescription(
      'Backend monolito modular. Cada módulo de negocio agrupa sus rutas bajo su propia etiqueta.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API escuchando en http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Documentación Swagger en http://localhost:${port}/docs`);
}
bootstrap();
