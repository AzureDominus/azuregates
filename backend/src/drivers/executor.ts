import type { Device } from '@prisma/client';
import type { DeviceAction } from '../config/schema.js';
import type { DriverResult, DeviceDriver } from './base.js';
import { webhookDriver } from './webhook.js';
import { gpioDriver, getActiveDeviceOperations } from './gpio.js';
import { logger } from '../lib/logger.js';
import { getConfig } from '../config/loader.js';

// Re-export for use in devices API
export { getActiveDeviceOperations };
// Legacy alias
export const getActiveGateOperations = getActiveDeviceOperations;

// Device status type
export interface DeviceStatus {
  deviceId: string;
  action: DeviceAction;
  startTime: number;
  estimatedEndTime: number;
  remainingMs: number;
}

// Legacy alias
export type GateStatus = DeviceStatus;

/**
 * Get status of all devices with active operations.
 */
export function getDeviceStatus(): DeviceStatus[] {
  const activeOps = getActiveDeviceOperations();
  const now = Date.now();
  const result: DeviceStatus[] = [];
  
  for (const [deviceId, op] of activeOps) {
    result.push({
      deviceId,
      action: op.action,
      startTime: op.startTime,
      estimatedEndTime: op.estimatedEndTime,
      remainingMs: Math.max(0, op.estimatedEndTime - now),
    });
  }
  
  return result;
}

// Legacy alias
export const getGateStatus = getDeviceStatus;

// Driver registry
const drivers: Record<string, DeviceDriver> = {
  webhook: webhookDriver,
  gpio: gpioDriver,
};

// Cooldown tracking (in-memory for now)
const cooldowns: Map<string, number> = new Map();
const executionLocks: Set<string> = new Set();

export function getDriver(driverType: string): DeviceDriver | null {
  return drivers[driverType] ?? null;
}

export function registerDriver(name: string, driver: DeviceDriver): void {
  drivers[name] = driver;
}

export async function executeDeviceCommand(device: Device, action: DeviceAction): Promise<DriverResult> {
  const deviceId = device.id;

  // Check for execution lock (mutual exclusion)
  // EXCEPTION: 'stop' action bypasses the lock - it's meant to interrupt active operations
  if (executionLocks.has(deviceId) && action !== 'stop') {
    logger.warn({ deviceId, action }, 'Device command rejected: another command is in progress');
    return {
      success: false,
      message: 'Another command is already in progress for this device',
    };
  }

  // Check cooldown
  const config = getConfig();
  const defaultCooldownMs = config?.settings.defaultCooldownMs ?? 2000;
  const lastExecution = cooldowns.get(deviceId);
  const now = Date.now();

  if (lastExecution && now - lastExecution < defaultCooldownMs) {
    const remainingMs = defaultCooldownMs - (now - lastExecution);
    logger.warn({ deviceId, action, remainingMs }, 'Device command rejected: cooldown active');
    return {
      success: false,
      message: `Cooldown active. Please wait ${Math.ceil(remainingMs / 1000)} seconds`,
    };
  }

  // Get driver
  const driver = getDriver(device.driverType);
  if (!driver) {
    logger.error({ deviceId, driverType: device.driverType }, 'Unknown driver type');
    return {
      success: false,
      message: `Unknown driver type: ${device.driverType}`,
    };
  }

  // Check if driver supports action
  if (!driver.supportsAction(action)) {
    logger.warn({ deviceId, action, driverType: device.driverType }, 'Driver does not support action');
    return {
      success: false,
      message: `Driver ${driver.name} does not support action: ${action}`,
    };
  }

  // Acquire lock
  executionLocks.add(deviceId);

  try {
    // Execute command
    const result = await driver.execute(device, action);

    // Update cooldown on success
    if (result.success) {
      cooldowns.set(deviceId, Date.now());
    }

    return result;
  } finally {
    // Release lock
    executionLocks.delete(deviceId);
  }
}

// Legacy alias
export const executeGateCommand = executeDeviceCommand;
