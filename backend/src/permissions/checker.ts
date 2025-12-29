import { prisma } from '../lib/prisma.js';
import type { Device } from '@prisma/client';
import type { DeviceAction } from '../config/schema.js';
import { ScopeType } from '@prisma/client';

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a user has permission to perform an action on a device.
 * Permissions are hierarchical: Location > Area > Device
 * Admins bypass all permission checks.
 */
export async function checkPermission(
  userId: string | null | undefined,
  device: Device & { area: { locationId: string } },
  action: DeviceAction,
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
        // Device-specific permission
        { scopeType: ScopeType.DEVICE, scopeId: device.id },
        // Area permission
        { scopeType: ScopeType.AREA, scopeId: device.areaId },
        // Location permission
        { scopeType: ScopeType.LOCATION, scopeId: device.area.locationId },
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
 * Get all device IDs that a user has any permission for.
 * Resolves hierarchical permissions: LOCATION -> all devices in location, AREA -> all devices in area.
 * Admins get access to all devices.
 * Returns empty set if user has no permissions.
 * 
 * For guests, use getAccessibleDeviceIdsForGuest instead.
 */
export async function getAccessibleDeviceIds(
  userId: string | null | undefined,
  isAdmin?: boolean
): Promise<Set<string>> {
  // Admins have access to all devices
  if (isAdmin) {
    const allDevices = await prisma.device.findMany({ select: { id: true } });
    return new Set(allDevices.map((d) => d.id));
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

  const accessibleDeviceIds = new Set<string>();

  // Collect scope IDs by type for batch queries
  const locationIds: string[] = [];
  const areaIds: string[] = [];

  for (const perm of permissions) {
    // Only grant visibility if user has at least one action (not just empty array)
    if (perm.actions.length === 0) {
      continue;
    }

    switch (perm.scopeType) {
      case ScopeType.DEVICE:
        accessibleDeviceIds.add(perm.scopeId);
        break;
      case ScopeType.AREA:
        areaIds.push(perm.scopeId);
        break;
      case ScopeType.LOCATION:
        locationIds.push(perm.scopeId);
        break;
    }
  }

  // Resolve AREA permissions to device IDs
  if (areaIds.length > 0) {
    const areaDevices = await prisma.device.findMany({
      where: { areaId: { in: areaIds } },
      select: { id: true },
    });
    areaDevices.forEach((d) => accessibleDeviceIds.add(d.id));
  }

  // Resolve LOCATION permissions to device IDs (via areas)
  if (locationIds.length > 0) {
    const locationDevices = await prisma.device.findMany({
      where: { area: { locationId: { in: locationIds } } },
      select: { id: true },
    });
    locationDevices.forEach((d) => accessibleDeviceIds.add(d.id));
  }

  return accessibleDeviceIds;
}

// Legacy alias
export const getAccessibleGateIds = getAccessibleDeviceIds;

/**
 * Get accessible device IDs for a guest user based on their session scope.
 * This is used instead of getAccessibleDeviceIds for guest sessions.
 */
export async function getAccessibleDeviceIdsForGuest(
  scopeType: 'LOCATION' | 'AREA' | 'DEVICE',
  scopeId: string
): Promise<Set<string>> {
  const accessibleDeviceIds = new Set<string>();

  switch (scopeType) {
    case 'DEVICE':
      accessibleDeviceIds.add(scopeId);
      break;
    case 'AREA': {
      const areaDevices = await prisma.device.findMany({
        where: { areaId: scopeId },
        select: { id: true },
      });
      areaDevices.forEach((d) => accessibleDeviceIds.add(d.id));
      break;
    }
    case 'LOCATION': {
      const locationDevices = await prisma.device.findMany({
        where: { area: { locationId: scopeId } },
        select: { id: true },
      });
      locationDevices.forEach((d) => accessibleDeviceIds.add(d.id));
      break;
    }
  }

  return accessibleDeviceIds;
}

// Legacy alias
export const getAccessibleGateIdsForGuest = getAccessibleDeviceIdsForGuest;
