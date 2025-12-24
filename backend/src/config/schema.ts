// Gate configuration TypeScript types
// These mirror the JSON schema for type safety

export interface GatesConfig {
  version: number;
  settings: GlobalSettings;
  locations: Location[];
}

export interface GlobalSettings {
  defaultCooldownMs: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  maintenanceMode?: boolean;
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
  gates?: Gate[];
}

export interface Gate {
  id: string;
  name: string;
  enabled?: boolean;
  driver: DriverType;
  capabilities: GateAction[];
  config: GpioDriverConfig | WebhookDriverConfig;
  metadata?: Record<string, unknown>;
}

export type DriverType = 'gpio' | 'webhook';

export type GateAction = 'open' | 'close' | 'stop' | 'toggle' | 'state';

export interface GpioDriverConfig {
  openPin?: number;
  closePin?: number;
  stopPin?: number;
  togglePin?: number;
  pulseDurationMs: number;
  /** Duration to hold the pin active for open/close operations (ms). Used for gates that move while pin is held. */
  holdDurationMs?: number;
  activeHigh: boolean;
}

export interface WebhookDriverConfig {
  endpoints?: {
    open?: string;
    close?: string;
    stop?: string;
    toggle?: string;
    state?: string;
  };
  endpoint?: string;
  actionParam?: string;
  method: 'GET' | 'POST' | 'PUT';
  headers?: Record<string, string>;
  timeoutMs: number;
}
