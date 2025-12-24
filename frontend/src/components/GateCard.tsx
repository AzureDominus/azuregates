import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, DoorClosed, StopCircle, ToggleLeft, Loader2, Power } from 'lucide-react';
import { api, type Gate, type GateAction } from '../lib/api';

interface GateCardProps {
  gate: Gate;
}

const actionIcons: Record<GateAction, typeof DoorOpen> = {
  open: DoorOpen,
  close: DoorClosed,
  stop: StopCircle,
  toggle: ToggleLeft,
  state: Power,
};

const actionColors: Record<GateAction, string> = {
  open: 'bg-green-600 hover:bg-green-500',
  close: 'bg-red-600 hover:bg-red-500',
  stop: 'bg-yellow-600 hover:bg-yellow-500',
  toggle: 'bg-blue-600 hover:bg-blue-500',
  state: 'bg-gray-600 hover:bg-gray-500',
};

export function GateCard({ gate }: GateCardProps) {
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<{ success: boolean; message?: string } | null>(null);

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

  return (
    <div
      className={`bg-gray-800 rounded-lg p-4 border ${
        isDisabled ? 'border-yellow-600 opacity-60' : 'border-gray-700'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold">{gate.name}</h4>
        {isDisabled && (
          <span className="text-xs bg-yellow-600 px-2 py-0.5 rounded">Disabled</span>
        )}
      </div>

      <div className="text-xs text-gray-400 mb-3">
        Driver: {gate.driverType} • Capabilities: {capabilities.join(', ')}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {capabilities
          .filter((action): action is GateAction => action !== 'state')
          .map((action) => {
            const Icon = actionIcons[action];
            // Stop button should remain enabled even when another action is in progress
            const isStopAction = action === 'stop';
            const isButtonDisabled = isDisabled || (commandMutation.isPending && !isStopAction);
            return (
              <button
                key={action}
                onClick={() => handleAction(action)}
                disabled={isButtonDisabled}
                className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${actionColors[action]}`}
              >
                {commandMutation.isPending && commandMutation.variables?.action === action ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
                {action.charAt(0).toUpperCase() + action.slice(1)}
              </button>
            );
          })}
      </div>

      {/* Result feedback */}
      {lastResult && (
        <div
          className={`mt-3 text-sm px-2 py-1 rounded ${
            lastResult.success ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
          }`}
        >
          {lastResult.success ? '✓ Success' : '✗ Failed'}: {lastResult.message}
        </div>
      )}
    </div>
  );
}
