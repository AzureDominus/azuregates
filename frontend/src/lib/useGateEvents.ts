import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DeviceStatus, DeviceCommandEvent, DeviceState } from './api';

const API_BASE = '/api';

interface SSEState {
  connected: boolean;
  deviceStatus: DeviceStatus[];
  deviceStates: Map<string, DeviceState>;
  lastCommand: DeviceCommandEvent | null;
}

/**
 * Hook for subscribing to Server-Sent Events for real-time device updates.
 * Automatically reconnects on disconnect and invalidates queries when events arrive.
 */
export function useGateEvents() {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const [state, setState] = useState<SSEState>({
    connected: false,
    deviceStatus: [],
    deviceStates: new Map(),
    lastCommand: null,
  });

  const connect = useCallback(() => {
    // Don't connect if already connected
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
    eventSourceRef.current = es;

    es.addEventListener('connected', (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      setState((prev) => ({
        ...prev,
        connected: true,
        deviceStatus: data.deviceStatus || data.gateStatus || [],
      }));
      console.log('[SSE] Connected:', data.clientId);
    });

    es.addEventListener('device-command', (event) => {
      const data: DeviceCommandEvent = JSON.parse((event as MessageEvent).data);
      setState((prev) => ({
        ...prev,
        lastCommand: data,
      }));
      // Invalidate audit logs to refresh the list
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      console.log('[SSE] Device command:', data);
    });

    es.addEventListener('device-status', (event) => {
      const data: DeviceStatus[] = JSON.parse((event as MessageEvent).data);
      setState((prev) => ({
        ...prev,
        deviceStatus: data,
      }));
      console.log('[SSE] Device status:', data);
    });

    es.addEventListener('device-state', (event) => {
      const data: DeviceState = JSON.parse((event as MessageEvent).data);
      setState((prev) => {
        const newStates = new Map(prev.deviceStates);
        newStates.set(data.deviceId, data);
        return {
          ...prev,
          deviceStates: newStates,
        };
      });
      console.log('[SSE] Device state:', data);
    });

    es.onerror = () => {
      console.log('[SSE] Connection error, reconnecting in 5s...');
      setState((prev) => ({ ...prev, connected: false }));
      es.close();
      eventSourceRef.current = null;

      // Reconnect after delay
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 5000);
    };

    es.onopen = () => {
      console.log('[SSE] Connection opened');
    };
  }, [queryClient]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState((prev) => ({ ...prev, connected: false }));
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  // Helper to check if a specific device is currently active
  const getDeviceActiveStatus = useCallback(
    (deviceId: string): DeviceStatus | undefined => {
      return state.deviceStatus.find((s) => s.deviceId === deviceId);
    },
    [state.deviceStatus]
  );

  // Helper to get device state for maintainState utilities
  const getDeviceState = useCallback(
    (deviceId: string): DeviceState | undefined => {
      return state.deviceStates.get(deviceId);
    },
    [state.deviceStates]
  );

  return {
    connected: state.connected,
    deviceStatus: state.deviceStatus,
    deviceStates: state.deviceStates,
    lastCommand: state.lastCommand,
    getDeviceActiveStatus,
    getDeviceState,
    reconnect: connect,
  };
}
