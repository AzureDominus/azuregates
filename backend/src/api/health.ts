import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/env.js';
import { BACKEND_VERSION } from '../version.js';
import { STARTUP_TIME } from '../main.js';

const GPIO_SERVICE_URL = process.env.GPIO_SERVICE_URL || 'http://172.17.0.1:5000';
const AUTHENTIK_URL = process.env.AUTHENTIK_URL || 'https://authentik:9443';

export async function healthRoutes(app: FastifyInstance) {
  // Basic health check
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: BACKEND_VERSION,
    });
  });

  // Startup info endpoint (no auth required) - for splash screen
  app.get('/health/startup', async (_request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    const uptimeMs = now - STARTUP_TIME;
    const startedAt = new Date(STARTUP_TIME).toISOString();
    
    // Check if Authentik is reachable
    let authentikReady = false;
    try {
      const response = await fetch(`${AUTHENTIK_URL}/-/health/ready/`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      authentikReady = response.ok;
    } catch {
      // Authentik not ready
    }

    // Check if database is ready
    let databaseReady = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      databaseReady = true;
    } catch {
      // Database not ready
    }

    const allReady = authentikReady && databaseReady;

    return reply.send({
      status: allReady ? 'ready' : 'starting',
      startedAt,
      uptimeMs,
      version: BACKEND_VERSION,
      checks: {
        authentik: authentikReady,
        database: databaseReady,
      },
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
