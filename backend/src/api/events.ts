import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authPreHandler, getCurrentUser } from '../auth/session.js';
import { logger } from '../lib/logger.js';
import { getGateStatus } from '../drivers/executor.js';

// Store connected SSE clients
interface SSEClient {
  id: string;
  userId: string;
  reply: FastifyReply;
  lastActivity: number;
}

const clients: Map<string, SSEClient> = new Map();
let clientIdCounter = 0;

// Cleanup stale connections periodically
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 60000; // 1 minute without activity
  
  for (const [id, client] of clients) {
    if (now - client.lastActivity > staleThreshold) {
      logger.debug({ clientId: id, userId: client.userId }, 'Removing stale SSE client');
      clients.delete(id);
    }
  }
}, 30000);

/**
 * Broadcast an event to all connected SSE clients.
 */
export function broadcastEvent(eventType: string, data: unknown): void {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  
  for (const [id, client] of clients) {
    try {
      client.reply.raw.write(message);
      client.lastActivity = Date.now();
    } catch (err) {
      logger.debug({ clientId: id, err }, 'Failed to send SSE event, removing client');
      clients.delete(id);
    }
  }
  
  logger.debug({ eventType, clientCount: clients.size }, 'Broadcasted SSE event');
}

/**
 * Broadcast a gate command event.
 */
export function broadcastGateCommand(gateId: string, gateName: string, action: string, result: 'success' | 'failure' | 'denied', userId?: string): void {
  broadcastEvent('gate-command', {
    gateId,
    gateName,
    action,
    result,
    userId,
    timestamp: Date.now(),
  });
}

/**
 * Broadcast gate status update (active operations).
 */
export function broadcastGateStatus(): void {
  const status = getGateStatus();
  broadcastEvent('gate-status', status);
}

export async function eventsRoutes(app: FastifyInstance) {
  // SSE endpoint - requires authentication
  app.get(
    '/events',
    { preHandler: authPreHandler },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = getCurrentUser(request);
      const clientId = `sse-${++clientIdCounter}`;
      
      logger.info({ clientId, userId: user?.id }, 'SSE client connected');

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      });

      // Send initial connection event with current gate status
      const initialStatus = getGateStatus();
      reply.raw.write(`event: connected\ndata: ${JSON.stringify({ clientId, gateStatus: initialStatus })}\n\n`);

      // Register client
      clients.set(clientId, {
        id: clientId,
        userId: user?.id || 'anonymous',
        reply,
        lastActivity: Date.now(),
      });

      // Send periodic heartbeat to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          reply.raw.write(`: heartbeat\n\n`);
          const client = clients.get(clientId);
          if (client) {
            client.lastActivity = Date.now();
          }
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15000);

      // Handle client disconnect
      request.raw.on('close', () => {
        logger.info({ clientId, userId: user?.id }, 'SSE client disconnected');
        clients.delete(clientId);
        clearInterval(heartbeatInterval);
      });

      // Don't call reply.send() - we're streaming
      return;
    }
  );

  // Get current SSE client count (for monitoring)
  app.get('/events/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      connectedClients: clients.size,
      clients: Array.from(clients.values()).map(c => ({
        id: c.id,
        userId: c.userId,
        lastActivity: c.lastActivity,
      })),
    });
  });
}
