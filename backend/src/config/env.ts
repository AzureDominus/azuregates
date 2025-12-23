import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3001'),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32),
  AUTHENTIK_URL: z.string().url(),
  AUTHENTIK_EXTERNAL_URL: z.string().url().optional(),
  AUTHENTIK_CLIENT_ID: z.string(),
  AUTHENTIK_CLIENT_SECRET: z.string(),
  AUTHENTIK_SLUG: z.string().default('azure-gates'),
  AUTHENTIK_ADMIN_GROUP: z.string().default('gates-admin'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().optional(),
  MOCK_SERVER_URL: z.string().url().optional(),
  CONFIG_PATH: z.string().default('/app/config/gates.yaml'),
  BASE_URL: z.string().url().default('http://localhost:3000'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  port: parsed.data.PORT,
  databaseUrl: parsed.data.DATABASE_URL,
  redisUrl: parsed.data.REDIS_URL || 'redis://redis:6379',
  sessionSecret: parsed.data.SESSION_SECRET,
  authentik: {
    url: parsed.data.AUTHENTIK_URL,
    externalUrl: parsed.data.AUTHENTIK_EXTERNAL_URL || parsed.data.AUTHENTIK_URL,
    clientId: parsed.data.AUTHENTIK_CLIENT_ID,
    clientSecret: parsed.data.AUTHENTIK_CLIENT_SECRET,
    slug: parsed.data.AUTHENTIK_SLUG,
    adminGroup: parsed.data.AUTHENTIK_ADMIN_GROUP,
  },
  logLevel: parsed.data.LOG_LEVEL,
  corsOrigin: parsed.data.CORS_ORIGIN,
  mockServerUrl: parsed.data.MOCK_SERVER_URL,
  configPath: parsed.data.CONFIG_PATH,
  baseUrl: parsed.data.BASE_URL,
};

export type Config = typeof config;
