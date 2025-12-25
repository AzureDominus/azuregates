import { prisma } from '../lib/prisma.js';
import type { Gate } from '@prisma/client';
import type { GateAction } from '../config/schema.js';
import { ScopeType } from '@prisma/client';

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a user has permission to perform an action on a gate.
 * Permissions are hierarchical: Location > Area > Gate
 * Admins bypass all permission checks.
 */
export async function checkPermission(
  userId: string | null | undefined,
  gate: Gate & { area: { locationId: string } },
  action: GateAction,
  isAdmin?: boolean
): Promise<PermissionCheckResult> {
  // If no user is authenticated, deny access
  if (!userId) {
    return { allowed: false, reason: 'Not authenticated' };
  }

  // Admins bypass all permission checks
  if (isAdmin) {
    return { allowed: true, reason: 'Admin access' };
  }

  // Check for matching permissions (most specific to least specific)
  const permissions = await prisma.userPermission.findMany({
    where: {
      userId,
      OR: [
        // Gate-specific permission
        { scopeType: ScopeType.GATE, scopeId: gate.id },
        // Area permission
        { scopeType: ScopeType.AREA, scopeId: gate.areaId },
        // Location permission
        { scopeType: ScopeType.LOCATION, scopeId: gate.area.locationId },
      ],
    },
  });

  if (permissions.length === 0) {
    return { allowed: false, reason: 'No permissions found' };
  }

  // Check each permission
  for (const perm of permissions) {
    // Check expiry
    if (perm.expiresAt && perm.expiresAt < new Date()) {
      continue; // Skip expired permissions
    }

    // Check if action is allowed
    if (perm.actions.includes(action) || perm.actions.includes('*')) {
      return { allowed: true };
    }
  }

  return { allowed: false, reason: `Action '${action}' not permitted` };
}

/**
 * Get all permissions for a user
 */
export async function getUserPermissions(userId: string) {
  return prisma.userPermission.findMany({
    where: {
      userId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });
}

/**
 * Grant permissions to a user
 */
export async function grantPermission(params: {
  userId: string;
  scopeType: ScopeType;
  scopeId: string;
  actions: string[];
  expiresAt?: Date;
  grantedBy?: string;
  inviteId?: string;
}) {
  return prisma.userPermission.create({
    data: {
      userId: params.userId,
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      actions: params.actions,
      expiresAt: params.expiresAt,
      grantedBy: params.grantedBy,
      inviteId: params.inviteId,
    },
  });
}

/**
 * Revoke a permission
 */
export async function revokePermission(permissionId: string) {
  return prisma.userPermission.delete({
    where: { id: permissionId },
  });
}

/**
 * Get all gate IDs that a user has any permission for.
 * Resolves hierarchical permissions: LOCATION -> all gates in location, AREA -> all gates in area.
 * Admins get access to all gates.
 * Returns empty set if user has no permissions.
 */
export async function getAccessibleGateIds(
  userId: string | null | undefined,
  isAdmin?: boolean
): Promise<Set<string>> {
  // Admins have access to all gates
  if (isAdmin) {
    const allGates = await prisma.gate.findMany({ select: { id: true } });
    return new Set(allGates.map((g) => g.id));
  }

  // No user = no access
  if (!userId) {
    return new Set();
  }

  // Get all active (non-expired) permissions for user
  const permissions = await prisma.userPermission.findMany({
    where: {
      userId,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  if (permissions.length === 0) {
    return new Set();
  }

  const accessibleGateIds = new Set<string>();

  // Collect scope IDs by type for batch queries
  const locationIds: string[] = [];
  const areaIds: string[] = [];

  for (const perm of permissions) {
    // Only grant visibility if user has at least one action (not just empty array)
    if (perm.actions.length === 0) {
      continue;
    }

    switch (perm.scopeType) {
      case ScopeType.GATE:
        accessibleGateIds.add(perm.scopeId);
        break;
      case ScopeType.AREA:
        areaIds.push(perm.scopeId);
        break;
      case ScopeType.LOCATION:
        locationIds.push(perm.scopeId);
        break;
    }
  }

  // Resolve AREA permissions to gate IDs
  if (areaIds.length > 0) {
    const areaGates = await prisma.gate.findMany({
      where: { areaId: { in: areaIds } },
      select: { id: true },
    });
    areaGates.forEach((g) => accessibleGateIds.add(g.id));
  }

  // Resolve LOCATION permissions to gate IDs (via areas)
  if (locationIds.length > 0) {
    const locationGates = await prisma.gate.findMany({
      where: { area: { locationId: { in: locationIds } } },
      select: { id: true },
    });
    locationGates.forEach((g) => accessibleGateIds.add(g.id));
  }

  return accessibleGateIds;
}
