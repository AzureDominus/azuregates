import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { executeGateCommand, getGateStatus, type GateStatus } from '../drivers/executor.js';
import { checkPermission, getAccessibleGateIds, getAccessibleGateIdsForGuest } from '../permissions/checker.js';
import { logAudit } from '../audit/logger.js';
import { getCurrentUser, authPreHandler, activatedPreHandler } from '../auth/session.js';
import { broadcastGateCommand, broadcastGateStatus } from './events.js';

/**
 * Extract real client IP from request, checking proxy headers first.
 * Caddy sets X-Real-IP for local requests and CF-Connecting-IP for Cloudflare.
 */
function getClientIp(request: FastifyRequest): string {
  // Cloudflare tunnel sets this
  const cfIp = request.headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') return cfIp;
  
  // Caddy sets X-Real-IP
  const realIp = request.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') return realIp;
  
  // X-Forwarded-For may contain comma-separated list, take first
  const forwardedFor = request.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = (typeof forwardedFor === 'string' ? forwardedFor : forwardedFor[0]).split(',');
    return ips[0].trim();
  }
  
  // Fall back to direct connection IP
  return request.ip;
}

/**
 * Get accessible gate IDs for the current user, handling both regular users and guests.
 */
async function getAccessibleGates(user: ReturnType<typeof getCurrentUser>): Promise<Set<string>> {
  if (!user) {
    return new Set();
  }
  
  // For guests, use their session scope
  if (user.isGuest && user.guestScopeType && user.guestScopeId) {
    return getAccessibleGateIdsForGuest(user.guestScopeType, user.guestScopeId);
  }
  
  // For regular users, check database permissions
  return getAccessibleGateIds(user.id, user.isAdmin);
}

const commandSchema = z.object({
  action: z.enum(['open', 'close', 'stop', 'toggle']),
});

export async function gatesRoutes(app: FastifyInstance) {
  // All routes in this module require authentication AND an activated account
  // (except for guests who have their own invite-based access)
  app.addHook('preHandler', activatedPreHandler);

  // List all locations (filtered by user permissions)
  app.get('/locations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleGateIds = await getAccessibleGates(user);

    const locations = await prisma.location.findMany({
      include: {
        areas: {
          include: {
            gates: true,
          },
        },
      },
    });

    // Filter to only show gates user has access to
    // If user has no accessible gates, return empty array
    if (accessibleGateIds.size === 0 && !user?.isAdmin) {
      return reply.send([]);
    }

    // Filter gates in each area, then filter out empty areas and locations
    const filteredLocations = locations
      .map((location) => ({
        ...location,
        areas: location.areas
          .map((area) => ({
            ...area,
            gates: area.gates.filter((gate) => accessibleGateIds.has(gate.id)),
          }))
          .filter((area) => area.gates.length > 0),
      }))
      .filter((location) => location.areas.length > 0);

    return reply.send(filteredLocations);
  });

  // Get single location (filtered by user permissions)
  app.get('/locations/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleGateIds = await getAccessibleGates(user);

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

    // Filter to only accessible gates
    const filteredLocation = {
      ...location,
      areas: location.areas
        .map((area) => ({
          ...area,
          gates: area.gates.filter((gate) => accessibleGateIds.has(gate.id)),
        }))
        .filter((area) => area.gates.length > 0),
    };

    // If user has no access to any gates in this location, return 403
    if (filteredLocation.areas.length === 0 && !user?.isAdmin) {
      return reply.status(403).send({ error: 'No access to gates in this location' });
    }

    return reply.send(filteredLocation);
  });

  // List areas in a location (filtered by user permissions)
  app.get('/locations/:id/areas', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleGateIds = await getAccessibleGates(user);

    const areas = await prisma.area.findMany({
      where: { locationId: request.params.id },
      include: { gates: true },
    });

    // Filter to only show areas with accessible gates
    const filteredAreas = areas
      .map((area) => ({
        ...area,
        gates: area.gates.filter((gate) => accessibleGateIds.has(gate.id)),
      }))
      .filter((area) => area.gates.length > 0);

    return reply.send(filteredAreas);
  });

  // Get single area (filtered by user permissions)
  app.get('/areas/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleGateIds = await getAccessibleGates(user);

    const area = await prisma.area.findUnique({
      where: { id: request.params.id },
      include: { gates: true, location: true },
    });

    if (!area) {
      return reply.status(404).send({ error: 'Area not found' });
    }

    // Filter to only accessible gates
    const filteredArea = {
      ...area,
      gates: area.gates.filter((gate) => accessibleGateIds.has(gate.id)),
    };

    // If user has no access to any gates in this area, return 403
    if (filteredArea.gates.length === 0 && !user?.isAdmin) {
      return reply.status(403).send({ error: 'No access to gates in this area' });
    }

    return reply.send(filteredArea);
  });

  // List gates in an area (filtered by user permissions)
  app.get('/areas/:id/gates', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleGateIds = await getAccessibleGates(user);

    const gates = await prisma.gate.findMany({
      where: { areaId: request.params.id },
    });

    // Filter to only accessible gates
    const filteredGates = gates.filter((gate) => accessibleGateIds.has(gate.id));

    return reply.send(filteredGates);
  });

  // Get all gates (flat list, filtered by user permissions)
  app.get('/gates', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleGateIds = await getAccessibleGates(user);

    // If user has no accessible gates, return empty array
    if (accessibleGateIds.size === 0 && !user?.isAdmin) {
      return reply.send([]);
    }

    const gates = await prisma.gate.findMany({
      where: {
        id: { in: Array.from(accessibleGateIds) },
      },
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

  // Get gate status (active operations)
  app.get('/gates/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = getGateStatus();
    return reply.send(status);
  });

  // Get single gate (with permission check)
  app.get('/gates/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleGateIds = await getAccessibleGates(user);

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

    // Check if user has access to this gate
    if (!accessibleGateIds.has(gate.id) && !user?.isAdmin) {
      return reply.status(403).send({ error: 'No access to this gate' });
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
      const clientIp = getClientIp(request);
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

        // Broadcast to all connected SSE clients
        broadcastGateCommand(gate.id, gate.name, action, 'success', userId);
        broadcastGateStatus();

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

        // Broadcast failure to all connected SSE clients
        broadcastGateCommand(gateId, gate.name, action, 'failure', userId);

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
