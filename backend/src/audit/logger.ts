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
}

export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        gateId: entry.gateId,
        action: entry.action,
        result: entry.result,
        errorMessage: entry.errorMessage,
        clientIp: entry.clientIp,
        userAgent: entry.userAgent,
        latencyMs: entry.latencyMs,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    logger.debug(
      {
        userId: entry.userId,
        gateId: entry.gateId,
        action: entry.action,
        result: entry.result,
      },
      'Audit log entry created'
    );
  } catch (err) {
    // Don't fail the request if audit logging fails
    logger.error({ err, entry }, 'Failed to create audit log entry');
  }
}
