import type { Device } from '@prisma/client';
import type { DeviceAction } from '../config/schema.js';

// Driver execution result
export interface DriverResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

// State reading result for utility devices
export interface DeviceState {
  isOn: boolean;
  pin?: number;
  simulated?: boolean;
}

// Base driver interface
export interface DeviceDriver {
  readonly name: string;
  readonly supportedActions: DeviceAction[];

  // Check if driver supports an action
  supportsAction(action: DeviceAction): boolean;

  // Execute an action
  execute(device: Device, action: DeviceAction): Promise<DriverResult>;

  // Validate driver configuration
  validateConfig(config: unknown): { valid: boolean; errors?: string[] };

  // Read current state for maintainState utility devices (optional)
  readState?(device: Device): Promise<DeviceState | null>;
}

// Legacy alias
export type GateDriver = DeviceDriver;

// Abstract base class for drivers
export abstract class BaseDriver implements DeviceDriver {
  abstract readonly name: string;
  abstract readonly supportedActions: DeviceAction[];

  supportsAction(action: DeviceAction): boolean {
    return this.supportedActions.includes(action);
  }

  abstract execute(device: Device, action: DeviceAction): Promise<DriverResult>;

  abstract validateConfig(config: unknown): { valid: boolean; errors?: string[] };
}
