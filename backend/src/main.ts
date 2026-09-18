import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  // Anexos do chat do lead viram base64 no body JSON (~33% maior que o
  // arquivo original) — 16MB de mídia gera corpo de ~22MB, bem acima do
  // limite default do Express (100kb).
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ limit: '25mb', extended: true }));

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`🚀 ConvertHairCRM running on: http://localhost:${port}/api`);
}

bootstrap();
