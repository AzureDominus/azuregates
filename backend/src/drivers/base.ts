import type { Gate } from '@prisma/client';
import type { GateAction } from '../config/schema.js';

// Driver execution result
export interface DriverResult {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

// Base driver interface
export interface GateDriver {
  readonly name: string;
  readonly supportedActions: GateAction[];

  // Check if driver supports an action
  supportsAction(action: GateAction): boolean;

  // Execute an action
  execute(gate: Gate, action: GateAction): Promise<DriverResult>;

  // Validate driver configuration
  validateConfig(config: unknown): { valid: boolean; errors?: string[] };
}

// Abstract base class for drivers
export abstract class BaseDriver implements GateDriver {
  abstract readonly name: string;
  abstract readonly supportedActions: GateAction[];

  supportsAction(action: GateAction): boolean {
    return this.supportedActions.includes(action);
  }

  abstract execute(gate: Gate, action: GateAction): Promise<DriverResult>;

  abstract validateConfig(config: unknown): { valid: boolean; errors?: string[] };
}
