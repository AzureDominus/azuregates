import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import type { ConfigGate } from '../lib/api';
import { Button, ToggleButton, Checkbox, Modal } from './ui';

// GPIO config type for type safety
interface GpioConfig {
  openPin?: number;
  closePin?: number;
  stopPin?: number;
  togglePin?: number;
  pulseDurationMs?: number;
  holdDurationMs?: number;
  activeHigh?: boolean;
  url?: string;
}

interface GateEditorProps {
  gate: ConfigGate;
  onSave: (gate: ConfigGate) => void;
  onClose: () => void;
}

export function GateEditor({ gate, onSave, onClose }: GateEditorProps) {
  const [editedGate, setEditedGate] = useState<ConfigGate>(gate);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Helper to get typed config
  const getConfig = (): GpioConfig => editedGate.config as GpioConfig;

  useEffect(() => {
    setEditedGate(gate);
    setErrors({});
  }, [gate]);

  const validateGate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!editedGate.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (editedGate.driver === 'gpio') {
      const config = getConfig();
      const hasOpenClose = config.openPin !== undefined || config.closePin !== undefined;
      const hasToggle = config.togglePin !== undefined;
      
      if (!hasOpenClose && !hasToggle) {
        newErrors.pins = 'At least one pin must be configured';
      }

      // Validate pin ranges
      const pinFields = ['openPin', 'closePin', 'stopPin', 'togglePin'] as const;
      for (const field of pinFields) {
        const value = config[field];
        if (value !== undefined && (value < 0 || value > 40)) {
          newErrors[field] = `${field} must be between 0 and 40`;
        }
      }

      // Validate durations
      if (config.pulseDurationMs !== undefined) {
        if (config.pulseDurationMs < 50 || config.pulseDurationMs > 5000) {
          newErrors.pulseDurationMs = 'Pulse duration must be between 50ms and 5000ms';
        }
      }
      if (config.holdDurationMs !== undefined) {
        if (config.holdDurationMs < 1000 || config.holdDurationMs > 120000) {
          newErrors.holdDurationMs = 'Hold duration must be between 1s and 120s';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validateGate()) {
      onSave(editedGate);
    }
  };

  const updateConfig = (key: string, value: number | boolean | string | undefined) => {
    setEditedGate({
      ...editedGate,
      config: {
        ...editedGate.config,
        [key]: value,
      },
    });
  };

  const toggleCapability = (cap: string) => {
    const current = editedGate.capabilities || [];
    const newCaps = current.includes(cap as any)
      ? current.filter((c) => c !== cap)
      : [...current, cap as 'open' | 'close' | 'stop' | 'toggle' | 'state'];
    setEditedGate({ ...editedGate, capabilities: newCaps });
  };

  const isGpio = editedGate.driver === 'gpio';

  return (
    <Modal onClose={onClose} title={`Edit Gate: ${gate.name}`} className="sm:max-w-lg">
      {/* Body */}
      <div className="space-y-5">
        {/* Basic Info */}
        <div className="space-y-3">
          <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider">Basic Information</h3>
          
          <div>
            <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-1.5">Name</label>
            <input
              type="text"
              value={editedGate.name}
              onChange={(e) => setEditedGate({ ...editedGate, name: e.target.value })}
              className={`w-full px-3 py-2 bg-surfaceHighlight border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:ring-1 ${
                errors.name ? 'border-danger/50 focus:ring-danger/50' : 'border-white/10 focus:border-secondary/50 focus:ring-secondary/50'
              }`}
            />
            {errors.name && <p className="text-xs text-danger mt-1">{errors.name}</p>}
          </div>

          <Checkbox
            checked={editedGate.enabled !== false}
            onChange={(e) => setEditedGate({ ...editedGate, enabled: e.target.checked })}
            label="Enabled"
          />

          <div>
            <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-1.5">Driver</label>
            <div className="px-3 py-2 bg-surfaceHighlight/50 border border-white/5 rounded-lg text-gray-500 text-sm font-mono">
              {editedGate.driver} <span className="text-gray-600">(read-only)</span>
            </div>
          </div>
        </div>

        {/* Capabilities */}
        <div className="space-y-3">
          <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider">Capabilities</h3>
          <div className="flex flex-wrap gap-2">
            {['open', 'close', 'stop', 'toggle'].map((cap) => (
              <ToggleButton
                key={cap}
                active={editedGate.capabilities?.includes(cap as any) ?? false}
                onClick={() => toggleCapability(cap)}
              >
                {cap}
              </ToggleButton>
            ))}
          </div>
        </div>

        {/* GPIO Configuration */}
        {isGpio && (
          <div className="space-y-3">
            <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider">GPIO Configuration</h3>
            
            {errors.pins && (
              <div className="flex items-center gap-2 p-2.5 bg-danger/10 border border-danger/30 rounded-lg">
                <Icon icon="ph:warning-fill" className="w-4 h-4 text-danger flex-shrink-0" />
                <p className="text-sm text-danger">{errors.pins}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-1.5">Open Pin</label>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min="0"
                  max="40"
                  value={getConfig().openPin ?? ''}
                  onChange={(e) => updateConfig('openPin', e.target.value ? parseInt(e.target.value) : undefined)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  placeholder="GPIO #"
                  className={`w-full px-3 py-2 bg-surfaceHighlight border rounded-lg text-white placeholder-gray-600 font-mono focus:outline-none focus:ring-1 ${
                    errors.openPin ? 'border-danger/50 focus:ring-danger/50' : 'border-white/10 focus:border-secondary/50 focus:ring-secondary/50'
                  }`}
                />
                {errors.openPin && <p className="text-xs text-danger mt-1">{errors.openPin}</p>}
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-1.5">Close Pin</label>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min="0"
                  max="40"
                  value={getConfig().closePin ?? ''}
                  onChange={(e) => updateConfig('closePin', e.target.value ? parseInt(e.target.value) : undefined)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  placeholder="GPIO #"
                  className={`w-full px-3 py-2 bg-surfaceHighlight border rounded-lg text-white placeholder-gray-600 font-mono focus:outline-none focus:ring-1 ${
                    errors.closePin ? 'border-danger/50 focus:ring-danger/50' : 'border-white/10 focus:border-secondary/50 focus:ring-secondary/50'
                  }`}
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-1.5">Stop Pin</label>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min="0"
                  max="40"
                  value={getConfig().stopPin ?? ''}
                  onChange={(e) => updateConfig('stopPin', e.target.value ? parseInt(e.target.value) : undefined)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  placeholder="GPIO #"
                  className="w-full px-3 py-2 bg-surfaceHighlight border border-white/10 rounded-lg text-white placeholder-gray-600 font-mono focus:outline-none focus:ring-1 focus:border-secondary/50 focus:ring-secondary/50"
                />
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-1.5">Toggle Pin</label>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min="0"
                  max="40"
                  value={getConfig().togglePin ?? ''}
                  onChange={(e) => updateConfig('togglePin', e.target.value ? parseInt(e.target.value) : undefined)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  placeholder="GPIO #"
                  className="w-full px-3 py-2 bg-surfaceHighlight border border-white/10 rounded-lg text-white placeholder-gray-600 font-mono focus:outline-none focus:ring-1 focus:border-secondary/50 focus:ring-secondary/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-1.5">Pulse Duration (ms)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min="50"
                  max="5000"
                  step="50"
                  value={getConfig().pulseDurationMs ?? 500}
                  onChange={(e) => updateConfig('pulseDurationMs', parseInt(e.target.value) || 500)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  className={`w-full px-3 py-2 bg-surfaceHighlight border rounded-lg text-white font-mono focus:outline-none focus:ring-1 ${
                    errors.pulseDurationMs ? 'border-danger/50 focus:ring-danger/50' : 'border-white/10 focus:border-secondary/50 focus:ring-secondary/50'
                  }`}
                />
                {errors.pulseDurationMs && <p className="text-xs text-danger mt-1">{errors.pulseDurationMs}</p>}
              </div>
              <div>
                <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-1.5">Hold Duration (ms)</label>
                <input
                  type="number"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  min="1000"
                  max="120000"
                  step="1000"
                  value={getConfig().holdDurationMs ?? ''}
                  onChange={(e) => updateConfig('holdDurationMs', e.target.value ? parseInt(e.target.value) : undefined)}
                  onKeyDown={(e) => {
                    if (['e', 'E', '+', '-', '.'].includes(e.key)) {
                      e.preventDefault();
                    }
                  }}
                  placeholder="Optional"
                  className={`w-full px-3 py-2 bg-surfaceHighlight border rounded-lg text-white placeholder-gray-600 font-mono focus:outline-none focus:ring-1 ${
                    errors.holdDurationMs ? 'border-danger/50 focus:ring-danger/50' : 'border-white/10 focus:border-secondary/50 focus:ring-secondary/50'
                  }`}
                />
                {errors.holdDurationMs && <p className="text-xs text-danger mt-1">{errors.holdDurationMs}</p>}
              </div>
            </div>

            <Checkbox
              checked={getConfig().activeHigh === true}
              onChange={(e) => updateConfig('activeHigh', e.target.checked)}
              label={
                <>
                  Active High
                  <span className="text-xs font-mono text-gray-600 ml-2">
                    (unchecked = LOW activates relay)
                  </span>
                </>
              }
            />
          </div>
        )}

        {/* Webhook Configuration */}
        {editedGate.driver === 'webhook' && (
          <div className="space-y-3">
            <h3 className="text-xs font-mono text-gray-500 uppercase tracking-wider">Webhook Configuration</h3>
            <div>
              <label className="block text-xs font-mono text-gray-500 uppercase tracking-wider mb-1.5">Webhook URL</label>
              <input
                type="url"
                value={getConfig().url ?? ''}
                onChange={(e) => updateConfig('url', e.target.value)}
                placeholder="https://example.com/webhook"
                className="w-full px-3 py-2 bg-surfaceHighlight border border-white/10 rounded-lg text-white placeholder-gray-600 font-mono focus:outline-none focus:ring-1 focus:border-secondary/50 focus:ring-secondary/50"
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          <Button onClick={handleSave} variant="success" icon="ph:floppy-disk-fill">
            Save Changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
