import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, createHash } from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { getCurrentUser, authPreHandler, adminPreHandler, type SessionUser } from './session.js';
import { config } from '../config/env.js';

const createInviteSchema = z.object({
  scopeType: z.enum(['LOCATION', 'AREA', 'GATE']),
  scopeId: z.string(),
  allowedActions: z.array(z.enum(['open', 'close', 'stop', 'toggle'])).min(1),
  expiresInHours: z.number().min(1).max(720).default(24), // 1 hour to 30 days
  maxUses: z.number().min(1).max(100).optional(),
  description: z.string().max(200).optional(),
});

/**
 * Generate a deterministic token for an invite using HMAC.
 * This allows us to recreate the same token without storing it.
 * The token is derived from the invite ID and a secret key (SESSION_SECRET).
 */
function generateTokenForInvite(inviteId: string): string {
  const secret = config.sessionSecret;
  return createHmac('sha256', secret).update(inviteId).digest('base64url');
}

/**
 * Hash a token for storage/lookup. We still hash tokens in the DB
 * so that even if the DB is compromised, tokens can't be directly used.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Validate that a guest invite is still valid.
 * Called on every guest action to ensure deleted/expired invites are immediately revoked.
 * 
 * @param guestToken - The raw token from the guest's session
 * @returns { valid: boolean, reason?: string }
 */
export async function validateGuestInvite(
  guestToken: string | undefined
): Promise<{ valid: boolean; reason?: string }> {
  if (!guestToken) {
    return { valid: false, reason: 'No guest token in session' };
  }

  const tokenHash = hashToken(guestToken);
  
  const invite = await prisma.invite.findUnique({
    where: { tokenHash },
  });

  if (!invite) {
    return { valid: false, reason: 'Invite has been deleted or is invalid' };
  }

  if (invite.expiresAt < new Date()) {
    return { valid: false, reason: 'Invite has expired' };
  }

  if (invite.maxUses && invite.useCount > invite.maxUses) {
    return { valid: false, reason: 'Invite has reached maximum uses' };
  }

  return { valid: true };
}

export async function guestRoutes(app: FastifyInstance) {
  // Create a new guest invite (magic link) - Admin only
  app.post<{ Body: z.infer<typeof createInviteSchema> }>(
    '/invites',
    { preHandler: adminPreHandler },
    async (request, reply) => {
      const user = getCurrentUser(request)!; // preHandler ensures user exists

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

      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

      // Create invite in database first (we need the ID for the deterministic token)
      const invite = await prisma.invite.create({
        data: {
          tokenHash: 'pending', // Will update after we have the ID
          createdById: user.id,
          scopeType,
          scopeId,
          allowedActions,
          expiresAt,
          maxUses,
        },
      });

      // Generate deterministic token based on invite ID
      const token = generateTokenForInvite(invite.id);
      const tokenHash = hashToken(token);

      // Update with the real token hash
      await prisma.invite.update({
        where: { id: invite.id },
        data: { tokenHash },
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

  // List all invites - Admin only (admins see all invites)
  // Now includes magic links since tokens are deterministic
  app.get('/invites', { preHandler: adminPreHandler }, async (request, reply) => {
    const invites = await prisma.invite.findMany({
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
        createdBy: {
          select: { displayName: true, email: true },
        },
      },
    });

    // Add magic links to each invite (we can regenerate them since tokens are deterministic)
    const invitesWithLinks = invites.map((invite) => {
      const token = generateTokenForInvite(invite.id);
      const magicLink = `${config.baseUrl}/guest?token=${token}`;
      return {
        ...invite,
        magicLink,
      };
    });

    return reply.send(invitesWithLinks);
  });

  // Delete/revoke an invite - Admin only
  app.delete<{ Params: { id: string } }>('/invites/:id', { preHandler: adminPreHandler }, async (request, reply) => {
    const user = getCurrentUser(request)!;

    const invite = await prisma.invite.findUnique({
      where: { id: request.params.id },
    });

    if (!invite) {
      return reply.status(404).send({ error: 'Invite not found' });
    }

    await prisma.invite.delete({ where: { id: invite.id } });

    logger.info({ inviteId: invite.id, deletedBy: user.id }, 'Guest invite deleted');

    return reply.send({ success: true });
  });

  // Redeem a guest token (magic link landing)
  app.get<{ Querystring: { token: string } }>(
    '/redeem',
    async (request, reply) => {
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
        // Store scope info in session for permission checks
        guestScopeType: invite.scopeType,
        guestScopeId: invite.scopeId,
      };

      const session = request.session as any;
      session.user = guestUser;
      session.guestToken = token;
      await request.session.save();

      // Note: We don't create a UserPermission record because guests don't have
      // a User record in the database. Permissions are checked via session data.

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
  app.get('/scope', async (request, reply) => {
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
