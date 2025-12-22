import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import { config } from './config/env.js';
import { healthRoutes } from './api/health.js';
import { gatesRoutes } from './api/gates.js';
import { configRoutes } from './api/config.js';
import { oidcRoutes } from './auth/oidc.js';
import { guestRoutes } from './auth/guest.js';
import { setupSession } from './auth/session.js';
import { loadConfig } from './config/loader.js';

const app = Fastify({
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
  origin: config.nodeEnv === 'development' ? true : config.corsOrigin,
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
  // For development without Redis, we can continue with cookie-only sessions
}

// Register routes
await app.register(healthRoutes, { prefix: '/api' });
await app.register(oidcRoutes, { prefix: '/api/auth' });
await app.register(guestRoutes, { prefix: '/api/guest' });
await app.register(gatesRoutes, { prefix: '/api' });
await app.register(configRoutes, { prefix: '/api/config' });

// Load gate configuration on startup
try {
  await loadConfig();
  app.log.info('Gate configuration loaded successfully');
} catch (err) {
  app.log.error({ err }, 'Failed to load gate configuration');
  // Continue running - config can be fixed via API
}

// Graceful shutdown
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    app.log.info(`Received ${signal}, shutting down gracefully`);
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
