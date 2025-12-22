import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes, createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { getCurrentUser, requireAuth, type SessionUser } from './session.js';
import { config } from '../config/env.js';

const createInviteSchema = z.object({
  scopeType: z.enum(['LOCATION', 'AREA', 'GATE']),
  scopeId: z.string(),
  allowedActions: z.array(z.enum(['open', 'close', 'stop', 'toggle'])).min(1),
  expiresInHours: z.number().min(1).max(720).default(24), // 1 hour to 30 days
  maxUses: z.number().min(1).max(100).optional(),
  description: z.string().max(200).optional(),
});

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function guestRoutes(app: FastifyInstance) {
  // Create a new guest invite (magic link)
  app.post(
    '/invites',
    async (
      request: FastifyRequest<{ Body: z.infer<typeof createInviteSchema> }>,
      reply: FastifyReply
    ) => {
      const user = getCurrentUser(request);
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const parsed = createInviteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Invalid request',
          details: parsed.error.flatten(),
        });
      }

      const { scopeType, scopeId, allowedActions, expiresInHours, maxUses, description } = parsed.data;

      // Verify the scope exists
      let scopeValid = false;
      switch (scopeType) {
        case 'LOCATION':
          scopeValid = !!(await prisma.location.findUnique({ where: { id: scopeId } }));
          break;
        case 'AREA':
          scopeValid = !!(await prisma.area.findUnique({ where: { id: scopeId } }));
          break;
        case 'GATE':
          scopeValid = !!(await prisma.gate.findUnique({ where: { id: scopeId } }));
          break;
      }

      if (!scopeValid) {
        return reply.status(404).send({ error: `${scopeType} not found: ${scopeId}` });
      }

      // Generate token
      const token = generateToken();
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

      // Create invite in database
      const invite = await prisma.invite.create({
        data: {
          tokenHash,
          createdById: user.id,
          scopeType,
          scopeId,
          allowedActions,
          expiresAt,
          maxUses,
        },
      });

      // Build magic link URL
      const magicLink = `${config.baseUrl}/guest?token=${token}`;

      logger.info(
        { inviteId: invite.id, scopeType, scopeId, createdBy: user.id },
        'Guest invite created'
      );

      return reply.status(201).send({
        success: true,
        invite: {
          id: invite.id,
          scopeType,
          scopeId,
          allowedActions,
          expiresAt: invite.expiresAt.toISOString(),
          maxUses,
          useCount: 0,
          magicLink,
        },
      });
    }
  );

  // List all invites created by the current user
  app.get('/invites', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const invites = await prisma.invite.findMany({
      where: { createdById: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        scopeType: true,
        scopeId: true,
        allowedActions: true,
        expiresAt: true,
        maxUses: true,
        useCount: true,
        createdAt: true,
      },
    });

    return reply.send(invites);
  });

  // Delete/revoke an invite
  app.delete('/invites/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const invite = await prisma.invite.findUnique({
      where: { id: request.params.id },
    });

    if (!invite) {
      return reply.status(404).send({ error: 'Invite not found' });
    }

    if (invite.createdById !== user.id) {
      return reply.status(403).send({ error: 'You can only delete your own invites' });
    }

    await prisma.invite.delete({ where: { id: invite.id } });

    logger.info({ inviteId: invite.id, deletedBy: user.id }, 'Guest invite deleted');

    return reply.send({ success: true });
  });

  // Redeem a guest token (magic link landing)
  app.get(
    '/redeem',
    async (request: FastifyRequest<{ Querystring: { token: string } }>, reply: FastifyReply) => {
      const { token } = request.query;

      if (!token) {
        return reply.status(400).send({ error: 'Token required' });
      }

      const tokenHash = hashToken(token);

      // Find invite
      const invite = await prisma.invite.findUnique({
        where: { tokenHash },
      });

      if (!invite) {
        return reply.status(404).send({ error: 'Invalid or expired invite' });
      }

      // Check expiry
      if (invite.expiresAt < new Date()) {
        return reply.status(410).send({ error: 'Invite has expired' });
      }

      // Check max uses
      if (invite.maxUses && invite.useCount >= invite.maxUses) {
        return reply.status(410).send({ error: 'Invite has reached maximum uses' });
      }

      // Increment use count
      await prisma.invite.update({
        where: { id: invite.id },
        data: { useCount: { increment: 1 } },
      });

      // Create guest session
      const guestUser: SessionUser = {
        id: `guest-${invite.id}`,
        externalId: `guest-${invite.id}`,
        email: '',
        displayName: 'Guest',
        isGuest: true,
        guestExpiry: invite.expiresAt,
        permissions: invite.allowedActions,
      };

      const session = request.session as any;
      session.user = guestUser;
      session.guestToken = token;
      await request.session.save();

      // Store guest permission in database for auditing
      await prisma.userPermission.upsert({
        where: { 
          id: `guest-perm-${invite.id}` 
        },
        create: {
          id: `guest-perm-${invite.id}`,
          userId: guestUser.id,
          scopeType: invite.scopeType,
          scopeId: invite.scopeId,
          actions: invite.allowedActions,
          expiresAt: invite.expiresAt,
          inviteId: invite.id,
        },
        update: {
          actions: invite.allowedActions,
          expiresAt: invite.expiresAt,
        },
      }).catch(() => {
        // If guest user doesn't exist, that's OK - we're using session-based auth
      });

      logger.info(
        { inviteId: invite.id, scopeType: invite.scopeType, scopeId: invite.scopeId },
        'Guest token redeemed'
      );

      // Return guest session info
      return reply.send({
        success: true,
        guest: {
          scopeType: invite.scopeType,
          scopeId: invite.scopeId,
          allowedActions: invite.allowedActions,
          expiresAt: invite.expiresAt.toISOString(),
        },
      });
    }
  );

  // Get guest scope info (for frontend to know what the guest can access)
  app.get('/scope', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = getCurrentUser(request);
    const session = request.session as any;
    
    if (!user?.isGuest || !session.guestToken) {
      return reply.status(403).send({ error: 'Not a guest session' });
    }

    const tokenHash = hashToken(session.guestToken);
    const invite = await prisma.invite.findUnique({
      where: { tokenHash },
    });

    if (!invite) {
      return reply.status(404).send({ error: 'Guest session invalid' });
    }

    // Get the scope details
    let scopeDetails: { name: string; gates?: { id: string; name: string }[] } | null = null;
    
    switch (invite.scopeType) {
      case 'LOCATION': {
        const location = await prisma.location.findUnique({
          where: { id: invite.scopeId },
          include: {
            areas: {
              include: { gates: true },
            },
          },
        });
        if (location) {
          scopeDetails = {
            name: location.name,
            gates: location.areas.flatMap((a) => a.gates.map((g) => ({ id: g.id, name: g.name }))),
          };
        }
        break;
      }
      case 'AREA': {
        const area = await prisma.area.findUnique({
          where: { id: invite.scopeId },
          include: { gates: true },
        });
        if (area) {
          scopeDetails = {
            name: area.name,
            gates: area.gates.map((g) => ({ id: g.id, name: g.name })),
          };
        }
        break;
      }
      case 'GATE': {
        const gate = await prisma.gate.findUnique({
          where: { id: invite.scopeId },
        });
        if (gate) {
          scopeDetails = {
            name: gate.name,
            gates: [{ id: gate.id, name: gate.name }],
          };
        }
        break;
      }
    }

    return reply.send({
      scopeType: invite.scopeType,
      scopeId: invite.scopeId,
      scopeDetails,
      allowedActions: invite.allowedActions,
      expiresAt: invite.expiresAt.toISOString(),
    });
  });
}
