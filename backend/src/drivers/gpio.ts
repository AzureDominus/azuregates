import type { Gate } from '@prisma/client';
import { z } from 'zod';
import { existsSync } from 'fs';
import { BaseDriver, type DriverResult } from './base.js';
import type { GateAction, GpioDriverConfig } from '../config/schema.js';
import { logger } from '../lib/logger.js';

const gpioConfigSchema = z.object({
  openPin: z.number().int().min(0).max(40).optional(),
  closePin: z.number().int().min(0).max(40).optional(),
  stopPin: z.number().int().min(0).max(40).optional(),
  togglePin: z.number().int().min(0).max(40).optional(),
  pulseDurationMs: z.number().min(50).max(5000).default(500),
  holdDurationMs: z.number().min(1000).max(120000).optional(),
  activeHigh: z.boolean().default(false),
});

// Check if we're running on hardware with GPIO support
const isRaspberryPi = process.env.GPIO_AVAILABLE === 'true' || 
  (process.platform === 'linux' && existsSync('/sys/class/gpio'));

// In development mode (no actual GPIO), we simulate the GPIO operations
const isSimulated = process.env.NODE_ENV === 'development' || !isRaspberryPi;

// GPIO interface for type safety
interface GpioInterface {
  writeSync: (value: 0 | 1) => void;
  unexport: () => void;
}

// Lazy-loaded GPIO library
let GpioClass: new (pin: number, direction: 'in' | 'out' | 'high' | 'low') => GpioInterface;

// Track active operations per gate to prevent simultaneous open/close
// This is CRITICAL for safety - we must NEVER activate open and close simultaneously
const activeGateOperations: Map<string, { action: GateAction; pin: number; startTime: number }> = new Map();

// Mutex locks per gate to ensure serialized access
const gateMutexes: Map<string, Promise<void>> = new Map();

async function loadGpioLibrary(): Promise<typeof GpioClass | null> {
  if (GpioClass) return GpioClass;
  
  if (isSimulated) {
    logger.info('GPIO: Running in simulated mode');
    return null;
  }

  try {
    const onoff = await import('onoff');
    GpioClass = onoff.Gpio;
    logger.info('GPIO: onoff library loaded successfully');
    return GpioClass;
  } catch (err) {
    logger.warn({ err }, 'GPIO: Could not load onoff library, falling back to simulation');
    return null;
  }
}

export class GpioDriver extends BaseDriver {
  readonly name = 'gpio';
  readonly supportedActions: GateAction[] = ['open', 'close', 'stop', 'toggle'];

  async execute(gate: Gate, action: GateAction): Promise<DriverResult> {
    const config = gate.driverConfig as unknown as GpioDriverConfig;
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
      if (isSimulated) {
        return this.simulateGpio(gate, action, pin, config);
      }
      return this.executeRealGpio(gate, action, pin, config);
    });
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

    // Track active operation for safety checks
    if (action === 'open' || action === 'close') {
      activeGateOperations.set(gate.id, { action, pin, startTime: Date.now() });
    }

    try {
      // Simulate the operation duration
      await new Promise((resolve) => setTimeout(resolve, duration));

      return {
        success: true,
        message: `Simulated GPIO on pin ${pin} for ${duration}ms (${action})`,
        data: { simulated: true, pin, action, durationMs: duration },
      };
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
    
    try {
      const Gpio = await loadGpioLibrary();
      
      if (!Gpio) {
        // Fall back to simulation if library not available
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
        'Executing GPIO operation'
      );

      // Track active operation for safety checks (CRITICAL for open/close mutual exclusion)
      if (action === 'open' || action === 'close') {
        activeGateOperations.set(gate.id, { action, pin, startTime: Date.now() });
      }

      // Initialize GPIO pin
      // Start in inactive state based on activeHigh setting
      const initialState = config.activeHigh ? 'low' : 'high';
      const gpio = new Gpio(pin, initialState as any);
      
      const activeValue: 0 | 1 = config.activeHigh ? 1 : 0;
      const inactiveValue: 0 | 1 = config.activeHigh ? 0 : 1;

      try {
        // Set active state (for activeHigh=false, this sets pin LOW to close relay)
        gpio.writeSync(activeValue);
        
        // Hold for the configured duration
        await new Promise((resolve) => setTimeout(resolve, duration));
        
        // Set inactive state (releases the relay)
        gpio.writeSync(inactiveValue);
        
        logger.info(
          { gateId: gate.id, action, pin, durationMs: duration },
          'GPIO operation completed'
        );

        return {
          success: true,
          message: `GPIO operation on pin ${pin} for ${duration}ms (${action})`,
          data: { pin, action, durationMs: duration },
        };
      } finally {
        // Always unexport the GPIO pin to release it
        gpio.unexport();
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
