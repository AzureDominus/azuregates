// Device configuration TypeScript types
// These mirror the JSON schema for type safety

export interface DevicesConfig {
  version: number;
  settings: GlobalSettings;
  locations: Location[];
}

// Legacy alias for backward compatibility
export type GatesConfig = DevicesConfig;

export interface GlobalSettings {
  defaultCooldownMs: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  maintenanceMode?: boolean;
  showStatusMessages?: boolean;
}

export interface Location {
  id: string;
  name: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  areas?: Area[];
}

export interface Area {
  id: string;
  name: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  devices?: Device[];
  /** @deprecated Use devices instead */
  gates?: Device[];
}

export type DeviceType = 'gate' | 'utility';

export interface Device {
  id: string;
  name: string;
  enabled?: boolean;
  deviceType: DeviceType;
  driver: DriverType;
  capabilities: DeviceAction[];
  config: GpioDriverConfig | WebhookDriverConfig;
  metadata?: Record<string, unknown>;
}

// Legacy alias
export type Gate = Device;

export type DriverType = 'gpio' | 'webhook';

// Gate actions: open, close, stop, toggle
// Utility actions: on, off, toggle
// Both: state (read-only)
export type DeviceAction = 'open' | 'close' | 'stop' | 'toggle' | 'on' | 'off' | 'state';

// Legacy alias
export type GateAction = DeviceAction;

// Capabilities by device type
export const GATE_CAPABILITIES: DeviceAction[] = ['open', 'close', 'stop', 'toggle'];
export const UTILITY_CAPABILITIES: DeviceAction[] = ['on', 'off', 'toggle'];

export interface GpioDriverConfig {
  // Gate pins
  openPin?: number;
  closePin?: number;
  stopPin?: number;
  togglePin?: number;
  // Utility pins
  onPin?: number;
  offPin?: number;
  // Timing
  pulseDurationMs?: number;
  /** Duration to hold the pin active for open/close operations (ms). Used for gates that move while pin is held. */
  holdDurationMs?: number;
  /** If true, the relay stays on until explicitly turned off. If false, uses pulse/hold durations. */
  maintainState?: boolean;
  activeHigh: boolean;
}

export interface WebhookDriverConfig {
  endpoints?: {
    open?: string;
    close?: string;
    stop?: string;
    toggle?: string;
    on?: string;
    off?: string;
    state?: string;
  };
  endpoint?: string;
  actionParam?: string;
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  timeoutMs: number;
}
