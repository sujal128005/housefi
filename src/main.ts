import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ConfigError, parseEnv } from './config/env';
import { configureApp, createAdapter } from './http';

async function main(): Promise<void> {
  // Local development only; production gets its environment from AWS Secrets Manager / SSM.
  if (existsSync('.env')) process.loadEnvFile('.env');

  let config;
  try {
    config = parseEnv(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(config), createAdapter(config), { bufferLogs: true });
  await configureApp(app, config);
  await app.listen(config.PORT, '0.0.0.0');
}

void main();
