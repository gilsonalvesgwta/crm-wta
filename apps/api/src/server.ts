import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConsoleLogger } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';
import type { Config } from './config.js';

/** Monta a aplicação. Usado pelo main.ts e pelos testes. */
export async function createApp(cfg: Config, opts: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 1_048_576,
    genReqId: () => randomUUID(),
    logger: opts.logger === false || cfg.LOG_LEVEL === 'silent' ? false : { level: cfg.LOG_LEVEL },
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(cfg), adapter, {
    logger: opts.logger === false
      ? false
      : cfg.NODE_ENV === 'production'
        ? new ConsoleLogger({ json: true, logLevels: ['error', 'warn', 'log'] })
        : ['error', 'warn', 'log'],
    bufferLogs: false,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(fastifyCookie as any);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onSend', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    reply.header('x-frame-options', 'DENY');
  });
  await app.init();
  await fastify.ready();
  return app;
}
