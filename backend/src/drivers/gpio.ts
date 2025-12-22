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

    if (isSimulated) {
      return this.simulateGpio(gate, action, pin, config);
    }

    return this.executeRealGpio(gate, action, pin, config);
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

  private async simulateGpio(
    gate: Gate,
    action: GateAction,
    pin: number,
    config: GpioDriverConfig
  ): Promise<DriverResult> {
    logger.info(
      {
        gateId: gate.id,
        action,
        pin,
        pulseDurationMs: config.pulseDurationMs,
        activeHigh: config.activeHigh,
        simulated: true,
      },
      'Simulating GPIO pulse'
    );

    // Simulate the pulse duration
    await new Promise((resolve) => setTimeout(resolve, config.pulseDurationMs));

    return {
      success: true,
      message: `Simulated GPIO pulse on pin ${pin} for ${config.pulseDurationMs}ms`,
      data: { simulated: true, pin, action },
    };
  }

  private async executeRealGpio(
    gate: Gate,
    action: GateAction,
    pin: number,
    config: GpioDriverConfig
  ): Promise<DriverResult> {
    try {
      const Gpio = await loadGpioLibrary();
      
      if (!Gpio) {
        // Fall back to simulation if library not available
        return this.simulateGpio(gate, action, pin, config);
      }

      logger.info(
        { gateId: gate.id, action, pin, pulseDurationMs: config.pulseDurationMs, activeHigh: config.activeHigh },
        'Executing GPIO pulse'
      );

      // Initialize GPIO pin
      // Start in inactive state based on activeHigh setting
      const initialState = config.activeHigh ? 'low' : 'high';
      const gpio = new Gpio(pin, initialState as any);
      
      const activeValue: 0 | 1 = config.activeHigh ? 1 : 0;
      const inactiveValue: 0 | 1 = config.activeHigh ? 0 : 1;

      try {
        // Set active state
        gpio.writeSync(activeValue);
        
        // Hold for pulse duration
        await new Promise((resolve) => setTimeout(resolve, config.pulseDurationMs));
        
        // Set inactive state
        gpio.writeSync(inactiveValue);
        
        logger.info(
          { gateId: gate.id, action, pin, pulseDurationMs: config.pulseDurationMs },
          'GPIO pulse completed'
        );

        return {
          success: true,
          message: `GPIO pulse on pin ${pin} for ${config.pulseDurationMs}ms`,
          data: { pin, action, pulseDurationMs: config.pulseDurationMs },
        };
      } finally {
        // Always unexport the GPIO pin to release it
        gpio.unexport();
      }
    } catch (err) {
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
