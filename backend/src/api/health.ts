import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/env.js';
import { BACKEND_VERSION } from '../version.js';

const GPIO_SERVICE_URL = process.env.GPIO_SERVICE_URL || 'http://172.17.0.1:5000';

export async function healthRoutes(app: FastifyInstance) {
  // Basic health check
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: BACKEND_VERSION,
    });
  });

  // Detailed health check (includes dependencies)
  app.get('/health/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

    // Database check
    const dbStart = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = { status: 'ok', latencyMs: Date.now() - dbStart };
    } catch (err) {
      checks.database = {
        status: 'error',
        latencyMs: Date.now() - dbStart,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // Config check
    const { getConfig } = await import('../config/loader.js');
    const gatesConfig = getConfig();
    checks.config = gatesConfig
      ? { status: 'ok' }
      : { status: 'warning', error: 'Configuration not loaded' };

    // GPIO service health check
    const gpioStart = Date.now();
    try {
      const response = await fetch(`${GPIO_SERVICE_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        checks.gpio = { status: 'ok', latencyMs: Date.now() - gpioStart };
      } else {
        checks.gpio = {
          status: 'error',
          latencyMs: Date.now() - gpioStart,
          error: `HTTP ${response.status}`,
        };
      }
    } catch (err) {
      checks.gpio = {
        status: 'error',
        latencyMs: Date.now() - gpioStart,
        error: err instanceof Error ? err.message : 'GPIO service unreachable',
      };
    }

    // Overall status
    const isHealthy = Object.values(checks).every(
      (c) => c.status === 'ok' || c.status === 'warning'
    );

    return reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      version: BACKEND_VERSION,
      checks,
    });
  });

  // Liveness probe (minimal check)
  app.get('/health/live', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ status: 'ok' });
  });
}
