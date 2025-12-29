import type { Device } from '@prisma/client';
import { z } from 'zod';
import { BaseDriver, type DriverResult, type DeviceState } from './base.js';
import type { DeviceAction, GpioDriverConfig } from '../config/schema.js';
import { logger } from '../lib/logger.js';
import { getConfig } from '../config/loader.js';

const gpioConfigSchema = z.object({
  // Gate pins
  openPin: z.number().int().min(0).max(40).optional(),
  closePin: z.number().int().min(0).max(40).optional(),
  stopPin: z.number().int().min(0).max(40).optional(),
  togglePin: z.number().int().min(0).max(40).optional(),
  // Utility pins
  onPin: z.number().int().min(0).max(40).optional(),
  offPin: z.number().int().min(0).max(40).optional(),
  // Timing
  pulseDurationMs: z.number().min(50).max(60000).default(500),
  holdDurationMs: z.number().min(1000).max(120000).optional(),
  // State behavior
  maintainState: z.boolean().default(false),
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

// Track active operations per device to prevent simultaneous open/close
// This is CRITICAL for safety - we must NEVER activate open and close simultaneously
interface ActiveOperation {
  action: DeviceAction;
  pin: number;
  startTime: number;
  abortController: AbortController;
  config: GpioDriverConfig;
}
const activeDeviceOperations: Map<string, ActiveOperation> = new Map();

// Mutex locks per device to ensure serialized access
const deviceMutexes: Map<string, Promise<void>> = new Map();

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

/**
 * Set a GPIO pin to a specific state (for maintainState utilities).
 * The pin will stay in this state until explicitly changed.
 */
async function callGpioServiceSet(pin: number, high: boolean): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (GPIO_SERVICE_SECRET) {
    headers['X-GPIO-Secret'] = GPIO_SERVICE_SECRET;
  }
  
  const response = await fetch(`${GPIO_SERVICE_URL}/set`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ pin, high }),
  });
  
  const result = await response.json() as { success: boolean; error?: string };
  
  if (!response.ok || !result.success) {
    throw new Error(result.error || `GPIO service returned ${response.status}`);
  }
  
  logger.debug({ pin, high, result }, 'GPIO set state via HTTP service');
}

/**
 * Read the current state of a GPIO pin.
 */
async function callGpioServiceRead(pin: number): Promise<boolean> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (GPIO_SERVICE_SECRET) {
    headers['X-GPIO-Secret'] = GPIO_SERVICE_SECRET;
  }
  
  const response = await fetch(`${GPIO_SERVICE_URL}/read?pins=${pin}`, {
    method: 'GET',
    headers,
  });
  
  const result = await response.json() as { 
    success: boolean; 
    pins?: Record<string, { state: number; high: boolean; low: boolean; tracked: boolean; error?: string }>;
    error?: string;
  };
  
  if (!response.ok || !result.success) {
    throw new Error(result.error || `GPIO service returned ${response.status}`);
  }
  
  const pinData = result.pins?.[pin.toString()];
  if (!pinData) {
    throw new Error(`No data returned for pin ${pin}`);
  }
  if (pinData.error) {
    throw new Error(pinData.error);
  }
  
  return pinData.high;
}

export class GpioDriver extends BaseDriver {
  readonly name = 'gpio';
  readonly supportedActions: DeviceAction[] = ['open', 'close', 'stop', 'toggle', 'on', 'off'];

  async execute(device: Device, action: DeviceAction): Promise<DriverResult> {
    const config = device.driverConfig as unknown as GpioDriverConfig;

    // STOP action is special - it interrupts active operations
    if (action === 'stop') {
      return this.executeStop(device, config);
    }

    // OFF action for maintainState utilities - turn off the relay
    if (action === 'off' && config.maintainState) {
      return this.executeOff(device, config);
    }

    const pin = this.getPinForAction(config, action);

    if (pin === null) {
      return {
        success: false,
        message: `No pin configured for action: ${action}`,
      };
    }

    // SAFETY CHECK: Prevent simultaneous open/close on the same device
    // This is CRITICAL - activating both simultaneously causes electrical problems
    if (action === 'open' || action === 'close') {
      const conflictingAction = action === 'open' ? 'close' : 'open';
      const activeOp = activeDeviceOperations.get(device.id);
      
      if (activeOp && (activeOp.action === 'open' || activeOp.action === 'close')) {
        const errorMsg = `SAFETY BLOCK: Cannot execute ${action} while ${activeOp.action} is active on device ${device.id}. ` +
          `Active operation started ${Date.now() - activeOp.startTime}ms ago on pin ${activeOp.pin}. ` +
          `This prevents electrical damage from simultaneous open/close signals.`;
        logger.error({ deviceId: device.id, action, activeOp }, errorMsg);
        return {
          success: false,
          message: `Cannot ${action} while device is ${activeOp.action === 'open' ? 'opening' : 'closing'}. Wait for the operation to complete.`,
        };
      }
    }

    // Use mutex to serialize operations on the same device
    return this.withDeviceMutex(device.id, async () => {
      // Check if maintenance mode is enabled - force simulation
      const devicesConfig = getConfig();
      const isMaintenanceMode = devicesConfig?.settings?.maintenanceMode ?? false;
      
      if (isSimulated || isMaintenanceMode) {
        if (isMaintenanceMode) {
          logger.info({ deviceId: device.id, action }, 'Maintenance mode enabled - simulating GPIO');
        }
        return this.simulateGpio(device, action, pin, config);
      }
      return this.executeRealGpio(device, action, pin, config);
    });
  }

  /**
   * Execute stop action - interrupts any active operation and optionally pulses stop pin.
   * 1. Stop any active pulses on this device's pins via the GPIO service
   * 2. If an operation is tracked locally, abort it
   * 3. If stopPin is configured, pulse it
   */
  private async executeStop(device: Device, config: GpioDriverConfig): Promise<DriverResult> {
    const activeOp = activeDeviceOperations.get(device.id);
    const stopPin = config.stopPin;
    let stoppedGpioService = false;
    let stoppedLocalOp = false;
    let pulsedStopPin = false;

    // Get all pins for this device that might need to be stopped
    const pinsToStop: number[] = [];
    if (config.openPin !== undefined) pinsToStop.push(config.openPin);
    if (config.closePin !== undefined) pinsToStop.push(config.closePin);
    if (config.togglePin !== undefined) pinsToStop.push(config.togglePin);
    if (config.onPin !== undefined) pinsToStop.push(config.onPin);
    if (config.offPin !== undefined) pinsToStop.push(config.offPin);

    logger.info(
      { deviceId: device.id, hasActiveOp: !!activeOp, hasStopPin: !!stopPin, pinsToStop },
      'Executing stop command'
    );

    // Step 1: Stop any active pulses on the GPIO service for this device's pins
    const devicesConfig = getConfig();
    const isMaintenanceMode = devicesConfig?.settings?.maintenanceMode ?? false;
    const shouldSimulate = isSimulated || isMaintenanceMode;

    if (!shouldSimulate && await checkGpioServiceAvailable()) {
      for (const pin of pinsToStop) {
        try {
          await forceGpioInactive(pin, config.activeHigh);
          logger.info({ deviceId: device.id, pin }, 'Stopped GPIO pin via service');
          stoppedGpioService = true;
        } catch (err) {
          logger.warn({ deviceId: device.id, pin, err }, 'Failed to stop GPIO pin');
        }
      }
    }

    // Step 2: If there's a locally tracked operation, abort it
    if (activeOp) {
      logger.info(
        { deviceId: device.id, activeAction: activeOp.action, activePin: activeOp.pin },
        'Aborting locally tracked operation'
      );
      activeOp.abortController.abort();
      activeDeviceOperations.delete(device.id);
      stoppedLocalOp = true;
    }

    // Step 3: If stopPin is configured, pulse it
    if (stopPin !== undefined) {
      logger.info(
        { deviceId: device.id, stopPin, pulseDurationMs: config.pulseDurationMs, simulated: shouldSimulate },
        'Pulsing stop pin'
      );

      try {
        if (shouldSimulate) {
          // Simulate the stop pin pulse
          await new Promise((resolve) => setTimeout(resolve, config.pulseDurationMs));
          logger.info({ deviceId: device.id, stopPin, simulated: true, maintenanceMode: isMaintenanceMode }, 'Simulated stop pin pulse');
        } else if (await checkGpioServiceAvailable()) {
          // Use GPIO service to pulse the stop pin
          await callGpioServicePulse(stopPin, config.pulseDurationMs ?? 500, config.activeHigh);
          logger.info({ deviceId: device.id, stopPin, durationMs: config.pulseDurationMs }, 'Pulsed stop pin via GPIO service');
        } else {
          // Simulate if GPIO service not available
          await new Promise((resolve) => setTimeout(resolve, config.pulseDurationMs));
          logger.info({ deviceId: device.id, stopPin, simulated: true, reason: 'GPIO service not available' }, 'Simulated stop pin pulse');
        }
        pulsedStopPin = true;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ deviceId: device.id, stopPin, err }, 'Failed to pulse stop pin');
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
   * Execute OFF action for maintainState utilities - sets pin to inactive.
   */
  private async executeOff(device: Device, config: GpioDriverConfig): Promise<DriverResult> {
    // For maintainState utilities, 'off' sets the pin to inactive
    const pin = config.offPin ?? config.onPin;
    if (pin === undefined) {
      return { success: false, message: 'No on/off pin configured' };
    }

    const devicesConfig = getConfig();
    const isMaintenanceMode = devicesConfig?.settings?.maintenanceMode ?? false;
    const shouldSimulate = isSimulated || isMaintenanceMode;

    logger.info({ deviceId: device.id, pin, action: 'off' }, 'Executing OFF (set inactive)');

    try {
      if (shouldSimulate) {
        logger.info({ deviceId: device.id, pin, simulated: true }, 'Simulated OFF');
      } else if (await checkGpioServiceAvailable()) {
        await callGpioServiceSet(pin, !config.activeHigh); // Set to inactive state
        logger.info({ deviceId: device.id, pin }, 'Set GPIO to inactive via service');
      }
      return {
        success: true,
        message: `Device turned off (pin ${pin} set inactive)`,
        data: { pin, action: 'off', state: 'off' },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ deviceId: device.id, pin, err }, 'Failed to turn off device');
      return { success: false, message: `Failed to turn off: ${errorMessage}` };
    }
  }

  /**
   * Serialize access to a device using a mutex pattern.
   * This ensures operations complete before another starts.
   */
  private async withDeviceMutex<T>(deviceId: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any existing operation on this device
    const existingMutex = deviceMutexes.get(deviceId);
    if (existingMutex) {
      await existingMutex.catch(() => {}); // Ignore errors from previous operation
    }

    // Create new mutex for this operation
    let resolve: () => void;
    const mutex = new Promise<void>((r) => { resolve = r; });
    deviceMutexes.set(deviceId, mutex);

    try {
      return await fn();
    } finally {
      resolve!();
      if (deviceMutexes.get(deviceId) === mutex) {
        deviceMutexes.delete(deviceId);
      }
    }
  }

  private getPinForAction(config: GpioDriverConfig, action: DeviceAction): number | null {
    switch (action) {
      case 'open':
        return config.openPin ?? null;
      case 'close':
        return config.closePin ?? null;
      case 'stop':
        return config.stopPin ?? null;
      case 'toggle':
        return config.togglePin ?? null;
      case 'on':
        return config.onPin ?? null;
      case 'off':
        return config.offPin ?? config.onPin ?? null; // Fall back to onPin for single-pin utilities
      default:
        return null;
    }
  }

  /**
   * Get the duration to hold the pin active.
   * For open/close operations, use holdDurationMs if configured.
   * For toggle/stop/on/off operations, use pulseDurationMs.
   * For maintainState utilities, returns 0 (pin stays on until off command).
   */
  private getActiveDuration(config: GpioDriverConfig, action: DeviceAction): number {
    // maintainState utilities don't pulse - they stay on
    if (config.maintainState && (action === 'on' || action === 'toggle')) {
      return 0; // Special: 0 means set and hold
    }
    if ((action === 'open' || action === 'close') && config.holdDurationMs) {
      return config.holdDurationMs;
    }
    return config.pulseDurationMs ?? 500;
  }

  private async simulateGpio(
    device: Device,
    action: DeviceAction,
    pin: number,
    config: GpioDriverConfig
  ): Promise<DriverResult> {
    const duration = this.getActiveDuration(config, action);
    const abortController = new AbortController();
    
    logger.info(
      {
        deviceId: device.id,
        action,
        pin,
        durationMs: duration,
        pulseDurationMs: config.pulseDurationMs,
        holdDurationMs: config.holdDurationMs,
        maintainState: config.maintainState,
        activeHigh: config.activeHigh,
        simulated: true,
      },
      'Simulating GPIO operation'
    );

    // Track active operation for safety checks (with abort controller for stop)
    if (action === 'open' || action === 'close') {
      activeDeviceOperations.set(device.id, {
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
          const currentOp = activeDeviceOperations.get(device.id);
          if (currentOp && currentOp.pin === pin && currentOp.action === action && !currentOp.abortController.signal.aborted) {
            activeDeviceOperations.delete(device.id);
            logger.debug({ deviceId: device.id, action }, 'Cleared simulated GPIO operation tracking');
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
        logger.info({ deviceId: device.id, action }, 'GPIO operation was stopped');
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
        activeDeviceOperations.delete(device.id);
      }
    }
  }

  // Handle maintainState utilities - set pin and keep it on
  private async executeMaintainState(
    device: Device,
    action: DeviceAction,
    pin: number,
    config: GpioDriverConfig,
    simulated: boolean
  ): Promise<DriverResult> {
    const activeState = config.activeHigh;
    
    logger.info(
      { deviceId: device.id, action, pin, maintainState: true, simulated },
      'Executing maintainState GPIO operation'
    );

    try {
      if (!simulated && await checkGpioServiceAvailable()) {
        await callGpioServiceSet(pin, activeState);
      }
      return {
        success: true,
        message: `Device turned on (pin ${pin} set ${activeState ? 'high' : 'low'})`,
        data: { pin, action, state: 'on', maintainState: true, simulated },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, message: `Failed to set GPIO: ${errorMessage}` };
    }
  }

  private async executeRealGpio(
    device: Device,
    action: DeviceAction,
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
        logger.warn({ deviceId: device.id }, 'GPIO service not available, falling back to simulation');
        return this.simulateGpio(device, action, pin, config);
      }

      // Handle maintainState utilities
      if (config.maintainState && (action === 'on' || action === 'toggle')) {
        return this.executeMaintainState(device, action, pin, config, false);
      }

      logger.info(
        { 
          deviceId: device.id, 
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
        activeDeviceOperations.set(device.id, {
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
            { deviceId: device.id, action, pin, durationMs: duration },
            'GPIO operation running asynchronously'
          );
          
          // Set a timer to clear the active operation after the expected duration
          setTimeout(() => {
            const currentOp = activeDeviceOperations.get(device.id);
            if (currentOp && currentOp.pin === pin && currentOp.action === action) {
              activeDeviceOperations.delete(device.id);
              logger.debug({ deviceId: device.id, action }, 'Cleared async GPIO operation tracking');
            }
          }, duration + 500); // Add 500ms buffer
          
          return {
            success: true,
            message: `GPIO operation started on pin ${pin} for ${duration}ms (${action})`,
            data: { pin, action, durationMs: duration, async: true },
          };
        }
        
        logger.info(
          { deviceId: device.id, action, pin, durationMs: duration },
          'GPIO operation completed'
        );

        // Clear tracking for sync operations
        if (action === 'open' || action === 'close') {
          activeDeviceOperations.delete(device.id);
        }

        return {
          success: true,
          message: `GPIO operation on pin ${pin} for ${duration}ms (${action})`,
          data: { pin, action, durationMs: duration },
        };
      } catch (err) {
        // Clear active operation on error
        if (action === 'open' || action === 'close') {
          activeDeviceOperations.delete(device.id);
        }
        if (abortController.signal.aborted) {
          logger.info({ deviceId: device.id, action }, 'GPIO operation was stopped');
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
        activeDeviceOperations.delete(device.id);
      }
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ deviceId: device.id, action, pin, err }, 'GPIO execution failed');
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
    if (!parsed.openPin && !parsed.closePin && !parsed.stopPin && !parsed.togglePin && !parsed.onPin && !parsed.offPin) {
      return {
        valid: false,
        errors: ['At least one action pin must be configured'],
      };
    }

    return { valid: true };
  }

  /**
   * Read the current state of a maintainState utility device.
   * Returns null if the device doesn't support state reading.
   */
  async readState(device: Device): Promise<DeviceState | null> {
    const config = device.driverConfig as unknown as GpioDriverConfig;

    // Only maintainState devices can have their state read
    if (!config.maintainState) {
      logger.debug({ deviceId: device.id }, 'Device does not support state reading (not maintainState)');
      return null;
    }

    // Determine which pin to read - prefer onPin for utilities
    const pin = config.onPin ?? config.togglePin ?? config.openPin;
    if (!pin) {
      logger.warn({ deviceId: device.id }, 'No pin configured for state reading');
      return null;
    }

    const appConfig = getConfig();
    const isSimulating = appConfig?.settings?.maintenanceMode || (process.env.NODE_ENV === 'development');

    if (isSimulating) {
      // In simulation mode, we can't know the actual state
      // Return a simulated "off" state
      logger.debug({ deviceId: device.id, pin }, 'Simulating state read (maintenance mode or dev)');
      return {
        isOn: false,
        pin,
        simulated: true,
      };
    }

    try {
      // Read the actual pin state
      const isHigh = await callGpioServiceRead(pin);
      
      // Convert to logical on/off based on activeHigh setting
      // activeHigh: true  -> HIGH = on,  LOW = off
      // activeHigh: false -> HIGH = off, LOW = on (inverted, default for most relay modules)
      const activeHigh = config.activeHigh ?? false;
      const isOn = activeHigh ? isHigh : !isHigh;

      logger.debug({ deviceId: device.id, pin, isHigh, activeHigh, isOn }, 'Read device state from GPIO');

      return {
        isOn,
        pin,
        simulated: false,
      };
    } catch (error) {
      logger.error({ deviceId: device.id, pin, error }, 'Failed to read device state from GPIO');
      return null;
    }
  }
}

export const gpioDriver = new GpioDriver();

/**
 * Get the status of all active device operations.
 * Returns a map of deviceId -> operation info (action, startTime, estimatedEndTime).
 */
export function getActiveDeviceOperations(): Map<string, { action: DeviceAction; startTime: number; estimatedEndTime: number }> {
  const result = new Map<string, { action: DeviceAction; startTime: number; estimatedEndTime: number }>();
  
  for (const [deviceId, op] of activeDeviceOperations) {
    const duration = op.config.holdDurationMs ?? op.config.pulseDurationMs ?? 500;
    result.set(deviceId, {
      action: op.action,
      startTime: op.startTime,
      estimatedEndTime: op.startTime + duration,
    });
  }
  
  return result;
}

// Legacy export alias
export const getActiveGateOperations = getActiveDeviceOperations;
