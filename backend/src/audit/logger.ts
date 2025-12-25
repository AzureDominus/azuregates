import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import type { Prisma } from '@prisma/client';

export interface AuditLogEntry {
  userId?: string;
  gateId?: string;
  action: string;
  result: 'success' | 'failure' | 'denied';
  errorMessage?: string;
  clientIp?: string;
  userAgent?: string;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
  // For guest users - stored in metadata since guests don't have User records
  isGuest?: boolean;
  guestInviteId?: string;
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    // For guests, store the guest info in metadata and set userId to null
    // This avoids foreign key constraint issues since guests don't have User records
    const isGuestUser = entry.isGuest || entry.userId?.startsWith('guest-');
    const guestInviteId = entry.guestInviteId || (isGuestUser && entry.userId ? entry.userId.replace('guest-', '') : undefined);
    
    const metadata: Record<string, unknown> = {
      ...(entry.metadata ?? {}),
    };
    
    // Add guest info to metadata if this is a guest action
    if (isGuestUser) {
      metadata.isGuest = true;
      metadata.guestInviteId = guestInviteId;
      metadata.guestUserId = entry.userId; // Preserve the original guest-{id} for display
    }

    await prisma.auditLog.create({
      data: {
        // Set userId to null for guests to avoid FK constraint violation
        userId: isGuestUser ? null : entry.userId,
        gateId: entry.gateId,
        action: entry.action,
        result: entry.result,
        errorMessage: entry.errorMessage,
        clientIp: entry.clientIp,
        userAgent: entry.userAgent,
        latencyMs: entry.latencyMs,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    logger.debug(
      {
        userId: entry.userId,
        gateId: entry.gateId,
        action: entry.action,
        result: entry.result,
        isGuest: isGuestUser,
      },
      'Audit log entry created'
    );
  } catch (err) {
    // Don't fail the request if audit logging fails
    logger.error({ err, entry }, 'Failed to create audit log entry');
  }
}
