import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configurarApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configurarApp(app);
  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT ?? '3115', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`${process.env.SERVICE_NAME ?? 'promotion-service'} escuchando en http://localhost:${port}`);
}
bootstrap();
