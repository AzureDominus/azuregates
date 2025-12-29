import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { executeDeviceCommand, getDeviceStatus, type DeviceStatus } from '../drivers/executor.js';
import { gpioDriver } from '../drivers/gpio.js';
import { checkPermission, getAccessibleDeviceIds, getAccessibleDeviceIdsForGuest } from '../permissions/checker.js';
import { logAudit } from '../audit/logger.js';
import { getCurrentUser, authPreHandler, activatedPreHandler, type SessionUser } from '../auth/session.js';
import { broadcastDeviceCommand, broadcastDeviceStatus, broadcastDeviceState } from './events.js';
import { validateGuestInvite } from '../auth/guest.js';

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
 * Get accessible device IDs for the current user, handling both regular users and guests.
 */
async function getAccessibleDevices(user: ReturnType<typeof getCurrentUser>): Promise<Set<string>> {
  if (!user) {
    return new Set();
  }
  
  // For guests, use their session scope
  if (user.isGuest && user.guestScopeType && user.guestScopeId) {
    return getAccessibleDeviceIdsForGuest(user.guestScopeType as 'LOCATION' | 'AREA' | 'DEVICE', user.guestScopeId);
  }
  
  // For regular users, check database permissions
  return getAccessibleDeviceIds(user.id, user.isAdmin);
}

// Legacy alias
const getAccessibleGates = getAccessibleDevices;

const commandSchema = z.object({
  action: z.enum(['open', 'close', 'stop', 'toggle', 'on', 'off']),
});

export async function gatesRoutes(app: FastifyInstance) {
  // All routes in this module require authentication AND an activated account
  // (except for guests who have their own invite-based access)
  app.addHook('preHandler', activatedPreHandler);

  // List all locations (filtered by user permissions)
  app.get('/locations', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    const locations = await prisma.location.findMany({
      include: {
        areas: {
          include: {
            devices: true,
          },
        },
      },
    });

    // Filter to only show devices user has access to
    // If user has no accessible devices, return empty array
    if (accessibleDeviceIds.size === 0 && !user?.isAdmin) {
      return reply.send([]);
    }

    // Filter devices in each area, then filter out empty areas and locations
    const filteredLocations = locations
      .map((location) => ({
        ...location,
        areas: location.areas
          .map((area) => ({
            ...area,
            devices: area.devices.filter((device) => accessibleDeviceIds.has(device.id)),
          }))
          .filter((area) => area.devices.length > 0),
      }))
      .filter((location) => location.areas.length > 0);

    return reply.send(filteredLocations);
  });

  // Get single location (filtered by user permissions)
  app.get('/locations/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    const location = await prisma.location.findUnique({
      where: { id: request.params.id },
      include: {
        areas: {
          include: {
            devices: true,
          },
        },
      },
    });

    if (!location) {
      return reply.status(404).send({ error: 'Location not found' });
    }

    // Filter to only accessible devices
    const filteredLocation = {
      ...location,
      areas: location.areas
        .map((area) => ({
          ...area,
          devices: area.devices.filter((device) => accessibleDeviceIds.has(device.id)),
        }))
        .filter((area) => area.devices.length > 0),
    };

    // If user has no access to any devices in this location, return 403
    if (filteredLocation.areas.length === 0 && !user?.isAdmin) {
      return reply.status(403).send({ error: 'No access to devices in this location' });
    }

    return reply.send(filteredLocation);
  });

  // List areas in a location (filtered by user permissions)
  app.get('/locations/:id/areas', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    const areas = await prisma.area.findMany({
      where: { locationId: request.params.id },
      include: { devices: true },
    });

    // Filter to only show areas with accessible devices
    const filteredAreas = areas
      .map((area) => ({
        ...area,
        devices: area.devices.filter((device) => accessibleDeviceIds.has(device.id)),
      }))
      .filter((area) => area.devices.length > 0);

    return reply.send(filteredAreas);
  });

  // Get single area (filtered by user permissions)
  app.get('/areas/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    const area = await prisma.area.findUnique({
      where: { id: request.params.id },
      include: { devices: true, location: true },
    });

    if (!area) {
      return reply.status(404).send({ error: 'Area not found' });
    }

    // Filter to only accessible devices
    const filteredArea = {
      ...area,
      devices: area.devices.filter((device) => accessibleDeviceIds.has(device.id)),
    };

    // If user has no access to any devices in this area, return 403
    if (filteredArea.devices.length === 0 && !user?.isAdmin) {
      return reply.status(403).send({ error: 'No access to devices in this area' });
    }

    return reply.send(filteredArea);
  });

  // List devices in an area (filtered by user permissions)
  app.get('/areas/:id/devices', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    const devices = await prisma.device.findMany({
      where: { areaId: request.params.id },
    });

    // Filter to only accessible devices
    const filteredDevices = devices.filter((device) => accessibleDeviceIds.has(device.id));

    return reply.send(filteredDevices);
  });

  // Legacy route alias
  app.get('/areas/:id/gates', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    const devices = await prisma.device.findMany({
      where: { areaId: request.params.id },
    });

    const filteredDevices = devices.filter((device) => accessibleDeviceIds.has(device.id));

    return reply.send(filteredDevices);
  });

  // Get all devices (flat list, filtered by user permissions)
  app.get('/devices', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    // If user has no accessible devices, return empty array
    if (accessibleDeviceIds.size === 0 && !user?.isAdmin) {
      return reply.send([]);
    }

    const devices = await prisma.device.findMany({
      where: {
        id: { in: Array.from(accessibleDeviceIds) },
      },
      include: {
        area: {
          include: {
            location: true,
          },
        },
      },
    });
    return reply.send(devices);
  });

  // Legacy alias
  app.get('/gates', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    if (accessibleDeviceIds.size === 0 && !user?.isAdmin) {
      return reply.send([]);
    }

    const devices = await prisma.device.findMany({
      where: {
        id: { in: Array.from(accessibleDeviceIds) },
      },
      include: {
        area: {
          include: {
            location: true,
          },
        },
      },
    });
    return reply.send(devices);
  });

  // Get device status (active operations)
  app.get('/devices/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = getDeviceStatus();
    return reply.send(status);
  });

  // Legacy alias
  app.get('/gates/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = getDeviceStatus();
    return reply.send(status);
  });

  // Get single device (with permission check)
  app.get('/devices/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    const device = await prisma.device.findUnique({
      where: { id: request.params.id },
      include: {
        area: {
          include: {
            location: true,
          },
        },
      },
    });

    if (!device) {
      return reply.status(404).send({ error: 'Device not found' });
    }

    // Check if user has access to this device
    if (!accessibleDeviceIds.has(device.id) && !user?.isAdmin) {
      return reply.status(403).send({ error: 'No access to this device' });
    }

    return reply.send(device);
  });

  // Get device state (for maintainState utility devices)
  app.get('/devices/:id/state', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    const device = await prisma.device.findUnique({
      where: { id: request.params.id },
    });

    if (!device) {
      return reply.status(404).send({ error: 'Device not found' });
    }

    // Check if user has access to this device
    if (!accessibleDeviceIds.has(device.id) && !user?.isAdmin) {
      return reply.status(403).send({ error: 'No access to this device' });
    }

    // Only GPIO driver supports state reading currently
    if (device.driverType !== 'gpio') {
      return reply.status(400).send({ error: 'State reading not supported for this driver type' });
    }

    const state = await gpioDriver.readState(device);

    if (state === null) {
      return reply.status(400).send({ 
        error: 'Device does not support state reading', 
        hint: 'Only maintainState utility devices support state reading' 
      });
    }

    return reply.send({
      deviceId: device.id,
      ...state,
    });
  });

  // Legacy alias
  app.get('/gates/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const accessibleDeviceIds = await getAccessibleDevices(user);

    const device = await prisma.device.findUnique({
      where: { id: request.params.id },
      include: {
        area: {
          include: {
            location: true,
          },
        },
      },
    });

    if (!device) {
      return reply.status(404).send({ error: 'Device not found' });
    }

    if (!accessibleDeviceIds.has(device.id) && !user?.isAdmin) {
      return reply.status(403).send({ error: 'No access to this device' });
    }

    return reply.send(device);
  });

  // Execute device command
  app.post(
    '/devices/:id/command',
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
      const deviceId = request.params.id;

      // Get device
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        include: {
          area: {
            include: {
              location: true,
            },
          },
        },
      });

      if (!device) {
        await logAudit({
          deviceId,
          action,
          result: 'failure',
          errorMessage: 'Device not found',
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });
        return reply.status(404).send({ error: 'Device not found' });
      }

      // Check if device is enabled
      if (!device.enabled) {
        await logAudit({
          deviceId,
          action,
          result: 'denied',
          errorMessage: 'Device is disabled',
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });
        return reply.status(403).send({ error: 'Device is disabled' });
      }

      // Check if area and location are enabled
      if (!device.area.enabled || !device.area.location.enabled) {
        await logAudit({
          deviceId,
          action,
          result: 'denied',
          errorMessage: 'Device area or location is disabled',
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });
        return reply.status(403).send({ error: 'Device area or location is disabled' });
      }

      // Check device capabilities
      // For maintainState utilities, on/off are implicitly supported even if not in capabilities
      const driverConfig = device.driverConfig as Record<string, unknown>;
      const isMaintainStateUtility = device.deviceType === 'utility' && driverConfig?.maintainState === true;
      const actionIsImplicitlySupported = isMaintainStateUtility && ['on', 'off'].includes(action);
      
      if (!device.capabilities.includes(action) && !actionIsImplicitlySupported) {
        await logAudit({
          deviceId,
          action,
          result: 'failure',
          errorMessage: `Device does not support action: ${action}`,
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });
        return reply.status(400).send({
          error: `Device does not support action: ${action}`,
          supportedActions: device.capabilities,
        });
      }

      // Check user permissions
      const user = getCurrentUser(request);
      const userId = user?.id;
      
      // Require authentication
      if (!user) {
        await logAudit({
          deviceId,
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
          // SECURITY: Validate that the guest's invite still exists and is valid
          // This ensures deleted/expired invites are immediately revoked
          const session = request.session as { guestToken?: string };
          const inviteValidation = await validateGuestInvite(session.guestToken);
          if (!inviteValidation.valid) {
            await logAudit({
              userId,
              deviceId,
              action,
              result: 'denied',
              errorMessage: `Guest invite invalid: ${inviteValidation.reason}`,
              clientIp,
              userAgent,
              latencyMs: Date.now() - startTime,
            });
            return reply.status(403).send({ 
              error: 'Access revoked',
              message: inviteValidation.reason,
            });
          }

          // Check if the action is in their allowed permissions
          if (!user.permissions?.includes(action)) {
            await logAudit({
              userId,
              deviceId,
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
          const permResult = await checkPermission(userId!, device, action, user.isAdmin);
          if (!permResult.allowed) {
            await logAudit({
              userId,
              deviceId,
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
        const result = await executeDeviceCommand(device, action);
        
        // Broadcast status update after command starts (operation is now tracked)
        // This allows the UI to show the progress bar for async operations
        broadcastDeviceStatus();

        // Check if the driver reported failure
        if (!result.success) {
          await logAudit({
            userId,
            deviceId,
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
            device: { id: device.id, name: device.name },
            action,
            error: result.message,
            result,
          });
        }

        await logAudit({
          userId,
          deviceId,
          action,
          result: 'success',
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
          metadata: { ...result } as Record<string, unknown>,
        });

        // Broadcast to all connected SSE clients
        broadcastDeviceCommand(device.id, device.name, action, 'success', userId);
        broadcastDeviceStatus();

        // For state-changing actions on maintainState utilities, broadcast the new state
        if (['on', 'off', 'toggle'].includes(action)) {
          await broadcastDeviceState(device.id);
        }

        return reply.send({
          success: true,
          device: { id: device.id, name: device.name },
          action,
          result,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';

        await logAudit({
          deviceId,
          action,
          result: 'failure',
          errorMessage,
          clientIp,
          userAgent,
          latencyMs: Date.now() - startTime,
        });

        // Broadcast failure to all connected SSE clients
        broadcastDeviceCommand(deviceId, device.name, action, 'failure', userId);

        request.log.error({ err, deviceId, action }, 'Device command failed');
        return reply.status(500).send({ error: 'Command execution failed', details: errorMessage });
      }
    }
  );

  // Get audit logs
  app.get('/audit-logs', async (request: FastifyRequest<{ Querystring: { deviceId?: string; limit?: string; offset?: string } }>, reply: FastifyReply) => {
    const { deviceId, limit = '20', offset = '0' } = request.query;
    const take = Math.min(parseInt(limit, 10), 100);
    const skip = parseInt(offset, 10);

    const where = deviceId ? { deviceId } : undefined;

    // Get total count for pagination
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: {
          device: { select: { id: true, name: true } },
          user: { select: { id: true, displayName: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Transform logs to include guest info from metadata when user is null
    const transformedLogs = logs.map((log) => {
      const metadata = log.metadata as Record<string, unknown> | null;
      const isGuest = metadata?.isGuest === true;
      
      // For guest actions, synthesize a user object from metadata
      if (isGuest && !log.user) {
        return {
          ...log,
          user: {
            id: (metadata?.guestUserId as string) || 'guest',
            displayName: 'Guest',
            email: null,
            isGuest: true,
            inviteId: metadata?.guestInviteId as string | undefined,
          },
        };
      }
      
      return log;
    });

    return reply.send({
      logs: transformedLogs,
      total,
      limit: take,
      offset: skip,
    });
  });
}
