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

// Secret key for authenticating with the GPIO service
const GPIO_SERVICE_SECRET = process.env.GPIO_SERVICE_SECRET || '';

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

interface PulseResult {
  success: boolean;
  async?: boolean;
  error?: string;
  pin: number;
  duration_ms?: number;
}

/**
 * Call the GPIO service to pulse a pin.
 * The Python service handles the actual GPIO control via RPi.GPIO.
 * 
 * For long pulses (>1000ms), the GPIO service returns immediately with async: true
 * while continuing the pulse in the background. The backend must track the operation.
 * 
 * @param pin - GPIO pin number (BCM numbering)
 * @param durationMs - Duration to hold the active state in milliseconds
 * @param activeHigh - Whether the active state is HIGH (true) or LOW (false)
 * @returns PulseResult with async flag indicating if pulse is still running
 */
async function callGpioServicePulse(pin: number, durationMs: number, activeHigh: boolean): Promise<PulseResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (GPIO_SERVICE_SECRET) {
    headers['X-GPIO-Secret'] = GPIO_SERVICE_SECRET;
  }
  
  const response = await fetch(`${GPIO_SERVICE_URL}/pulse`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      pin,
      duration_ms: durationMs,
      active_low: !activeHigh,  // Invert for active_low parameter
    }),
  });
  
  const result = await response.json() as PulseResult;
  
  if (!response.ok || !result.success) {
    throw new Error(result.error || `GPIO service returned ${response.status}`);
  }
  
  logger.debug({ pin, durationMs, activeHigh, result }, 'GPIO pulse via HTTP service');
  return result;
}

/**
 * Force a GPIO pin to inactive state (used for stop/abort operations).
 */
async function forceGpioInactive(pin: number, activeHigh: boolean): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (GPIO_SERVICE_SECRET) {
      headers['X-GPIO-Secret'] = GPIO_SERVICE_SECRET;
    }
    
    const response = await fetch(`${GPIO_SERVICE_URL}/stop`, {
      method: 'POST',
      headers,
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
   * 1. Stop any active pulses on this gate's pins via the GPIO service
   * 2. If an operation is tracked locally, abort it
   * 3. If stopPin is configured, pulse it
   */
  private async executeStop(gate: Gate, config: GpioDriverConfig): Promise<DriverResult> {
    const activeOp = activeGateOperations.get(gate.id);
    const stopPin = config.stopPin;
    let stoppedGpioService = false;
    let stoppedLocalOp = false;
    let pulsedStopPin = false;

    // Get all pins for this gate that might need to be stopped
    const pinsToStop: number[] = [];
    if (config.openPin !== undefined) pinsToStop.push(config.openPin);
    if (config.closePin !== undefined) pinsToStop.push(config.closePin);
    if (config.togglePin !== undefined) pinsToStop.push(config.togglePin);

    logger.info(
      { gateId: gate.id, hasActiveOp: !!activeOp, hasStopPin: !!stopPin, pinsToStop },
      'Executing stop command'
    );

    // Step 1: Stop any active pulses on the GPIO service for this gate's pins
    const gatesConfig = getConfig();
    const isMaintenanceMode = gatesConfig?.settings?.maintenanceMode ?? false;
    const shouldSimulate = isSimulated || isMaintenanceMode;

    if (!shouldSimulate && await checkGpioServiceAvailable()) {
      for (const pin of pinsToStop) {
        try {
          await forceGpioInactive(pin, config.activeHigh);
          logger.info({ gateId: gate.id, pin }, 'Stopped GPIO pin via service');
          stoppedGpioService = true;
        } catch (err) {
          logger.warn({ gateId: gate.id, pin, err }, 'Failed to stop GPIO pin');
        }
      }
    }

    // Step 2: If there's a locally tracked operation, abort it
    if (activeOp) {
      logger.info(
        { gateId: gate.id, activeAction: activeOp.action, activePin: activeOp.pin },
        'Aborting locally tracked operation'
      );
      activeOp.abortController.abort();
      activeGateOperations.delete(gate.id);
      stoppedLocalOp = true;
    }

    // Step 3: If stopPin is configured, pulse it
    if (stopPin !== undefined) {
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

    // Even if no local operation was tracked, if we successfully stopped the GPIO service, that's a success
    if (!stoppedLocalOp && !stoppedGpioService && !pulsedStopPin) {
      return {
        success: false,
        message: 'No active operation to stop and no stop pin configured',
      };
    }

    // Build result message
    const messages: string[] = [];
    if (stoppedGpioService) {
      messages.push(`Stopped GPIO pulses on pins ${pinsToStop.join(', ')}`);
    }
    if (stoppedLocalOp) {
      messages.push(`Stopped tracked ${activeOp!.action} operation`);
    }
    if (pulsedStopPin) {
      messages.push(`Pulsed stop pin ${stopPin} for ${config.pulseDurationMs}ms`);
    }

    return {
      success: true,
      message: messages.join('; '),
      data: { stoppedGpioService, stoppedLocalOp, pulsedStopPin, stopPin },
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

      // For long operations, return immediately like async hardware
      // This allows the UI to show the progress bar
      if (duration > 1000) {
        // Set a timer to clear the operation tracking after the duration
        setTimeout(() => {
          const currentOp = activeGateOperations.get(gate.id);
          if (currentOp && currentOp.pin === pin && currentOp.action === action && !currentOp.abortController.signal.aborted) {
            activeGateOperations.delete(gate.id);
            logger.debug({ gateId: gate.id, action }, 'Cleared simulated GPIO operation tracking');
          }
        }, duration);

        return {
          success: true,
          message: `Simulated GPIO operation started on pin ${pin} for ${duration}ms (${action})`,
          data: { simulated: true, pin, action, durationMs: duration, async: true },
        };
      }
    }

    try {
      // For short operations, wait for completion
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
      // Clear active operation tracking for short operations
      if ((action === 'open' || action === 'close') && duration <= 1000) {
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
        const result = await callGpioServicePulse(pin, duration, config.activeHigh);
        
        // If the GPIO service returned async: true, it means the pulse is still running
        // Keep tracking the operation and set a cleanup timer
        if (result.async) {
          logger.info(
            { gateId: gate.id, action, pin, durationMs: duration },
            'GPIO operation running asynchronously'
          );
          
          // Set a timer to clear the active operation after the expected duration
          setTimeout(() => {
            const currentOp = activeGateOperations.get(gate.id);
            if (currentOp && currentOp.pin === pin && currentOp.action === action) {
              activeGateOperations.delete(gate.id);
              logger.debug({ gateId: gate.id, action }, 'Cleared async GPIO operation tracking');
            }
          }, duration + 500); // Add 500ms buffer
          
          return {
            success: true,
            message: `GPIO operation started on pin ${pin} for ${duration}ms (${action})`,
            data: { pin, action, durationMs: duration, async: true },
          };
        }
        
        logger.info(
          { gateId: gate.id, action, pin, durationMs: duration },
          'GPIO operation completed'
        );

        // Clear tracking for sync operations
        if (action === 'open' || action === 'close') {
          activeGateOperations.delete(gate.id);
        }

        return {
          success: true,
          message: `GPIO operation on pin ${pin} for ${duration}ms (${action})`,
          data: { pin, action, durationMs: duration },
        };
      } catch (err) {
        // Clear active operation on error
        if (action === 'open' || action === 'close') {
          activeGateOperations.delete(gate.id);
        }
        if (abortController.signal.aborted) {
          logger.info({ gateId: gate.id, action }, 'GPIO operation was stopped');
          return {
            success: true,
            message: `Operation ${action} was stopped`,
            data: { pin, action, stopped: true },
          };
        }
        throw err;
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

/**
 * Get the status of all active gate operations.
 * Returns a map of gateId -> operation info (action, startTime, estimatedEndTime).
 */
export function getActiveGateOperations(): Map<string, { action: GateAction; startTime: number; estimatedEndTime: number }> {
  const result = new Map<string, { action: GateAction; startTime: number; estimatedEndTime: number }>();
  
  for (const [gateId, op] of activeGateOperations) {
    const duration = op.config.holdDurationMs ?? op.config.pulseDurationMs;
    result.set(gateId, {
      action: op.action,
      startTime: op.startTime,
      estimatedEndTime: op.startTime + duration,
    });
  }
  
  return result;
}
