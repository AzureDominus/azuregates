import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Save,
  History,
  Undo2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Code,
  LayoutGrid,
  Settings2,
  Pencil,
  Power,
  PowerOff,
} from 'lucide-react';
import { stringify, parse } from 'yaml';
import Editor from '@monaco-editor/react';
import { api, GatesConfig, ConfigGate } from '../lib/api';
import { GateEditor } from '../components/GateEditor';

type EditorMode = 'visual' | 'yaml';

export function Settings() {
  const queryClient = useQueryClient();
  const [yamlContent, setYamlContent] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [originalYaml, setOriginalYaml] = useState('');
  const [editorMode, setEditorMode] = useState<EditorMode>('visual');
  const [editingGate, setEditingGate] = useState<{ locationIdx: number; areaIdx: number; gateIdx: number; gate: ConfigGate } | null>(null);
  const [localConfig, setLocalConfig] = useState<GatesConfig | null>(null);
  const editorRef = useRef<any>(null);

  // Fetch current config
  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  });

  // Fetch health
  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['health'],
    queryFn: api.getHealthReady,
    refetchInterval: 10000,
  });

  // Fetch config history
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['config-history'],
    queryFn: api.getConfigHistory,
    enabled: showHistory,
  });

  // Update content when config loads
  useEffect(() => {
    if (config) {
      const yaml = stringify(config, { indent: 2, lineWidth: 120 });
      setYamlContent(yaml);
      setOriginalYaml(yaml);
      setLocalConfig(structuredClone(config));
      setHasChanges(false);
      setParseError(null);
    }
  }, [config]);

  // Sync YAML content to localConfig when switching to visual mode
  useEffect(() => {
    if (editorMode === 'visual' && yamlContent) {
      try {
        const parsed = parse(yamlContent) as GatesConfig;
        setLocalConfig(structuredClone(parsed));
        setParseError(null);
      } catch {
        // Don't update localConfig if YAML is invalid
      }
    }
  }, [editorMode]);

  // Reload config mutation
  const reloadMutation = useMutation({
    mutationFn: api.reloadConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['gates'] });
    },
  });

  // Save config mutation
  const saveMutation = useMutation({
    mutationFn: (newConfig: GatesConfig) => api.updateConfig(newConfig),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['config-history'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['gates'] });
      setHasChanges(false);
      // Update original to match saved
      const yaml = stringify(result.config, { indent: 2, lineWidth: 120 });
      setOriginalYaml(yaml);
    },
  });

  // Rollback config mutation
  const rollbackMutation = useMutation({
    mutationFn: (filename: string) => api.rollbackConfig(filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['config-history'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['gates'] });
      setShowHistory(false);
    },
  });

  // Handle YAML content change (from Monaco)
  const handleYamlChange = (value: string | undefined) => {
    if (value === undefined) return;
    setYamlContent(value);
    setHasChanges(value !== originalYaml);

    // Validate YAML on change
    try {
      parse(value);
      setParseError(null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid YAML');
    }
  };

  // Handle visual config change
  const handleVisualChange = (newConfig: GatesConfig) => {
    setLocalConfig(newConfig);
    const yaml = stringify(newConfig, { indent: 2, lineWidth: 120 });
    setYamlContent(yaml);
    setHasChanges(yaml !== originalYaml);
    setParseError(null);
  };

  // Handle gate edit from visual editor
  const handleGateEdit = (locationIdx: number, areaIdx: number, gateIdx: number, gate: ConfigGate) => {
    setEditingGate({ locationIdx, areaIdx, gateIdx, gate });
  };

  // Handle gate save from modal
  const handleGateSave = (updatedGate: ConfigGate) => {
    if (!localConfig || !editingGate) return;

    const newConfig = structuredClone(localConfig);
    const location = newConfig.locations[editingGate.locationIdx];
    const area = location.areas?.[editingGate.areaIdx];
    if (area?.gates) {
      area.gates[editingGate.gateIdx] = updatedGate;
    }

    handleVisualChange(newConfig);
    setEditingGate(null);
  };

  // Handle settings change
  const handleSettingsChange = (key: keyof GatesConfig['settings'], value: any) => {
    if (!localConfig) return;
    const newConfig = structuredClone(localConfig);
    (newConfig.settings as any)[key] = value;
    handleVisualChange(newConfig);
  };

  // Handle save
  const handleSave = () => {
    try {
      const parsed = editorMode === 'yaml' 
        ? parse(yamlContent) as GatesConfig 
        : localConfig;
      if (parsed) {
        saveMutation.mutate(parsed);
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse YAML');
    }
  };

  // Handle discard changes
  const handleDiscard = () => {
    setYamlContent(originalYaml);
    if (config) {
      setLocalConfig(structuredClone(config));
    }
    setHasChanges(false);
    setParseError(null);
  };

  // Format timestamp from backup filename
  const formatBackupTime = (filename: string) => {
    const match = filename.match(/gates-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day, hour, min, sec] = match;
      return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
    }
    return filename;
  };

  // Monaco editor options
  const monacoOptions = {
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on' as const,
    scrollBeyondLastLine: false,
    wordWrap: 'on' as const,
    wrappingStrategy: 'advanced' as const,
    automaticLayout: true,
    tabSize: 2,
    insertSpaces: true,
    folding: true,
    foldingStrategy: 'indentation' as const,
  };

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* System Health */}
      <section className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h2 className="text-lg font-semibold mb-4">System Health</h2>

        {healthLoading ? (
          <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
        ) : health ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {health.status === 'ok' ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={health.status === 'ok' ? 'text-green-400' : 'text-red-400'}>
                {health.status === 'ok' ? 'All systems operational' : 'Some issues detected'}
              </span>
            </div>

            {health.checks && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(health.checks).map(([name, check]) => (
                  <div key={name} className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        check.status === 'ok'
                          ? 'bg-green-400'
                          : check.status === 'warning'
                          ? 'bg-yellow-400'
                          : 'bg-red-400'
                      }`}
                    />
                    <span className="text-gray-300">{name}</span>
                    {check.latencyMs && <span className="text-gray-500">{check.latencyMs}ms</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* Configuration Editor */}
      <section className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Configuration Editor</h2>
          <div className="flex items-center gap-2">
            {/* Editor Mode Toggle */}
            <div className="flex items-center bg-gray-900 rounded-lg p-1">
              <button
                onClick={() => setEditorMode('visual')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                  editorMode === 'visual'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
                Visual
              </button>
              <button
                onClick={() => setEditorMode('yaml')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                  editorMode === 'yaml'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Code className="w-4 h-4" />
                YAML
              </button>
            </div>

            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              <History className="w-4 h-4" />
              History
              {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            <button
              onClick={() => reloadMutation.mutate()}
              disabled={reloadMutation.isPending}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            >
              {reloadMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Reload from file
            </button>
          </div>
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-700">
            <h3 className="text-sm font-medium text-gray-300 mb-2">Configuration History</h3>
            {historyLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            ) : history && history.length > 0 ? (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {history.map((filename) => (
                  <div
                    key={filename}
                    className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-800"
                  >
                    <span className="text-sm text-gray-400">{formatBackupTime(filename)}</span>
                    <button
                      onClick={() => rollbackMutation.mutate(filename)}
                      disabled={rollbackMutation.isPending}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 rounded transition-colors disabled:opacity-50"
                    >
                      <Undo2 className="w-3 h-3" />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No backup history available</p>
            )}
            {rollbackMutation.isError && (
              <p className="mt-2 text-sm text-red-400">
                Restore failed: {rollbackMutation.error instanceof Error ? rollbackMutation.error.message : 'Unknown error'}
              </p>
            )}
          </div>
        )}

        {configLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          </div>
        ) : (
          <>
            {/* Editor Info */}
            <p className="text-gray-400 text-sm mb-3">
              {editorMode === 'visual' 
                ? 'Click on a gate to edit its settings. Changes are validated before saving.'
                : 'Edit the YAML configuration directly. Changes are validated against the schema before saving.'}
              <span className="text-yellow-400 ml-2">Backups are automatically created on save.</span>
            </p>

            {/* Parse Error */}
            {parseError && (
              <div className="mb-3 p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-400">YAML Parse Error</p>
                  <p className="text-sm text-red-300 font-mono">{parseError}</p>
                </div>
              </div>
            )}

            {/* Save Error */}
            {saveMutation.isError && (
              <div className="mb-3 p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-400">Save Failed</p>
                  <p className="text-sm text-red-300">
                    {saveMutation.error instanceof Error ? saveMutation.error.message : 'Unknown error'}
                  </p>
                </div>
              </div>
            )}

            {/* Visual Editor */}
            {editorMode === 'visual' && localConfig && (
              <div className="space-y-4">
                {/* Global Settings */}
                <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center gap-2 mb-3">
                    <Settings2 className="w-5 h-5 text-gray-400" />
                    <h3 className="font-medium">Global Settings</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Cooldown (ms)</label>
                      <input
                        type="number"
                        min="0"
                        max="60000"
                        value={localConfig.settings.defaultCooldownMs}
                        onChange={(e) => handleSettingsChange('defaultCooldownMs', parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Log Level</label>
                      <select
                        value={localConfig.settings.logLevel}
                        onChange={(e) => handleSettingsChange('logLevel', e.target.value)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {['fatal', 'error', 'warn', 'info', 'debug', 'trace'].map((level) => (
                          <option key={level} value={level}>{level}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={localConfig.settings.maintenanceMode ?? false}
                          onChange={(e) => handleSettingsChange('maintenanceMode', e.target.checked)}
                          className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-orange-500 focus:ring-orange-500"
                        />
                        <span className="text-sm text-gray-300">Maintenance Mode</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Locations/Areas/Gates */}
                {localConfig.locations.map((location, locationIdx) => (
                  <div key={location.id} className="bg-gray-900 rounded-lg border border-gray-700 overflow-hidden">
                    <div className="p-3 bg-gray-800 border-b border-gray-700">
                      <h3 className="font-medium">{location.name}</h3>
                      <p className="text-xs text-gray-500">{location.id}</p>
                    </div>
                    <div className="p-4 space-y-4">
                      {location.areas?.map((area, areaIdx) => (
                        <div key={area.id}>
                          <h4 className="text-sm font-medium text-gray-400 mb-2">{area.name}</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {area.gates?.map((gate, gateIdx) => (
                              <div
                                key={gate.id}
                                className={`p-3 rounded-lg border cursor-pointer transition-colors hover:border-blue-500 ${
                                  gate.enabled === false
                                    ? 'bg-gray-800/50 border-gray-700 opacity-60'
                                    : 'bg-gray-800 border-gray-700'
                                }`}
                                onClick={() => handleGateEdit(locationIdx, areaIdx, gateIdx, gate)}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <span className="font-medium">{gate.name}</span>
                                  <div className="flex items-center gap-2">
                                    {gate.enabled === false ? (
                                      <PowerOff className="w-4 h-4 text-gray-500" />
                                    ) : (
                                      <Power className="w-4 h-4 text-green-400" />
                                    )}
                                    <Pencil className="w-4 h-4 text-gray-500" />
                                  </div>
                                </div>
                                <div className="text-xs text-gray-500 space-y-1">
                                  <div>Driver: {gate.driver}</div>
                                  <div>Capabilities: {gate.capabilities.join(', ')}</div>
                                  {gate.driver === 'gpio' && (
                                    <div className="text-gray-600">
                                      Pins: {[
                                        gate.config.openPin !== undefined && `open:${gate.config.openPin}`,
                                        gate.config.closePin !== undefined && `close:${gate.config.closePin}`,
                                        gate.config.togglePin !== undefined && `toggle:${gate.config.togglePin}`,
                                      ].filter(Boolean).join(', ')}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* YAML Editor */}
            {editorMode === 'yaml' && (
              <div className={`relative rounded-lg overflow-hidden border ${
                parseError ? 'border-red-500' : hasChanges ? 'border-yellow-500' : 'border-gray-700'
              }`}>
                <Editor
                  height="500px"
                  defaultLanguage="yaml"
                  value={yamlContent}
                  onChange={handleYamlChange}
                  theme="vs-dark"
                  options={monacoOptions}
                  onMount={(editor) => {
                    editorRef.current = editor;
                  }}
                />
                {hasChanges && (
                  <div className="absolute top-2 right-2 px-2 py-1 bg-yellow-600/80 text-yellow-100 text-xs rounded z-10">
                    Unsaved changes
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={handleSave}
                disabled={!hasChanges || !!parseError || saveMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save Configuration
              </button>

              {hasChanges && (
                <button
                  onClick={handleDiscard}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg transition-colors"
                >
                  <Undo2 className="w-4 h-4" />
                  Discard Changes
                </button>
              )}

              {saveMutation.isSuccess && !hasChanges && (
                <span className="flex items-center gap-1 text-green-400 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  Configuration saved and applied!
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {/* Config Schema Reference */}
      <section className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Configuration Reference</h2>
        <div className="text-sm text-gray-400 space-y-4">
          <div>
            <h3 className="font-medium text-gray-300 mb-1">Structure</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><code className="bg-gray-700 px-1 rounded">version</code> - Config version (currently 1)</li>
              <li><code className="bg-gray-700 px-1 rounded">settings</code> - Global settings (cooldown, log level, maintenance mode)</li>
              <li><code className="bg-gray-700 px-1 rounded">locations</code> - Array of locations containing areas and gates</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-300 mb-1">Gate Drivers</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><code className="bg-gray-700 px-1 rounded">gpio</code> - GPIO driver for Raspberry Pi control</li>
              <li><code className="bg-gray-700 px-1 rounded">webhook</code> - HTTP webhook driver for remote control</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-300 mb-1">GPIO Pin Configuration</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><code className="bg-gray-700 px-1 rounded">openPin</code>, <code className="bg-gray-700 px-1 rounded">closePin</code> - For gates with separate open/close relays</li>
              <li><code className="bg-gray-700 px-1 rounded">togglePin</code> - For single-button gates or lights</li>
              <li><code className="bg-gray-700 px-1 rounded">pulseDurationMs</code> - How long to pulse the relay (50-5000ms)</li>
              <li><code className="bg-gray-700 px-1 rounded">holdDurationMs</code> - For gates that need to hold the button (1000-120000ms)</li>
              <li><code className="bg-gray-700 px-1 rounded">activeHigh</code> - false = LOW activates relay (most common)</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Gate Editor Modal */}
      {editingGate && (
        <GateEditor
          gate={editingGate.gate}
          onSave={handleGateSave}
          onClose={() => setEditingGate(null)}
        />
      )}
    </div>
  );
}
