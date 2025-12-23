import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { adminPreHandler } from '../auth/session.js';
import { logger } from '../lib/logger.js';
import { ScopeType } from '@prisma/client';

const grantPermissionSchema = z.object({
  scopeType: z.enum(['LOCATION', 'AREA', 'GATE']),
  scopeId: z.string(),
  actions: z.array(z.string()).min(1),
  expiresAt: z.string().datetime().optional(),
});

export async function adminRoutes(app: FastifyInstance) {
  // All admin routes require admin access
  app.addHook('preHandler', adminPreHandler);

  // List all users
  app.get('/users', async (_request: FastifyRequest, reply: FastifyReply) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        externalId: true,
        email: true,
        displayName: true,
        isAdmin: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { permissions: true },
        },
      },
    });

    return reply.send(users);
  });

  // Get a specific user with their permissions
  app.get('/users/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
      include: {
        permissions: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return reply.send(user);
  });

  // Grant permission to a user
  app.post('/users/:id/permissions', async (request: FastifyRequest<{ Params: { id: string }; Body: z.infer<typeof grantPermissionSchema> }>, reply: FastifyReply) => {
    const parsed = grantPermissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parsed.error.flatten(),
      });
    }

    const { scopeType, scopeId, actions, expiresAt } = parsed.data;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: request.params.id },
    });

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    // Verify scope exists
    let scopeValid = false;
    let scopeName = '';
    switch (scopeType) {
      case 'LOCATION':
        const location = await prisma.location.findUnique({ where: { id: scopeId } });
        scopeValid = !!location;
        scopeName = location?.name || scopeId;
        break;
      case 'AREA':
        const area = await prisma.area.findUnique({ where: { id: scopeId } });
        scopeValid = !!area;
        scopeName = area?.name || scopeId;
        break;
      case 'GATE':
        const gate = await prisma.gate.findUnique({ where: { id: scopeId } });
        scopeValid = !!gate;
        scopeName = gate?.name || scopeId;
        break;
    }

    if (!scopeValid) {
      return reply.status(404).send({ error: `${scopeType} not found: ${scopeId}` });
    }

    // Create permission
    const permission = await prisma.userPermission.create({
      data: {
        userId: user.id,
        scopeType: scopeType as ScopeType,
        scopeId,
        actions,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    logger.info({ userId: user.id, permissionId: permission.id, scopeType, scopeId }, 'Permission granted');

    return reply.status(201).send({
      success: true,
      permission: {
        ...permission,
        scopeName,
      },
    });
  });

  // Revoke a permission
  app.delete('/permissions/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const permission = await prisma.userPermission.findUnique({
      where: { id: request.params.id },
    });

    if (!permission) {
      return reply.status(404).send({ error: 'Permission not found' });
    }

    await prisma.userPermission.delete({ where: { id: permission.id } });

    logger.info({ permissionId: permission.id, userId: permission.userId }, 'Permission revoked');

    return reply.send({ success: true });
  });

  // Get all scopes (for permission dropdown)
  app.get('/scopes', async (_request: FastifyRequest, reply: FastifyReply) => {
    const [locations, areas, gates] = await Promise.all([
      prisma.location.findMany({ select: { id: true, name: true } }),
      prisma.area.findMany({ select: { id: true, name: true, locationId: true } }),
      prisma.gate.findMany({ select: { id: true, name: true, areaId: true, capabilities: true } }),
    ]);

    return reply.send({
      locations,
      areas,
      gates,
    });
  });
}
