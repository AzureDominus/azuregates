import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import session from '@fastify/session';
import { createClient, RedisClientType } from 'redis';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

// Session user type
export interface SessionUser {
  id: string;
  externalId: string;
  email: string;
  displayName: string;
  isGuest?: boolean;
  guestExpiry?: Date;
  permissions?: string[];
}

// Session data interface
export interface SessionData {
  user?: SessionUser;
  guestToken?: string;
  returnTo?: string;
}

// Extend Fastify session types
declare module '@fastify/session' {
  interface FastifySessionObject extends SessionData {}
}

export async function setupSession(app: FastifyInstance): Promise<void> {
  // Create Redis client for session store
  const redisUrl = config.redisUrl || 'redis://redis:6379';
  const redisClient = createClient({ url: redisUrl }) as RedisClientType;

  redisClient.on('error', (err) => {
    logger.error({ err }, 'Redis session store error');
  });

  await redisClient.connect();
  logger.info('Redis session store connected');

  // Import connect-redis (named export)
  const { RedisStore } = await import('connect-redis');
  
  // Create Redis store
  const redisStore = new RedisStore({
    client: redisClient,
    prefix: 'gates:session:',
    ttl: 86400, // 24 hours
  });

  // Register session plugin
  await app.register(session, {
    secret: config.sessionSecret,
    store: redisStore as any,
    cookie: {
      secure: config.nodeEnv === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 86400000, // 24 hours in ms
      path: '/',
    },
    saveUninitialized: false,
  });

  logger.info('Session middleware configured');
}

// Helper to get current user from session
export function getCurrentUser(request: FastifyRequest): SessionUser | null {
  return (request.session as any)?.user ?? null;
}

// Helper to check if user is authenticated
export function isAuthenticated(request: FastifyRequest): boolean {
  return !!(request.session as any)?.user;
}

// Auth guard decorator for routes
export function requireAuth(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<any>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAuthenticated(request)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Please log in' });
    }

    // Check if guest token has expired
    const user = getCurrentUser(request);
    if (user?.isGuest && user.guestExpiry) {
      if (new Date(user.guestExpiry) < new Date()) {
        (request.session as any).destroy();
        return reply.status(401).send({ error: 'Session expired', message: 'Guest access has expired' });
      }
    }

    return handler(request, reply);
  };
}
