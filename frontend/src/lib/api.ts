const API_BASE = '/api';

export type GateAction = 'open' | 'close' | 'stop' | 'toggle' | 'state';

export interface Gate {
  id: string;
  areaId: string;
  name: string;
  enabled: boolean;
  driverType: string;
  driverConfig: Record<string, unknown>;
  capabilities: string[];
  metadata: Record<string, unknown>;
}

export interface Area {
  id: string;
  locationId: string;
  name: string;
  enabled: boolean;
  metadata: Record<string, unknown>;
  gates?: Gate[];
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
  gateId?: string;
  action: string;
  result: string;
  errorMessage?: string;
  clientIp?: string;
  latencyMs?: number;
  createdAt: string;
  gate?: { id: string; name: string };
  user?: { id: string; displayName: string; email: string };
}

export interface CommandResult {
  success: boolean;
  gate: { id: string; name: string };
  action: string;
  result?: { message?: string; data?: Record<string, unknown> };
}

export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp: string;
  checks?: Record<string, { status: string; latencyMs?: number; error?: string }>;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
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

  // Gates
  getGates: () => fetchJson<Gate[]>('/gates'),
  getGate: (id: string) => fetchJson<Gate>(`/gates/${id}`),

  // Commands
  sendCommand: (gateId: string, action: GateAction) =>
    fetchJson<CommandResult>(`/gates/${gateId}/command`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  // Audit logs
  getAuditLogs: (params?: { gateId?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.gateId) searchParams.set('gateId', params.gateId);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return fetchJson<AuditLog[]>(`/audit-logs${query ? `?${query}` : ''}`);
  },

  // Config
  getConfig: () => fetchJson<unknown>('/config'),
  reloadConfig: () =>
    fetchJson<{ success: boolean; config: unknown }>('/config/reload', { method: 'POST' }),

  // Auth
  getCurrentUser: () => fetchJson<{ authenticated: boolean; user: User | null }>('/auth/me'),
  login: (returnTo?: string) => {
    const params = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    window.location.href = `${API_BASE}/auth/login${params}`;
  },
  logout: () => fetchJson<{ success: boolean }>('/auth/logout', { method: 'POST' }),

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
};

// Additional types
export interface User {
  id: string;
  email: string;
  displayName: string;
  isGuest: boolean;
  permissions?: string[];
}

export interface GuestScope {
  scopeType: 'LOCATION' | 'AREA' | 'GATE';
  scopeId: string;
  scopeDetails?: {
    name: string;
    gates?: { id: string; name: string }[];
  };
  allowedActions: string[];
  expiresAt: string;
}

export interface Invite {
  id: string;
  scopeType: 'LOCATION' | 'AREA' | 'GATE';
  scopeId: string;
  allowedActions: string[];
  expiresAt: string;
  maxUses?: number;
  useCount: number;
  createdAt?: string;
  magicLink?: string;
}

export interface CreateInviteRequest {
  scopeType: 'LOCATION' | 'AREA' | 'GATE';
  scopeId: string;
  allowedActions: ('open' | 'close' | 'stop' | 'toggle')[];
  expiresInHours?: number;
  maxUses?: number;
}
