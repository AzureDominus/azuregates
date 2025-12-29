const API_BASE = '/api';

export type DeviceAction = 'open' | 'close' | 'stop' | 'toggle' | 'on' | 'off' | 'state';
export type DeviceType = 'gate' | 'utility';

export interface Device {
  id: string;
  areaId: string;
  name: string;
  enabled: boolean;
  deviceType: DeviceType;
  driverType: string;
  driverConfig: Record<string, unknown>;
  capabilities: string[];
  metadata: Record<string, unknown>;
}

export interface DeviceStatus {
  deviceId: string;
  action: DeviceAction;
  startTime: number;
  estimatedEndTime: number;
  remainingMs: number;
}

export interface DeviceCommandEvent {
  deviceId: string;
  deviceName: string;
  action: string;
  result: 'success' | 'failure' | 'denied';
  userId?: string;
  timestamp: number;
}

export interface Area {
  id: string;
  locationId: string;
  name: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  devices?: Device[];
}

export interface Location {
  id: string;
  name: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  areas?: Area[];
}

export interface AuditLog {
  id: string;
  userId?: string;
  deviceId?: string;
  action: string;
  result: string;
  errorMessage?: string;
  clientIp?: string;
  latencyMs?: number;
  metadata?: { message?: string; data?: Record<string, unknown> };
  createdAt: string;
  device?: { id: string; name: string };
  user?: { id: string; displayName: string; email: string };
}

export interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

export interface CommandResult {
  success: boolean;
  device: { id: string; name: string };
  action: string;
  result?: { message?: string; data?: Record<string, unknown> };
}

export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp: string;
  version?: string;
  checks?: Record<string, { status: string; latencyMs?: number; error?: string }>;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...options?.headers as Record<string, string>,
  };
  
  // Only set Content-Type for requests with a body
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Health
  getHealth: () => fetchJson<HealthStatus>('/health'),
  getHealthReady: () => fetchJson<HealthStatus>('/health/ready'),

  // Locations
  getLocations: () => fetchJson<Location[]>('/locations'),
  getLocation: (id: string) => fetchJson<Location>(`/locations/${id}`),

  // Areas
  getAreas: (locationId: string) => fetchJson<Area[]>(`/locations/${locationId}/areas`),

  // Devices
  getDevices: () => fetchJson<Device[]>('/devices'),
  getDevice: (id: string) => fetchJson<Device>(`/devices/${id}`),
  getDeviceStatus: () => fetchJson<DeviceStatus[]>('/devices/status'),

  // Commands
  sendCommand: (deviceId: string, action: DeviceAction) =>
    fetchJson<CommandResult>(`/devices/${deviceId}/command`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // Audit logs
  getAuditLogs: (params?: { deviceId?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.deviceId) searchParams.set('deviceId', params.deviceId);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return fetchJson<AuditLogsResponse>(`/audit-logs${query ? `?${query}` : ''}`);
  },

  // Config
  getConfig: () => fetchJson<DevicesConfig>('/config'),
  updateConfig: (config: DevicesConfig) =>
    fetchJson<{ success: boolean; config: DevicesConfig }>('/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  reloadConfig: () =>
    fetchJson<{ success: boolean; config: DevicesConfig }>('/config/reload', { method: 'POST' }),
  getConfigHistory: () => fetchJson<string[]>('/config/history'),
  rollbackConfig: (filename: string) =>
    fetchJson<{ success: boolean; config: DevicesConfig }>(`/config/rollback/${encodeURIComponent(filename)}`, {
      method: 'POST',
    }),

  // Auth
  getCurrentUser: () => fetchJson<{ authenticated: boolean; user: User | null }>('/auth/me'),
  login: (returnTo?: string) => {
    const params = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    window.location.href = `${API_BASE}/auth/login${params}`;
  },
  logout: () => fetchJson<{ success: boolean; logoutUrl?: string }>('/auth/logout', { method: 'POST' }),

  // Guest
  getGuestScope: () => fetchJson<GuestScope>('/guest/scope'),
  redeemGuestToken: (token: string) =>
    fetchJson<{ success: boolean; guest: GuestScope }>(`/guest/redeem?token=${encodeURIComponent(token)}`),
  createInvite: (data: CreateInviteRequest) =>
    fetchJson<{ success: boolean; invite: Invite }>('/guest/invites', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getInvites: () => fetchJson<Invite[]>('/guest/invites'),
  deleteInvite: (id: string) => 
    fetchJson<{ success: boolean }>(`/guest/invites/${id}`, { method: 'DELETE' }),

  // Admin
  getUsers: () => fetchJson<AdminUser[]>('/admin/users'),
  getUser: (id: string) => fetchJson<AdminUserDetails>(`/admin/users/${id}`),
  grantPermission: (userId: string, data: GrantPermissionRequest) =>
    fetchJson<{ success: boolean; permission: UserPermission }>(`/admin/users/${userId}/permissions`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  revokePermission: (permissionId: string) =>
    fetchJson<{ success: boolean }>(`/admin/permissions/${permissionId}`, { method: 'DELETE' }),
  getScopes: () => fetchJson<ScopesResponse>('/admin/scopes'),
  
  // User activation management
  getPendingUsers: () => fetchJson<PendingUser[]>('/admin/users/pending'),
  activateUser: (userId: string) =>
    fetchJson<{ success: boolean; user: { id: string; isActivated: boolean; activatedAt: string } }>(
      `/admin/users/${userId}/activate`,
      { method: 'POST' }
    ),
  deactivateUser: (userId: string) =>
    fetchJson<{ success: boolean; user: { id: string; isActivated: boolean } }>(
      `/admin/users/${userId}/deactivate`,
      { method: 'POST' }
    ),
  deleteUser: (userId: string) =>
    fetchJson<{ success: boolean }>(`/admin/users/${userId}`, { method: 'DELETE' }),
};

// Additional types
export interface User {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  isGuest: boolean;
  permissions?: string[];
  // Activation status (added for pending/disabled account handling)
  isActivated?: boolean;
  wasEverActivated?: boolean;
}

// Config types (matching backend schema)
export interface DevicesConfig {
  version: number;
  settings: GlobalSettings;
  locations: ConfigLocation[];
}

export interface GlobalSettings {
  defaultCooldownMs: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  maintenanceMode?: boolean;
  showStatusMessages?: boolean;
}

export interface ConfigLocation {
  id: string;
  name: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  areas?: ConfigArea[];
}

export interface ConfigArea {
  id: string;
  name: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
  devices?: ConfigDevice[];
}

export interface ConfigDevice {
  id: string;
  name: string;
  enabled?: boolean;
  deviceType?: DeviceType;
  driver: 'gpio' | 'webhook';
  capabilities: DeviceAction[];
  config: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AdminUser {
  id: string;
  externalId: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  isActivated: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
  activatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { permissions: number };
}

export interface PendingUser {
  id: string;
  externalId: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
  createdAt: string;
}

export interface UserPermission {
  id: string;
  userId: string;
  scopeType: 'LOCATION' | 'AREA' | 'DEVICE';
  scopeId: string;
  actions: string[];
  expiresAt: string | null;
  createdAt: string;
  scopeName?: string;
}

export interface AdminUserDetails extends Omit<AdminUser, '_count'> {
  permissions: UserPermission[];
  isActivated: boolean;
  activatedAt: string | null;
  activatedBy: string | null;
  activatedByName: string | null;
}

export interface GrantPermissionRequest {
  scopeType: 'LOCATION' | 'AREA' | 'DEVICE';
  scopeId: string;
  actions: string[];
  expiresAt?: string;
}

export interface ScopesResponse {
  locations: { id: string; name: string }[];
  areas: { id: string; name: string; locationId: string }[];
  devices: { id: string; name: string; areaId: string; capabilities: string[]; deviceType?: string }[];
}

export interface GuestScope {
  scopeType: 'LOCATION' | 'AREA' | 'DEVICE';
  scopeId: string;
  scopeDetails?: {
    name: string;
    devices?: { id: string; name: string }[];
  };
  allowedActions: string[];
  expiresAt: string;
}

export interface Invite {
  id: string;
  scopeType: 'LOCATION' | 'AREA' | 'DEVICE';
  scopeId: string;
  allowedActions: string[];
  expiresAt: string;
  maxUses?: number;
  useCount: number;
  createdAt?: string;
  magicLink?: string;
}

export interface CreateInviteRequest {
  scopeType: 'LOCATION' | 'AREA' | 'DEVICE';
  scopeId: string;
  allowedActions: DeviceAction[];
  expiresInHours?: number;
  maxUses?: number;
}
