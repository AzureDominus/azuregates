import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Device, type DeviceAction, type DeviceStatus } from '../lib/api';
import { StatusLight, ActionButton } from './ui';

interface DeviceCardProps {
  device: Device;
  activeStatus?: DeviceStatus;
  showStatusMessages?: boolean;
  maintenanceMode?: boolean;
  gpioHealthy?: boolean;
}

export function DeviceCard({ device, activeStatus, showStatusMessages = true, maintenanceMode = false, gpioHealthy = true }: DeviceCardProps) {
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
    mutationFn: ({ deviceId, action }: { deviceId: string; action: DeviceAction }) =>
      api.sendCommand(deviceId, action),
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

  const handleAction = (action: DeviceAction) => {
    // Allow stop to be sent even when another action is in progress
    if (commandMutation.isPending && action !== 'stop') return;
    commandMutation.mutate({ deviceId: device.id, action });
  };

  const isDisabled = !device.enabled;
  const capabilities = device.capabilities as DeviceAction[];
  const isActive = !!activeStatus && remainingMs > 0;
  const isUtility = device.deviceType === 'utility';
  
  // Calculate progress (100% = just started, 0% = done)
  const totalDuration = activeStatus ? activeStatus.estimatedEndTime - activeStatus.startTime : 0;
  const progress = isActive && totalDuration > 0 ? (remainingMs / totalDuration) * 100 : 0;

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
                variant={!gpioHealthy ? 'danger' : isActive ? 'info' : maintenanceMode ? 'maintenance' : isDisabled ? 'neutral' : 'success'}
                pulse={isActive || !gpioHealthy}
                size="md"
              />
              <h4 className="font-display font-bold text-xl tracking-wide text-white">{device.name}</h4>
              {isUtility && (
                <span className="text-[9px] font-mono bg-purple-900/30 text-purple-400 border border-purple-700/50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                  Utility
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider pl-5">
              {device.driverType} :: {device.areaId}
            </p>
          </div>
          
          {/* Timer in top right when active */}
          {isActive && (
            <div className="flex flex-col items-end">
              <span className="text-2xl font-mono font-bold text-secondary tabular-nums">
                {(remainingMs / 1000).toFixed(1)}s
              </span>
              <span className="text-[10px] font-mono text-secondary/70 uppercase tracking-wider">
                remaining
              </span>
            </div>
          )}
          
          {isDisabled && !isActive && (
            <span className="text-[10px] font-mono bg-yellow-900/30 text-yellow-500 border border-yellow-700/50 px-2 py-1 rounded uppercase tracking-wider">
              Offline
            </span>
          )}
        </div>

        {/* Controls Grid */}
        <div className="grid grid-cols-2 gap-3">
          {capabilities.filter((a): a is Exclude<DeviceAction, 'state'> => a !== 'state').map((action) => {
            const isStop = action === 'stop';
            const isThisActionActive = isActive && activeStatus?.action === action;
            // Disable non-stop buttons while an action is in progress (either mutation pending or active status)
            const shouldDisable = isDisabled || (!isStop && (commandMutation.isPending || isActive));

            return (
              <ActionButton
                key={action}
                action={action}
                onClick={() => handleAction(action)}
                disabled={shouldDisable}
                loading={commandMutation.isPending && commandMutation.variables?.action === action && !isActive}
                fullWidth={isStop}
                isActive={isThisActionActive}
                progress={isThisActionActive ? progress : undefined}
              />
            );
          })}
        </div>

        {/* Feedback Message - always show errors, respect setting for success */}
        {lastResult && (showStatusMessages || !lastResult.success) && (
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
