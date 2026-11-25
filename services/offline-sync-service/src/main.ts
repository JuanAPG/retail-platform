import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configurarApp } from './app.setup';

async function bootstrap() {
  // Sin el parser por defecto: el cuerpo del lote lo lee CuerpoLoteMiddleware (ver app.setup.ts).
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configurarApp(app);
  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT ?? '3118', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`${process.env.SERVICE_NAME ?? 'offline-sync-service'} escuchando en http://localhost:${port}`);
}
bootstrap();
