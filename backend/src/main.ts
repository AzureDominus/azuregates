import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import { config } from './config/env.js';
import { healthRoutes } from './api/health.js';
import { gatesRoutes } from './api/gates.js';
import { configRoutes } from './api/config.js';
import { adminRoutes } from './api/admin.js';
import { eventsRoutes } from './api/events.js';
import { oidcRoutes } from './auth/oidc.js';
import { guestRoutes } from './auth/guest.js';
import { setupSession } from './auth/session.js';
import { loadConfig } from './config/loader.js';
import { startCleanupJob, stopCleanupJob } from './jobs/cleanup.js';

// Record startup time for splash screen logic
export const STARTUP_TIME = Date.now();

const app = Fastify({
  // Trust proxy headers (X-Forwarded-For, etc) set by Caddy
  trustProxy: true,
  logger: {
    level: config.logLevel,
    transport:
      config.nodeEnv === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  },
});

// Register plugins
await app.register(cors, {
  // In development, allow all origins. In production, use CORS_ORIGIN env var or fall back to BASE_URL
  origin: config.nodeEnv === 'development' ? true : (config.corsOrigin || config.baseUrl || true),
  credentials: true,
});

await app.register(helmet, {
  contentSecurityPolicy: config.nodeEnv === 'production',
});

await app.register(cookie, {
  secret: config.sessionSecret,
});

// Set up session with Redis store
try {
  await setupSession(app);
} catch (err) {
  app.log.warn({ err }, 'Failed to setup Redis session store, using in-memory fallback');
  // Register in-memory session as fallback (30-day TTL to match Redis config)
  const session = await import('@fastify/session');
  const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  await app.register(session.default, {
    secret: config.sessionSecret,
    cookie: {
      secure: config.nodeEnv === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    },
    saveUninitialized: false,
    rolling: true, // Extend session on each request
  });
  app.log.info('In-memory session middleware configured as fallback');
}

// Register routes
await app.register(healthRoutes, { prefix: '/api' });
await app.register(oidcRoutes, { prefix: '/api/auth' });
await app.register(guestRoutes, { prefix: '/api/guest' });
await app.register(gatesRoutes, { prefix: '/api' });
await app.register(eventsRoutes, { prefix: '/api' });
await app.register(configRoutes, { prefix: '/api/config' });
await app.register(adminRoutes, { prefix: '/api/admin' });

// Load gate configuration on startup
try {
  await loadConfig();
  app.log.info('Gate configuration loaded successfully');
} catch (err) {
  app.log.error({ err }, 'Failed to load gate configuration');
  // Continue running - config can be fixed via API
}

// Start the stale account cleanup job
startCleanupJob();

// Graceful shutdown
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down gracefully`);
    stopCleanupJob();
    await app.close();
    process.exit(0);
  });
});

// Start server
try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`Server running on port ${config.port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

export { app };
