import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GateStatus, GateCommandEvent } from './api';

const API_BASE = '/api';

interface SSEState {
  connected: boolean;
  gateStatus: GateStatus[];
  lastCommand: GateCommandEvent | null;
}

/**
 * Hook for subscribing to Server-Sent Events for real-time gate updates.
 * Automatically reconnects on disconnect and invalidates queries when events arrive.
 */
export function useGateEvents() {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const [state, setState] = useState<SSEState>({
    connected: false,
    gateStatus: [],
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
        gateStatus: data.gateStatus || [],
      }));
      console.log('[SSE] Connected:', data.clientId);
    });

    es.addEventListener('gate-command', (event) => {
      const data: GateCommandEvent = JSON.parse((event as MessageEvent).data);
      setState((prev) => ({
        ...prev,
        lastCommand: data,
      }));
      // Invalidate audit logs to refresh the list
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      console.log('[SSE] Gate command:', data);
    });

    es.addEventListener('gate-status', (event) => {
      const data: GateStatus[] = JSON.parse((event as MessageEvent).data);
      setState((prev) => ({
        ...prev,
        gateStatus: data,
      }));
      console.log('[SSE] Gate status:', data);
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

  // Helper to check if a specific gate is currently active
  const getGateActiveStatus = useCallback(
    (gateId: string): GateStatus | undefined => {
      return state.gateStatus.find((s) => s.gateId === gateId);
    },
    [state.gateStatus]
  );

  return {
    connected: state.connected,
    gateStatus: state.gateStatus,
    lastCommand: state.lastCommand,
    getGateActiveStatus,
    reconnect: connect,
  };
}
