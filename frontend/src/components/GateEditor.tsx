import { useState, useEffect } from 'react';
import { X, Save, AlertTriangle } from 'lucide-react';
import type { ConfigGate } from '../lib/api';

interface GateEditorProps {
  gate: ConfigGate;
  onSave: (gate: ConfigGate) => void;
  onClose: () => void;
}

export function GateEditor({ gate, onSave, onClose }: GateEditorProps) {
  const [editedGate, setEditedGate] = useState<ConfigGate>(gate);
  const [errors, setErrors] = useState<Record<string, string>>({});

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
      const config = editedGate.config;
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

  const updateConfig = (key: string, value: number | boolean | undefined) => {
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold">Edit Gate: {gate.name}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Basic Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Basic Information</h3>
            
            <div>
              <label className="block text-sm text-gray-300 mb-1">Name</label>
              <input
                type="text"
                value={editedGate.name}
                onChange={(e) => setEditedGate({ ...editedGate, name: e.target.value })}
                className={`w-full px-3 py-2 bg-gray-900 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  errors.name ? 'border-red-500' : 'border-gray-700'
                }`}
              />
              {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
            </div>

            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editedGate.enabled !== false}
                  onChange={(e) => setEditedGate({ ...editedGate, enabled: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-300">Enabled</span>
              </label>
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-1">Driver</label>
              <div className="px-3 py-2 bg-gray-900/50 border border-gray-700 rounded-lg text-gray-400 text-sm">
                {editedGate.driver} <span className="text-gray-500">(read-only)</span>
              </div>
            </div>
          </div>

          {/* Capabilities */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Capabilities</h3>
            <div className="flex flex-wrap gap-2">
              {['open', 'close', 'stop', 'toggle'].map((cap) => (
                <button
                  key={cap}
                  onClick={() => toggleCapability(cap)}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                    editedGate.capabilities?.includes(cap as any)
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  {cap}
                </button>
              ))}
            </div>
          </div>

          {/* GPIO Configuration */}
          {isGpio && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">GPIO Configuration</h3>
              
              {errors.pins && (
                <div className="flex items-center gap-2 p-2 bg-red-900/30 border border-red-700 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <p className="text-sm text-red-400">{errors.pins}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Open Pin</label>
                  <input
                    type="number"
                    min="0"
                    max="40"
                    value={editedGate.config.openPin ?? ''}
                    onChange={(e) => updateConfig('openPin', e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="GPIO #"
                    className={`w-full px-3 py-2 bg-gray-900 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.openPin ? 'border-red-500' : 'border-gray-700'
                    }`}
                  />
                  {errors.openPin && <p className="text-xs text-red-400 mt-1">{errors.openPin}</p>}
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Close Pin</label>
                  <input
                    type="number"
                    min="0"
                    max="40"
                    value={editedGate.config.closePin ?? ''}
                    onChange={(e) => updateConfig('closePin', e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="GPIO #"
                    className={`w-full px-3 py-2 bg-gray-900 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.closePin ? 'border-red-500' : 'border-gray-700'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Stop Pin</label>
                  <input
                    type="number"
                    min="0"
                    max="40"
                    value={editedGate.config.stopPin ?? ''}
                    onChange={(e) => updateConfig('stopPin', e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="GPIO #"
                    className={`w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Toggle Pin</label>
                  <input
                    type="number"
                    min="0"
                    max="40"
                    value={editedGate.config.togglePin ?? ''}
                    onChange={(e) => updateConfig('togglePin', e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="GPIO #"
                    className={`w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Pulse Duration (ms)</label>
                  <input
                    type="number"
                    min="50"
                    max="5000"
                    value={editedGate.config.pulseDurationMs ?? 500}
                    onChange={(e) => updateConfig('pulseDurationMs', parseInt(e.target.value) || 500)}
                    className={`w-full px-3 py-2 bg-gray-900 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.pulseDurationMs ? 'border-red-500' : 'border-gray-700'
                    }`}
                  />
                  {errors.pulseDurationMs && <p className="text-xs text-red-400 mt-1">{errors.pulseDurationMs}</p>}
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Hold Duration (ms)</label>
                  <input
                    type="number"
                    min="1000"
                    max="120000"
                    value={editedGate.config.holdDurationMs ?? ''}
                    onChange={(e) => updateConfig('holdDurationMs', e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="Optional"
                    className={`w-full px-3 py-2 bg-gray-900 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.holdDurationMs ? 'border-red-500' : 'border-gray-700'
                    }`}
                  />
                  {errors.holdDurationMs && <p className="text-xs text-red-400 mt-1">{errors.holdDurationMs}</p>}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editedGate.config.activeHigh === true}
                    onChange={(e) => updateConfig('activeHigh', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-300">Active High</span>
                </label>
                <span className="text-xs text-gray-500">
                  (unchecked = LOW activates relay)
                </span>
              </div>
            </div>
          )}

          {/* Webhook Configuration */}
          {editedGate.driver === 'webhook' && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">Webhook Configuration</h3>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Webhook URL</label>
                <input
                  type="url"
                  value={(editedGate.config.url as string) ?? ''}
                  onChange={(e) => updateConfig('url', e.target.value as any)}
                  placeholder="https://example.com/webhook"
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 hover:bg-green-500 rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
