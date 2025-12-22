import type { Gate } from '@prisma/client';
import type { GateAction } from '../config/schema.js';
import type { DriverResult, GateDriver } from './base.js';
import { webhookDriver } from './webhook.js';
import { gpioDriver } from './gpio.js';
import { logger } from '../lib/logger.js';
import { getConfig } from '../config/loader.js';

// Driver registry
const drivers: Record<string, GateDriver> = {
  webhook: webhookDriver,
  gpio: gpioDriver,
};

// Cooldown tracking (in-memory for now)
const cooldowns: Map<string, number> = new Map();
const executionLocks: Set<string> = new Set();

export function getDriver(driverType: string): GateDriver | null {
  return drivers[driverType] ?? null;
}

export function registerDriver(name: string, driver: GateDriver): void {
  drivers[name] = driver;
}

export async function executeGateCommand(gate: Gate, action: GateAction): Promise<DriverResult> {
  const gateId = gate.id;

  // Check for execution lock (mutual exclusion)
  if (executionLocks.has(gateId)) {
    logger.warn({ gateId, action }, 'Gate command rejected: another command is in progress');
    return {
      success: false,
      message: 'Another command is already in progress for this gate',
    };
  }

  // Check cooldown
  const config = getConfig();
  const defaultCooldownMs = config?.settings.defaultCooldownMs ?? 2000;
  const lastExecution = cooldowns.get(gateId);
  const now = Date.now();

  if (lastExecution && now - lastExecution < defaultCooldownMs) {
    const remainingMs = defaultCooldownMs - (now - lastExecution);
    logger.warn({ gateId, action, remainingMs }, 'Gate command rejected: cooldown active');
    return {
      success: false,
      message: `Cooldown active. Please wait ${Math.ceil(remainingMs / 1000)} seconds`,
    };
  }

  // Get driver
  const driver = getDriver(gate.driverType);
  if (!driver) {
    logger.error({ gateId, driverType: gate.driverType }, 'Unknown driver type');
    return {
      success: false,
      message: `Unknown driver type: ${gate.driverType}`,
    };
  }

  // Check if driver supports action
  if (!driver.supportsAction(action)) {
    logger.warn({ gateId, action, driverType: gate.driverType }, 'Driver does not support action');
    return {
      success: false,
      message: `Driver ${driver.name} does not support action: ${action}`,
    };
  }

  // Acquire lock
  executionLocks.add(gateId);

  try {
    // Execute command
    const result = await driver.execute(gate, action);

    // Update cooldown on success
    if (result.success) {
      cooldowns.set(gateId, Date.now());
    }

    return result;
  } finally {
    // Release lock
    executionLocks.delete(gateId);
  }
}
