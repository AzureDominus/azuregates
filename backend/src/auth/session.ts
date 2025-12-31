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
  isAdmin?: boolean;
  isGuest?: boolean;
  guestExpiry?: Date;
  permissions?: string[];
  // Guest scope info (for guest sessions)
  guestScopeType?: 'LOCATION' | 'AREA' | 'DEVICE';
  guestScopeId?: string;
  // Account activation status
  isActivated?: boolean;
  wasEverActivated?: boolean;
}

// Session data interface
export interface SessionData {
  user?: SessionUser;
  guestToken?: string;
  returnTo?: string;
  // OIDC tokens for refresh flow
  idToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: number; // Unix timestamp in seconds
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

  // Import connect-redis and create store
  // Use dynamic import to get the class (ESM named export)
  const connectRedis = await import('connect-redis');
  const RedisStore = connectRedis.RedisStore;
  
  // Session TTL: 30 days of inactivity
  // The refresh token flow will keep extending the session as long as the user is active
  const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
  const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

  // Create Redis store with the redis client
  const redisStore = new RedisStore({
    client: redisClient,
    prefix: 'gates:session:',
    ttl: SESSION_TTL_SECONDS,
  });

  // Register session plugin
  await app.register(session, {
    secret: config.sessionSecret,
    store: redisStore,
    cookie: {
      secure: config.nodeEnv === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
      path: '/',
    },
    saveUninitialized: false,
    rolling: true, // Extend session TTL on each request
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

// Fastify preHandler for requiring authentication
export async function authPreHandler(request: FastifyRequest, reply: FastifyReply) {
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
}

// Fastify preHandler for requiring admin access
export async function adminPreHandler(request: FastifyRequest, reply: FastifyReply) {
  await authPreHandler(request, reply);
  if (reply.sent) return; // Auth already failed
  
  const user = getCurrentUser(request);
  if (!user?.isAdmin) {
    return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
  }
}

/**
 * Fastify preHandler for requiring an activated account.
 * Should be used after authPreHandler for routes that require activation.
 * Guests bypass activation check (they have their own scope limits).
 * Admins always pass (they are auto-activated).
 */
export async function activatedPreHandler(request: FastifyRequest, reply: FastifyReply) {
  await authPreHandler(request, reply);
  if (reply.sent) return; // Auth already failed
  
  const user = getCurrentUser(request);
  
  // Guests bypass activation (they have invite-based access)
  if (user?.isGuest) {
    return;
  }
  
  // Admins are always allowed (they are auto-activated)
  if (user?.isAdmin) {
    return;
  }
  
  // Check activation status
  if (!user?.isActivated) {
    // Distinguish between pending approval and disabled account
    if (user?.wasEverActivated) {
      return reply.status(403).send({ 
        error: 'AccountDisabled', 
        message: 'Your account has been disabled. Please contact an administrator.',
      });
    } else {
      return reply.status(403).send({ 
        error: 'AccountPending', 
        message: 'Your account is pending admin approval.',
      });
    }
  }
}

// Auth guard decorator for routes (legacy)
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
