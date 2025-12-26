import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import { api, type Gate, type GateAction, type GateStatus } from '../lib/api';
import { StatusLight, ActionButton } from './ui';

interface GateCardProps {
  gate: Gate;
  activeStatus?: GateStatus;
}

const actionLabels: Record<GateAction, string> = {
  open: 'Opening',
  close: 'Closing',
  stop: 'Stopping',
  toggle: 'Toggling',
  state: 'Checking',
};

export function GateCard({ gate, activeStatus }: GateCardProps) {
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<{ success: boolean; message?: string } | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(0);

  // Update remaining time every 100ms when there's an active operation
  useEffect(() => {
    if (!activeStatus) {
      setRemainingMs(0);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, activeStatus.estimatedEndTime - Date.now());
      setRemainingMs(remaining);
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 100);
    return () => clearInterval(interval);
  }, [activeStatus]);

  const commandMutation = useMutation({
    mutationFn: ({ gateId, action }: { gateId: string; action: GateAction }) =>
      api.sendCommand(gateId, action),
    onSuccess: (result) => {
      setLastResult({ success: true, message: result.result?.message });
      setTimeout(() => setLastResult(null), 3000);
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
    onError: (error) => {
      setLastResult({ success: false, message: error instanceof Error ? error.message : 'Failed' });
      setTimeout(() => setLastResult(null), 5000);
    },
  });

  const handleAction = (action: GateAction) => {
    // Allow stop to be sent even when another action is in progress
    if (commandMutation.isPending && action !== 'stop') return;
    commandMutation.mutate({ gateId: gate.id, action });
  };

  const isDisabled = !gate.enabled;
  const capabilities = gate.capabilities as GateAction[];
  const isActive = !!activeStatus && remainingMs > 0;

  return (
    <div
      className={`relative overflow-hidden rounded-xl transition-all duration-500 group ${
        isActive
          ? 'glass-panel border-secondary/50 shadow-[0_0_30px_rgba(0,210,255,0.15)]'
          : isDisabled
          ? 'bg-surface/40 border border-white/10 opacity-80 saturate-50'
          : 'glass-panel hover:border-white/20 shadow-[0_0_20px_rgba(0,0,0,0.4)]'
      }`}
    >
      {/* Active Scanline Effect */}
      {isActive && (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-xl">
          <div className="absolute inset-0 bg-secondary/5 animate-pulse" />
          <div className="absolute top-0 left-0 w-full h-[2px] bg-secondary/30 shadow-[0_0_10px_#00d2ff] animate-scanline" />
        </div>
      )}

      <div className="relative z-10 p-5 sm:p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <StatusLight 
                variant={isActive ? 'info' : isDisabled ? 'neutral' : 'success'}
                pulse={isActive}
                size="md"
              />
              <h4 className="font-display font-bold text-xl tracking-wide text-white">{gate.name}</h4>
            </div>
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider pl-5">
              {gate.driverType} :: {gate.areaId}
            </p>
          </div>
          
          {isDisabled && (
            <span className="text-[10px] font-mono bg-yellow-900/30 text-yellow-500 border border-yellow-700/50 px-2 py-1 rounded uppercase tracking-wider">
              Offline
            </span>
          )}
        </div>

        {/* Active Status Display */}
        <div className={`mb-6 transition-all duration-300 ${isActive ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 h-0 overflow-hidden'}`}>
          <div className="bg-secondary/10 border border-secondary/20 rounded-lg p-3 flex items-center gap-3">
            <Icon icon="ph:spinner" className="w-5 h-5 text-secondary animate-spin" />
            <div className="flex-1">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-secondary">
                  {activeStatus ? actionLabels[activeStatus.action] : 'Processing...'}
                </span>
                <span className="text-xs font-mono text-secondary/70">
                  {(remainingMs / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="h-1 w-full bg-secondary/20 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-secondary shadow-[0_0_8px_#00d2ff] transition-all duration-100 ease-linear"
                  style={{ 
                    width: activeStatus 
                      ? `${(remainingMs / (activeStatus.estimatedEndTime - activeStatus.startTime)) * 100}%` 
                      : '100%' 
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Controls Grid */}
        <div className="grid grid-cols-2 gap-3">
          {capabilities.filter((a): a is 'open' | 'close' | 'stop' | 'toggle' => a !== 'state').map((action) => {
            const isStop = action === 'stop';

            return (
              <ActionButton
                key={action}
                action={action}
                onClick={() => handleAction(action)}
                disabled={isDisabled || (commandMutation.isPending && !isStop)}
                loading={commandMutation.isPending && commandMutation.variables?.action === action}
                fullWidth={isStop}
              />
            );
          })}
        </div>

        {/* Feedback Message */}
        {lastResult && (
          <div 
            className="mt-4 text-center text-xs font-mono py-2 rounded border animate-in fade-in slide-in-from-bottom-2"
            style={{
              backgroundColor: lastResult.success ? 'rgba(0, 255, 157, 0.1)' : 'rgba(255, 42, 42, 0.1)',
              color: lastResult.success ? '#00ff9d' : '#ff2a2a',
              borderColor: lastResult.success ? 'rgba(0, 255, 157, 0.2)' : 'rgba(255, 42, 42, 0.2)',
            }}
          >
            {lastResult.message || (lastResult.success ? 'Command Sent' : 'Failed')}
          </div>
        )}
      </div>
    </div>
  );
}
