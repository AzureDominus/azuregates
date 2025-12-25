import type { Gate } from '@prisma/client';
import { z } from 'zod';
import { BaseDriver, type DriverResult } from './base.js';
import type { GateAction, GpioDriverConfig } from '../config/schema.js';
import { logger } from '../lib/logger.js';
import { getConfig } from '../config/loader.js';

const gpioConfigSchema = z.object({
  openPin: z.number().int().min(0).max(40).optional(),
  closePin: z.number().int().min(0).max(40).optional(),
  stopPin: z.number().int().min(0).max(40).optional(),
  togglePin: z.number().int().min(0).max(40).optional(),
  pulseDurationMs: z.number().min(50).max(5000).default(500),
  holdDurationMs: z.number().min(1000).max(120000).optional(),
  activeHigh: z.boolean().default(false),
});

// GPIO service URL - Python service running on host
const GPIO_SERVICE_URL = process.env.GPIO_SERVICE_URL || 'http://host.docker.internal:5000';

// In development mode (no GPIO service), we simulate the GPIO operations
const isSimulated = process.env.NODE_ENV === 'development';

// Check if GPIO service is reachable
let gpioServiceAvailable: boolean | null = null;

async function checkGpioServiceAvailable(): Promise<boolean> {
  if (gpioServiceAvailable !== null) return gpioServiceAvailable;
  try {
    const response = await fetch(`${GPIO_SERVICE_URL}/health`, { 
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    gpioServiceAvailable = response.ok;
    logger.info({ url: GPIO_SERVICE_URL }, 'GPIO: HTTP service available');
  } catch (err) {
    gpioServiceAvailable = false;
    logger.warn({ url: GPIO_SERVICE_URL, err }, 'GPIO: HTTP service not reachable');
  }
  return gpioServiceAvailable;
}

// Track active operations per gate to prevent simultaneous open/close
// This is CRITICAL for safety - we must NEVER activate open and close simultaneously
interface ActiveOperation {
  action: GateAction;
  pin: number;
  startTime: number;
  abortController: AbortController;
  config: GpioDriverConfig;
}
const activeGateOperations: Map<string, ActiveOperation> = new Map();

// Mutex locks per gate to ensure serialized access
const gateMutexes: Map<string, Promise<void>> = new Map();

/**
 * Call the GPIO service to pulse a pin.
 * The Python service handles the actual GPIO control via RPi.GPIO.
 * 
 * @param pin - GPIO pin number (BCM numbering)
 * @param durationMs - Duration to hold the active state in milliseconds
 * @param activeHigh - Whether the active state is HIGH (true) or LOW (false)
 */
async function callGpioServicePulse(pin: number, durationMs: number, activeHigh: boolean): Promise<void> {
  const response = await fetch(`${GPIO_SERVICE_URL}/pulse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pin,
      duration_ms: durationMs,
      active_low: !activeHigh,  // Invert for active_low parameter
    }),
  });
  
  const result = await response.json() as { success: boolean; error?: string };
  
  if (!response.ok || !result.success) {
    throw new Error(result.error || `GPIO service returned ${response.status}`);
  }
  
  logger.debug({ pin, durationMs, activeHigh, result }, 'GPIO pulse via HTTP service');
}

/**
 * Force a GPIO pin to inactive state (used for stop/abort operations).
 */
async function forceGpioInactive(pin: number, activeHigh: boolean): Promise<void> {
  try {
    const response = await fetch(`${GPIO_SERVICE_URL}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    
    const result = await response.json();
    logger.debug({ pin, result }, 'Forced GPIO to inactive via HTTP service');
  } catch (err) {
    logger.warn({ err, pin }, 'Failed to force GPIO inactive');
  }
}

export class GpioDriver extends BaseDriver {
  readonly name = 'gpio';
  readonly supportedActions: GateAction[] = ['open', 'close', 'stop', 'toggle'];

  async execute(gate: Gate, action: GateAction): Promise<DriverResult> {
    const config = gate.driverConfig as unknown as GpioDriverConfig;

    // STOP action is special - it interrupts active operations
    if (action === 'stop') {
      return this.executeStop(gate, config);
    }

    const pin = this.getPinForAction(config, action);

    if (pin === null) {
      return {
        success: false,
        message: `No pin configured for action: ${action}`,
      };
    }

    // SAFETY CHECK: Prevent simultaneous open/close on the same gate
    // This is CRITICAL - activating both simultaneously causes electrical problems
    if (action === 'open' || action === 'close') {
      const conflictingAction = action === 'open' ? 'close' : 'open';
      const activeOp = activeGateOperations.get(gate.id);
      
      if (activeOp && (activeOp.action === 'open' || activeOp.action === 'close')) {
        const errorMsg = `SAFETY BLOCK: Cannot execute ${action} while ${activeOp.action} is active on gate ${gate.id}. ` +
          `Active operation started ${Date.now() - activeOp.startTime}ms ago on pin ${activeOp.pin}. ` +
          `This prevents electrical damage from simultaneous open/close signals.`;
        logger.error({ gateId: gate.id, action, activeOp }, errorMsg);
        return {
          success: false,
          message: `Cannot ${action} while gate is ${activeOp.action === 'open' ? 'opening' : 'closing'}. Wait for the operation to complete.`,
        };
      }
    }

    // Use mutex to serialize operations on the same gate
    return this.withGateMutex(gate.id, async () => {
      // Check if maintenance mode is enabled - force simulation
      const gatesConfig = getConfig();
      const isMaintenanceMode = gatesConfig?.settings?.maintenanceMode ?? false;
      
      if (isSimulated || isMaintenanceMode) {
        if (isMaintenanceMode) {
          logger.info({ gateId: gate.id, action }, 'Maintenance mode enabled - simulating GPIO');
        }
        return this.simulateGpio(gate, action, pin, config);
      }
      return this.executeRealGpio(gate, action, pin, config);
    });
  }

  /**
   * Execute stop action - interrupts any active operation and optionally pulses stop pin.
   * 1. If an operation is active, abort it and release the active pin (set to inactive)
   * 2. If stopPin is configured, pulse it
   * 3. If no stopPin and no active operation, return error
   */
  private async executeStop(gate: Gate, config: GpioDriverConfig): Promise<DriverResult> {
    const activeOp = activeGateOperations.get(gate.id);
    const stopPin = config.stopPin;
    let stoppedActiveOp = false;
    let pulsedStopPin = false;

    logger.info(
      { gateId: gate.id, hasActiveOp: !!activeOp, hasStopPin: !!stopPin },
      'Executing stop command'
    );

    // Step 1: If there's an active operation, abort it and release the pin
    if (activeOp) {
      logger.info(
        { gateId: gate.id, activeAction: activeOp.action, activePin: activeOp.pin },
        'Aborting active operation and releasing pin'
      );

      // Signal the abort to interrupt the hold timer
      activeOp.abortController.abort();

      // Force the active pin to inactive state via GPIO service
      const gatesConfig = getConfig();
      const isMaintenanceMode = gatesConfig?.settings?.maintenanceMode ?? false;
      const shouldSimulate = isSimulated || isMaintenanceMode;
      
      if (!shouldSimulate && await checkGpioServiceAvailable()) {
        try {
          await forceGpioInactive(activeOp.pin, activeOp.config.activeHigh);
          logger.info(
            { gateId: gate.id, pin: activeOp.pin },
            'Released active pin to inactive state'
          );
        } catch (err) {
          logger.warn({ gateId: gate.id, pin: activeOp.pin, err }, 'Failed to release active pin');
        }
      }

      // Clear the active operation
      activeGateOperations.delete(gate.id);
      stoppedActiveOp = true;
    }

    // Step 2: If stopPin is configured, pulse it
    if (stopPin !== undefined) {
      // Check if maintenance mode is enabled - force simulation
      const gatesConfig = getConfig();
      const isMaintenanceMode = gatesConfig?.settings?.maintenanceMode ?? false;
      const shouldSimulate = isSimulated || isMaintenanceMode;
      
      logger.info(
        { gateId: gate.id, stopPin, pulseDurationMs: config.pulseDurationMs, simulated: shouldSimulate },
        'Pulsing stop pin'
      );

      try {
        if (shouldSimulate) {
          // Simulate the stop pin pulse
          await new Promise((resolve) => setTimeout(resolve, config.pulseDurationMs));
          logger.info({ gateId: gate.id, stopPin, simulated: true, maintenanceMode: isMaintenanceMode }, 'Simulated stop pin pulse');
        } else if (await checkGpioServiceAvailable()) {
          // Use GPIO service to pulse the stop pin
          await callGpioServicePulse(stopPin, config.pulseDurationMs, config.activeHigh);
          logger.info({ gateId: gate.id, stopPin, durationMs: config.pulseDurationMs }, 'Pulsed stop pin via GPIO service');
        } else {
          // Simulate if GPIO service not available
          await new Promise((resolve) => setTimeout(resolve, config.pulseDurationMs));
          logger.info({ gateId: gate.id, stopPin, simulated: true, reason: 'GPIO service not available' }, 'Simulated stop pin pulse');
        }
        pulsedStopPin = true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ gateId: gate.id, stopPin, err }, 'Failed to pulse stop pin');
        return {
          success: false,
          message: `Failed to pulse stop pin: ${errorMessage}`,
        };
      }
    }

    // If nothing was done, report it
    if (!stoppedActiveOp && !pulsedStopPin) {
      return {
        success: false,
        message: 'No active operation to stop and no stop pin configured',
      };
    }

    // Build result message
    const messages: string[] = [];
    if (stoppedActiveOp) {
      messages.push(`Stopped active ${activeOp!.action} operation on pin ${activeOp!.pin}`);
    }
    if (pulsedStopPin) {
      messages.push(`Pulsed stop pin ${stopPin} for ${config.pulseDurationMs}ms`);
    }

    return {
      success: true,
      message: messages.join('; '),
      data: { stoppedActiveOp, pulsedStopPin, stopPin },
    };
  }

  /**
   * Serialize access to a gate using a mutex pattern.
   * This ensures operations complete before another starts.
   */
  private async withGateMutex<T>(gateId: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any existing operation on this gate
    const existingMutex = gateMutexes.get(gateId);
    if (existingMutex) {
      await existingMutex.catch(() => {}); // Ignore errors from previous operation
    }

    // Create new mutex for this operation
    let resolve: () => void;
    const mutex = new Promise<void>((r) => { resolve = r; });
    gateMutexes.set(gateId, mutex);

    try {
      return await fn();
    } finally {
      resolve!();
      if (gateMutexes.get(gateId) === mutex) {
        gateMutexes.delete(gateId);
      }
    }
  }

  private getPinForAction(config: GpioDriverConfig, action: GateAction): number | null {
    switch (action) {
      case 'open':
        return config.openPin ?? null;
      case 'close':
        return config.closePin ?? null;
      case 'stop':
        return config.stopPin ?? null;
      case 'toggle':
        return config.togglePin ?? null;
      default:
        return null;
    }
  }

  /**
   * Get the duration to hold the pin active.
   * For open/close operations, use holdDurationMs if configured.
   * For toggle/stop operations, use pulseDurationMs.
   */
  private getActiveDuration(config: GpioDriverConfig, action: GateAction): number {
    if ((action === 'open' || action === 'close') && config.holdDurationMs) {
      return config.holdDurationMs;
    }
    return config.pulseDurationMs;
  }

  private async simulateGpio(
    gate: Gate,
    action: GateAction,
    pin: number,
    config: GpioDriverConfig
  ): Promise<DriverResult> {
    const duration = this.getActiveDuration(config, action);
    const abortController = new AbortController();
    
    logger.info(
      {
        gateId: gate.id,
        action,
        pin,
        durationMs: duration,
        pulseDurationMs: config.pulseDurationMs,
        holdDurationMs: config.holdDurationMs,
        activeHigh: config.activeHigh,
        simulated: true,
      },
      'Simulating GPIO operation'
    );

    // Track active operation for safety checks (with abort controller for stop)
    if (action === 'open' || action === 'close') {
      activeGateOperations.set(gate.id, {
        action,
        pin,
        startTime: Date.now(),
        abortController,
        config,
      });
    }

    try {
      // Simulate the operation duration (interruptible via abort)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, duration);
        abortController.signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('Operation aborted by stop command'));
        });
      });

      return {
        success: true,
        message: `Simulated GPIO on pin ${pin} for ${duration}ms (${action})`,
        data: { simulated: true, pin, action, durationMs: duration },
      };
    } catch (err) {
      if (abortController.signal.aborted) {
        logger.info({ gateId: gate.id, action }, 'GPIO operation was stopped');
        return {
          success: true,
          message: `Operation ${action} was stopped`,
          data: { simulated: true, pin, action, stopped: true },
        };
      }
      throw err;
    } finally {
      // Clear active operation tracking
      if (action === 'open' || action === 'close') {
        activeGateOperations.delete(gate.id);
      }
    }
  }

  private async executeRealGpio(
    gate: Gate,
    action: GateAction,
    pin: number,
    config: GpioDriverConfig
  ): Promise<DriverResult> {
    const duration = this.getActiveDuration(config, action);
    const abortController = new AbortController();
    
    try {
      // Check if GPIO service is available
      const gpioServiceReachable = await checkGpioServiceAvailable();
      
      if (!gpioServiceReachable) {
        // Fall back to simulation if GPIO service not available
        logger.warn({ gateId: gate.id }, 'GPIO service not available, falling back to simulation');
        return this.simulateGpio(gate, action, pin, config);
      }

      logger.info(
        { 
          gateId: gate.id, 
          action, 
          pin, 
          durationMs: duration,
          pulseDurationMs: config.pulseDurationMs,
          holdDurationMs: config.holdDurationMs, 
          activeHigh: config.activeHigh 
        },
        'Executing GPIO operation via HTTP service'
      );

      // Track active operation for safety checks (CRITICAL for open/close mutual exclusion)
      if (action === 'open' || action === 'close') {
        activeGateOperations.set(gate.id, {
          action,
          pin,
          startTime: Date.now(),
          abortController,
          config,
        });
      }

      try {
        // Call the GPIO service - it handles the pulse timing
        await callGpioServicePulse(pin, duration, config.activeHigh);
        
        logger.info(
          { gateId: gate.id, action, pin, durationMs: duration },
          'GPIO operation completed'
        );

        return {
          success: true,
          message: `GPIO operation on pin ${pin} for ${duration}ms (${action})`,
          data: { pin, action, durationMs: duration },
        };
      } catch (err) {
        if (abortController.signal.aborted) {
          logger.info({ gateId: gate.id, action }, 'GPIO operation was stopped');
          return {
            success: true,
            message: `Operation ${action} was stopped`,
            data: { pin, action, stopped: true },
          };
        }
        throw err;
      } finally {
        // Clear active operation tracking
        if (action === 'open' || action === 'close') {
          activeGateOperations.delete(gate.id);
        }
      }
    } catch (err) {
      // Clear active operation on error
      if (action === 'open' || action === 'close') {
        activeGateOperations.delete(gate.id);
      }
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ gateId: gate.id, action, pin, err }, 'GPIO execution failed');
      return {
        success: false,
        message: `GPIO execution failed: ${errorMessage}`,
      };
    }
  }

  validateConfig(config: unknown): { valid: boolean; errors?: string[] } {
    const result = gpioConfigSchema.safeParse(config);

    if (!result.success) {
      return {
        valid: false,
        errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      };
    }

    // Must have at least one pin configured
    const parsed = result.data;
    if (!parsed.openPin && !parsed.closePin && !parsed.stopPin && !parsed.togglePin) {
      return {
        valid: false,
        errors: ['At least one action pin must be configured'],
      };
    }

    return { valid: true };
  }
}

export const gpioDriver = new GpioDriver();
