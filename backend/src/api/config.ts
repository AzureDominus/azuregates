import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { loadConfig, getConfig, saveConfig, getConfigHistory, restoreConfig } from '../config/loader.js';
import type { GatesConfig } from '../config/schema.js';
import { adminPreHandler } from '../auth/session.js';

export async function configRoutes(app: FastifyInstance) {
  // All config routes require admin access
  app.addHook('preHandler', adminPreHandler);

  // Get current configuration
  app.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();

    if (!config) {
      return reply.status(404).send({ error: 'Configuration not loaded' });
    }

    return reply.send(config);
  });

  // Reload configuration from file
  app.post('/reload', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = await loadConfig();
      request.log.info('Configuration reloaded');
      return reply.send({ success: true, config });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      request.log.error({ err }, 'Failed to reload configuration');
      return reply.status(400).send({ error: 'Failed to reload configuration', details: errorMessage });
    }
  });

  // Update configuration
  app.put('/', async (request: FastifyRequest<{ Body: GatesConfig }>, reply: FastifyReply) => {
    try {
      await saveConfig(request.body);
      request.log.info('Configuration updated');
      return reply.send({ success: true, config: request.body });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      request.log.error({ err }, 'Failed to save configuration');
      return reply.status(400).send({ error: 'Failed to save configuration', details: errorMessage });
    }
  });

  // Get configuration history
  app.get('/history', async (_request: FastifyRequest, reply: FastifyReply) => {
    const history = await getConfigHistory();
    return reply.send(history);
  });

  // Restore configuration from history
  app.post(
    '/rollback/:filename',
    async (request: FastifyRequest<{ Params: { filename: string } }>, reply: FastifyReply) => {
      try {
        const config = await restoreConfig(request.params.filename);
        request.log.info({ filename: request.params.filename }, 'Configuration restored from backup');
        return reply.send({ success: true, config });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to restore configuration');
        return reply.status(400).send({ error: 'Failed to restore configuration', details: errorMessage });
      }
    }
  );
}
