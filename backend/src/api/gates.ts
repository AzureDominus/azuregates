import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { executeGateCommand } from '../drivers/executor.js';
import { checkPermission } from '../permissions/checker.js';
import { logAudit } from '../audit/logger.js';
import { getCurrentUser, authPreHandler } from '../auth/session.js';

const commandSchema = z.object({
  action: z.enum(['open', 'close', 'stop', 'toggle']),
});

export async function gatesRoutes(app: FastifyInstance) {
  // All routes in this module require authentication
  app.addHook('preHandler', authPreHandler);

  // List all locations
  app.get('/locations', async (request: FastifyRequest, reply: FastifyReply) => {
    const locations = await prisma.location.findMany({
      include: {
        areas: {
          include: {
            gates: true,
          },
        },
      },
    });
    return reply.send(locations);
  });

  // Get single location
  app.get('/locations/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const location = await prisma.location.findUnique({
      where: { id: request.params.id },
      include: {
        areas: {
          include: {
            gates: true,
          },
        },
      },
    });

    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    return reply.send(location);
  });

  // List areas in a location
  app.get('/locations/:id/areas', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const areas = await prisma.area.findMany({
      where: { locationId: request.params.id },
      include: { gates: true },
    });
    return reply.send(areas);
  });

  // Get single area
  app.get('/areas/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const area = await prisma.area.findUnique({
      where: { id: request.params.id },
      include: { gates: true, location: true },
    });

    if (!area) {
      return reply.status(404).send({ error: 'Area not found' });
    }

    return reply.send(area);
  });

  // List gates in an area
  app.get('/areas/:id/gates', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const gates = await prisma.gate.findMany({
      where: { areaId: request.params.id },
    });
    return reply.send(gates);
  });

  // Get all gates (flat list)
  app.get('/gates', async (_request: FastifyRequest, reply: FastifyReply) => {
    const gates = await prisma.gate.findMany({
      include: {
        area: {
          include: {
            location: true,
          },
        },
      },
    });
    return reply.send(gates);
  });

  // Get single gate
  app.get('/gates/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const gate = await prisma.gate.findUnique({
      where: { id: request.params.id },
      include: {
        area: {
          include: {
            location: true,
          },
        },
      },
    });

    if (!gate) {
      return reply.status(404).send({ error: 'Gate not found' });
    }

    return reply.send(gate);
  });

  // Execute gate command
  app.post(
    '/gates/:id/command',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { action: string } }>,
      reply: FastifyReply
    ) => {
      const startTime = Date.now();
      const clientIp = request.ip;
      const userAgent = request.headers['user-agent'];

      // Validate request body
      const parsed = commandSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: parsed.error.flatten(),
        });
      }

      const { action } = parsed.data;
      const gateId = request.params.id;

      // Get gate
      const gate = await prisma.gate.findUnique({
        where: { id: gateId },
        include: {
          area: {
            include: {
              location: true,
            },
          },
        },
      });

      if (!gate) {
        await logAudit({
          gateId,
          action,
          result: 'failure',
          errorMessage: 'Gate not found',
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });
        return reply.status(404).send({ error: 'Gate not found' });
      }

      // Check if gate is enabled
      if (!gate.enabled) {
        await logAudit({
          gateId,
          action,
          result: 'denied',
          errorMessage: 'Gate is disabled',
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });
        return reply.status(403).send({ error: 'Gate is disabled' });
      }

      // Check if area and location are enabled
      if (!gate.area.enabled || !gate.area.location.enabled) {
        await logAudit({
          gateId,
          action,
          result: 'denied',
          errorMessage: 'Gate area or location is disabled',
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });
        return reply.status(403).send({ error: 'Gate area or location is disabled' });
      }

      // Check gate capabilities
      if (!gate.capabilities.includes(action)) {
        await logAudit({
          gateId,
          action,
          result: 'failure',
          errorMessage: `Gate does not support action: ${action}`,
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });
        return reply.status(400).send({
          error: `Gate does not support action: ${action}`,
          supportedActions: gate.capabilities,
        });
      }

      // Check user permissions
      const user = getCurrentUser(request);
      const userId = user?.id;
      
      // Require authentication
      if (!user) {
        await logAudit({
          gateId,
          action,
          result: 'denied',
          errorMessage: 'Not authenticated',
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });
        return reply.status(401).send({ 
          error: 'Unauthorized',
          message: 'Authentication required',
        });
      }

      // Admins bypass permission checks
      if (!user.isAdmin) {
        // Guests have limited permissions based on their invite scope
        if (user.isGuest) {
          // Check if the action is in their allowed permissions
          if (!user.permissions?.includes(action)) {
            await logAudit({
              userId,
              gateId,
              action,
              result: 'denied',
              errorMessage: 'Guest does not have permission for this action',
              clientIp,
              userAgent,
              latencyMs: Date.now() - startTime,
            });
            return reply.status(403).send({ 
              error: 'Permission denied',
              message: 'You do not have permission for this action',
            });
          }
        } else {
          // Regular users - check database permissions
          const permResult = await checkPermission(userId!, gate, action, user.isAdmin);
          if (!permResult.allowed) {
            await logAudit({
              userId,
              gateId,
              action,
              result: 'denied',
              errorMessage: permResult.reason || 'Permission denied',
              clientIp,
              userAgent,
              latencyMs: Date.now() - startTime,
            });
            return reply.status(403).send({ 
              error: 'Permission denied',
              message: permResult.reason,
            });
          }
        }
      }

      // Execute command via driver
      try {
        const result = await executeGateCommand(gate, action);

        // Check if the driver reported failure
        if (!result.success) {
          await logAudit({
            userId,
            gateId,
            action,
            result: 'failure',
            errorMessage: result.message,
            clientIp,
            userAgent,
            latencyMs: Date.now() - startTime,
            metadata: { ...result } as Record<string, unknown>,
          });

          return reply.status(400).send({
            success: false,
            gate: { id: gate.id, name: gate.name },
            action,
            error: result.message,
            result,
          });
        }

        await logAudit({
          userId,
          gateId,
          action,
          result: 'success',
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
          metadata: { ...result } as Record<string, unknown>,
        });

        return reply.send({
          success: true,
          gate: { id: gate.id, name: gate.name },
          action,
          result,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';

        await logAudit({
          gateId,
          action,
          result: 'failure',
          errorMessage,
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });

        request.log.error({ err, gateId, action }, 'Gate command failed');
        return reply.status(500).send({ error: 'Command execution failed', details: errorMessage });
      }
    }
  );

  // Get audit logs
  app.get('/audit-logs', async (request: FastifyRequest<{ Querystring: { gateId?: string; limit?: string; offset?: string } }>, reply: FastifyReply) => {
    const { gateId, limit = '50', offset = '0' } = request.query;

    const logs = await prisma.auditLog.findMany({
      where: gateId ? { gateId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit, 10), 100),
      skip: parseInt(offset, 10),
      include: {
        gate: { select: { id: true, name: true } },
        user: { select: { id: true, displayName: true, email: true } },
      },
    });

    return reply.send(logs);
  });
}
