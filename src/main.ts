import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from './utils/http-exception.filter';
import { ResponseInterceptor } from './utils/response.interceptor';
import { createOriginGuard, normalizeOrigin } from './utils/origin-guard';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const configService = app.get(ConfigService);
  const isProduction = process.env.NODE_ENV === 'production';
  const jwtSecret = configService.get<string>('jwt.secret');
  const jwtRefreshSecret = configService.get<string>('jwt.refreshSecret');

  if (!jwtSecret || !jwtRefreshSecret) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be configured.');
  }

  const configuredOrigins = configService.get<string>('corsOrigins');
  if (isProduction && !configuredOrigins) {
    throw new Error(
      'CORS_ORIGINS or FRONTEND_URL must be configured in production.',
    );
  }
  const allowedOrigins = (
    configuredOrigins || 'http://localhost:3000,http://127.0.0.1:3000'
  )
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

  // Browsers reach this API only through the frontend's Next.js rewrite proxy,
  // so the socket address is always the frontend server. Trusting that hop lets
  // req.ip come from X-Forwarded-For, so rate limiting and audit logs see the
  // real client instead of lumping every user under one IP. TRUST_PROXY is a
  // comma-separated list of proxy IPs (e.g. the frontend server's private IP).
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

  // Security
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  // The origin guard is the gate (same-origin via the frontend proxy, or listed
  // in CORS_ORIGINS; anything else gets a 403). Whatever passes it may have its
  // Origin reflected in the CORS headers.
  app.use(createOriginGuard(allowedOrigins));
  app.enableCors({ credentials: true, origin: true });

  // Serve static files
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Global Prefix
  app.setGlobalPrefix('api');

  // Increase payload limit for base64 image uploads
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Interceptors & Filters
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('Leave Management API')
    .setDescription('The Leave Management System API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // Hide Swagger in Production
  if (!isProduction) {
    SwaggerModule.setup('api-docs', app, document);
  }

  // Start Server
  const port = configService.get<number>('port') || 8000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://localhost:${port}/api`);
}
void bootstrap().catch((error: unknown) => {
  console.error('Failed to start application', error);
  process.exitCode = 1;
});
// Trigger restart for new port
// restart

// trigger restart

// trigger restart 2
// trigger restart 3
