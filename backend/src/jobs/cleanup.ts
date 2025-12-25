/**
 * Cleanup job for removing stale pending accounts.
 * 
 * This job deletes user accounts that:
 * - Have isActivated = false (not approved)
 * - Have activatedAt = null (never been approved before - prevents deleting deactivated accounts)
 * - Were created more than 3 days ago
 * 
 * Runs periodically via setInterval, started from main.ts
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

// 3 days in milliseconds
const STALE_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// Run cleanup every hour
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Delete accounts that were never approved and are older than 3 days.
 * This prevents accumulation of abandoned accounts from users who signed up
 * but were never approved by an admin.
 * 
 * Important: Only deletes accounts where activatedAt IS NULL.
 * Accounts that were once activated then deactivated (activatedAt set) are preserved.
 */
export async function cleanupStaleAccounts(): Promise<{ deleted: number }> {
  const cutoffDate = new Date(Date.now() - STALE_ACCOUNT_AGE_MS);

  try {
    // Find stale accounts first for logging
    const staleAccounts = await prisma.user.findMany({
      where: {
        isActivated: false,
        activatedAt: null, // Never been approved
        createdAt: { lt: cutoffDate },
        isAdmin: false, // Never delete admins
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        createdAt: true,
      },
    });

    if (staleAccounts.length === 0) {
      logger.debug('No stale accounts to cleanup');
      return { deleted: 0 };
    }

    // Log accounts being deleted
    logger.info(
      { 
        count: staleAccounts.length, 
        accounts: staleAccounts.map(a => ({ id: a.id, email: a.email })),
        cutoffDate: cutoffDate.toISOString(),
      },
      'Deleting stale pending accounts'
    );

    // TODO: Future enhancement - Send email notification before deletion
    // for (const account of staleAccounts) {
    //   await sendAccountDeletionWarningEmail(account.email, account.displayName);
    // }

    // Delete the accounts
    const result = await prisma.user.deleteMany({
      where: {
        isActivated: false,
        activatedAt: null,
        createdAt: { lt: cutoffDate },
        isAdmin: false,
      },
    });

    logger.info({ deleted: result.count }, 'Stale accounts cleanup completed');

    return { deleted: result.count };
  } catch (err) {
    logger.error({ err }, 'Failed to cleanup stale accounts');
    throw err;
  }
}

let cleanupIntervalId: NodeJS.Timeout | null = null;

/**
 * Start the periodic cleanup job.
 * Safe to call multiple times - will only start one interval.
 */
export function startCleanupJob(): void {
  if (cleanupIntervalId) {
    logger.warn('Cleanup job already running');
    return;
  }

  logger.info(
    { intervalMs: CLEANUP_INTERVAL_MS, staleAgeDays: STALE_ACCOUNT_AGE_MS / (24 * 60 * 60 * 1000) },
    'Starting stale account cleanup job'
  );

  // Run immediately on startup
  cleanupStaleAccounts().catch((err) => {
    logger.error({ err }, 'Initial cleanup job failed');
  });

  // Then run periodically
  cleanupIntervalId = setInterval(() => {
    cleanupStaleAccounts().catch((err) => {
      logger.error({ err }, 'Periodic cleanup job failed');
    });
  }, CLEANUP_INTERVAL_MS);
}

/**
 * Stop the periodic cleanup job.
 */
export function stopCleanupJob(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
    logger.info('Stale account cleanup job stopped');
  }
}
