import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import { stringify, parse } from 'yaml';
import Editor from '@monaco-editor/react';
import { api, GatesConfig, ConfigGate } from '../lib/api';
import { GateEditor } from '../components/GateEditor';
import { StatusLight, Button } from '../components/ui';

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
      <div>
        <h1 className="text-4xl font-display font-bold text-white tracking-tight mb-1">Settings</h1>
        <p className="text-gray-400 font-mono text-sm">System Configuration & Health</p>
      </div>

      {/* System Health - Streamlined Status Bar */}
      <section className="glass-panel rounded-xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-mono text-gray-400 uppercase tracking-wider">System Status</h2>
          </div>
          
          {healthLoading ? (
            <Icon icon="ph:spinner" className="w-5 h-5 animate-spin text-secondary" />
          ) : health ? (
            <div className="flex flex-wrap items-center gap-4 sm:gap-6">
              {/* Overall Status */}
              <div className="flex items-center gap-2">
                <StatusLight 
                  variant={health.status === 'ok' ? 'success' : 'danger'} 
                  pulse={health.status === 'ok'} 
                  size="md" 
                />
                <span className={`text-sm font-medium ${health.status === 'ok' ? 'text-success' : 'text-danger'}`}>
                  {health.status === 'ok' ? 'All Systems Go' : 'Issues Detected'}
                </span>
              </div>
              
              {/* Individual Checks - Only show database */}
              {health.checks && (
                <div className="flex items-center gap-4 border-l border-white/10 pl-4">
                  {Object.entries(health.checks)
                    .filter(([name]) => name.toLowerCase() === 'database')
                    .map(([name, check]) => (
                      <div key={name} className="flex items-center gap-2">
                        <StatusLight 
                          variant={check.status === 'ok' ? 'success' : check.status === 'warning' ? 'warning' : 'danger'} 
                          size="sm" 
                        />
                        <span className="text-xs font-mono text-gray-400 uppercase">{name}</span>
                        {check.latencyMs && (
                          <span className="text-xs font-mono text-gray-600">{check.latencyMs}ms</span>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </section>

      {/* Configuration Editor */}
      <section className="glass-panel rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h2 className="text-xl font-display font-semibold text-white flex items-center gap-3">
            <span className="text-secondary">///</span>
            Configuration Editor
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* Editor Mode Toggle */}
            <div className="flex items-center bg-surfaceHighlight rounded-lg p-1 border border-white/5">
              <button
                onClick={() => setEditorMode('visual')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono rounded-md transition-all cursor-pointer ${
                  editorMode === 'visual'
                    ? 'bg-secondary/20 text-secondary border border-secondary/30'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon icon="ph:squares-four-fill" className="w-4 h-4" />
                Visual
              </button>
              <button
                onClick={() => setEditorMode('yaml')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono rounded-md transition-all cursor-pointer ${
                  editorMode === 'yaml'
                    ? 'bg-secondary/20 text-secondary border border-secondary/30'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon icon="ph:code-bold" className="w-4 h-4" />
                YAML
              </button>
            </div>

            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono bg-surfaceHighlight hover:bg-white/10 border border-white/5 rounded-lg transition-all cursor-pointer"
            >
              <Icon icon="ph:clock-counter-clockwise-bold" className="w-4 h-4" />
              <span className="hidden sm:inline">History</span>
              <Icon icon={showHistory ? "ph:caret-up-bold" : "ph:caret-down-bold"} className="w-3 h-3" />
            </button>
            <button
              onClick={() => reloadMutation.mutate()}
              disabled={reloadMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono bg-surfaceHighlight hover:bg-white/10 border border-white/5 rounded-lg transition-all disabled:opacity-50 cursor-pointer"
            >
              {reloadMutation.isPending ? (
                <Icon icon="ph:spinner" className="w-4 h-4 animate-spin" />
              ) : (
                <Icon icon="ph:arrows-clockwise-bold" className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Reload</span>
            </button>
          </div>
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="mb-4 p-4 bg-surfaceHighlight/50 rounded-lg border border-white/5">
            <h3 className="text-sm font-mono text-gray-400 mb-3 uppercase tracking-wider">Configuration History</h3>
            {historyLoading ? (
              <Icon icon="ph:spinner" className="w-4 h-4 animate-spin text-secondary" />
            ) : history && history.length > 0 ? (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {history.map((filename) => (
                  <div
                    key={filename}
                    className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <span className="text-sm font-mono text-gray-500">{formatBackupTime(filename)}</span>
                    <button
                      onClick={() => rollbackMutation.mutate(filename)}
                      disabled={rollbackMutation.isPending}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 rounded-lg transition-all disabled:opacity-50 cursor-pointer"
                    >
                      <Icon icon="ph:arrow-counter-clockwise-bold" className="w-3 h-3" />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-mono text-gray-600">No backup history available</p>
            )}
            {rollbackMutation.isError && (
              <p className="mt-2 text-sm font-mono text-danger">
                Restore failed: {rollbackMutation.error instanceof Error ? rollbackMutation.error.message : 'Unknown error'}
              </p>
            )}
          </div>
        )}

        {configLoading ? (
          <div className="flex items-center justify-center py-12">
            <Icon icon="ph:spinner" className="w-8 h-8 animate-spin text-secondary" />
          </div>
        ) : (
          <>
            {/* Editor Info */}
            <p className="text-gray-500 font-mono text-sm mb-4">
              {editorMode === 'visual' 
                ? 'Click on a gate to edit its settings. Changes are validated before saving.'
                : 'Edit the YAML configuration directly. Changes are validated against the schema before saving.'}
              <span className="text-primary ml-2">Backups are automatically created on save.</span>
            </p>

            {/* Parse Error */}
            {parseError && (
              <div className="mb-4 p-4 bg-danger/10 border border-danger/30 rounded-xl flex items-start gap-3">
                <Icon icon="ph:warning-fill" className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-display font-medium text-danger">YAML Parse Error</p>
                  <p className="text-sm text-danger/70 font-mono">{parseError}</p>
                </div>
              </div>
            )}

            {/* Save Error */}
            {saveMutation.isError && (
              <div className="mb-4 p-4 bg-danger/10 border border-danger/30 rounded-xl flex items-start gap-3">
                <Icon icon="ph:x-circle-fill" className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-display font-medium text-danger">Save Failed</p>
                  <p className="text-sm text-danger/70 font-mono">
                    {saveMutation.error instanceof Error ? saveMutation.error.message : 'Unknown error'}
                  </p>
                </div>
              </div>
            )}

            {/* Visual Editor */}
            {editorMode === 'visual' && localConfig && (
              <div className="space-y-6">
                {/* Global Settings */}
                <div className="bg-surfaceHighlight/50 rounded-xl p-4 border border-white/5">
                  <div className="flex items-center gap-2 mb-4">
                    <Icon icon="ph:sliders-fill" className="w-5 h-5 text-secondary" />
                    <h3 className="font-display font-medium text-white">Global Settings</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                    <div>
                      <label className="block text-xs font-mono text-gray-500 mb-1.5 uppercase tracking-wider">Cooldown (ms)</label>
                      <input
                        type="number"
                        min="0"
                        max="60000"
                        value={localConfig.settings.defaultCooldownMs}
                        onChange={(e) => handleSettingsChange('defaultCooldownMs', parseInt(e.target.value) || 0)}
                        className="w-full px-3 py-2.5 bg-surface border border-white/10 rounded-lg focus:outline-none focus:border-secondary/50 transition-colors text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-mono text-gray-500 mb-1.5 uppercase tracking-wider">Log Level</label>
                      <select
                        value={localConfig.settings.logLevel}
                        onChange={(e) => handleSettingsChange('logLevel', e.target.value)}
                        className="w-full px-3 py-2.5 bg-surface border border-white/10 rounded-lg focus:outline-none focus:border-secondary/50 transition-colors text-white appearance-none cursor-pointer uppercase"
                        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\'%3E%3Cpath fill=\'%236b7280\' d=\'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                      >
                        {['fatal', 'error', 'warn', 'info', 'debug', 'trace'].map((level) => (
                          <option key={level} value={level} className="uppercase">{level.toUpperCase()}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center h-[42px]">
                      <label className="flex items-center gap-3 cursor-pointer group">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={localConfig.settings.maintenanceMode ?? false}
                            onChange={(e) => handleSettingsChange('maintenanceMode', e.target.checked)}
                            className="peer sr-only"
                          />
                          <div className="w-5 h-5 rounded bg-surface border border-white/20 transition-all group-hover:border-white/30 peer-checked:bg-primary/20 peer-checked:border-primary/50" />
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 transition-opacity text-primary">
                            <Icon icon="ph:check-bold" width={14} height={14} />
                          </div>
                        </div>
                        <span className="text-sm font-mono text-gray-300 group-hover:text-white transition-colors">Maintenance Mode</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Locations/Areas/Gates */}
                {localConfig.locations.map((location, locationIdx) => (
                  <div key={location.id} className="bg-surfaceHighlight/50 rounded-xl border border-white/5 overflow-hidden">
                    <div className="p-4 bg-surface/50 border-b border-white/5">
                      <h3 className="font-display font-medium text-white">{location.name}</h3>
                      <p className="text-xs font-mono text-gray-600">{location.id}</p>
                    </div>
                    <div className="p-4 space-y-6">
                      {location.areas?.map((area, areaIdx) => (
                        <div key={area.id}>
                          <h4 className="text-sm font-display font-medium text-gray-400 mb-3">{area.name}</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {area.gates?.map((gate, gateIdx) => (
                              <div
                                key={gate.id}
                                className={`p-4 rounded-xl border cursor-pointer transition-all hover:border-secondary/50 hover:shadow-[0_0_15px_rgba(0,210,255,0.1)] active:scale-[0.98] ${
                                  gate.enabled === false
                                    ? 'bg-surface/30 border-white/5 opacity-60'
                                    : 'bg-surface/50 border-white/10'
                                }`}
                                onClick={() => handleGateEdit(locationIdx, areaIdx, gateIdx, gate)}
                              >
                                <div className="flex items-center justify-between mb-3">
                                  <span className="font-display font-medium text-white">{gate.name}</span>
                                  <Icon 
                                    icon={gate.enabled === false ? "ph:lightning-slash-fill" : "ph:lightning-fill"} 
                                    className="w-5 h-5" 
                                    style={{ color: gate.enabled === false ? '#4b5563' : '#00ff9d' }}
                                  />
                                </div>
                                <div className="text-xs font-mono text-gray-500 space-y-1">
                                  <div>Driver: <span className="text-gray-400">{gate.driver}</span></div>
                                  <div>Capabilities: <span className="text-gray-400">{gate.capabilities.join(', ')}</span></div>
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
              <div className={`relative rounded-xl overflow-hidden border ${
                parseError ? 'border-danger/50' : hasChanges ? 'border-primary/50' : 'border-white/10'
              }`}>
                <Editor
                  height="500px"
                  defaultLanguage="yaml"
                  value={yamlContent}
                  onChange={handleYamlChange}
                  theme="vs-dark"
                  options={monacoOptions}
                  loading={
                    <div className="flex items-center justify-center h-[500px] bg-surface">
                      <Icon icon="ph:spinner" className="w-8 h-8 animate-spin text-secondary" />
                      <span className="ml-2 text-gray-500 font-mono">Loading editor...</span>
                    </div>
                  }
                  onMount={(editor) => {
                    editorRef.current = editor;
                  }}
                />
                {hasChanges && (
                  <div className="absolute top-2 right-2 px-2 py-1 bg-primary/80 text-black text-xs font-mono rounded-lg z-10">
                    Unsaved changes
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 mt-6">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || !!parseError || saveMutation.isPending}
                variant="success"
                icon="ph:floppy-disk-fill"
                loading={saveMutation.isPending}
              >
                Save Configuration
              </Button>

              {hasChanges && (
                <Button
                  onClick={handleDiscard}
                  variant="ghost"
                  icon="ph:arrow-counter-clockwise-bold"
                >
                  Discard Changes
                </Button>
              )}

              {saveMutation.isSuccess && !hasChanges && (
                <span className="flex items-center gap-1.5 text-success text-sm font-mono">
                  <Icon icon="ph:check-circle-fill" className="w-4 h-4" />
                  Configuration saved and applied!
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {/* Config Schema Reference */}
      <section className="glass-panel rounded-xl p-6">
        <h2 className="text-xl font-display font-semibold text-white mb-4 flex items-center gap-3">
          <span className="text-secondary">///</span>
          Configuration Reference
        </h2>
        <div className="text-sm text-gray-400 space-y-6">
          <div>
            <h3 className="font-display font-medium text-gray-300 mb-2">Structure</h3>
            <ul className="list-disc list-inside space-y-1.5 ml-2 font-mono text-xs">
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">version</code> - Config version (currently 1)</li>
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">settings</code> - Global settings (cooldown, log level, maintenance mode)</li>
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">locations</code> - Array of locations containing areas and gates</li>
            </ul>
          </div>
          <div>
            <h3 className="font-display font-medium text-gray-300 mb-2">Gate Drivers</h3>
            <ul className="list-disc list-inside space-y-1.5 ml-2 font-mono text-xs">
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">gpio</code> - GPIO driver for Raspberry Pi control</li>
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">webhook</code> - HTTP webhook driver for remote control</li>
            </ul>
          </div>
          <div>
            <h3 className="font-display font-medium text-gray-300 mb-2">GPIO Pin Configuration</h3>
            <ul className="list-disc list-inside space-y-1.5 ml-2 font-mono text-xs">
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">openPin</code>, <code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">closePin</code> - For gates with separate open/close relays</li>
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">togglePin</code> - For single-button gates or lights</li>
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">pulseDurationMs</code> - How long to pulse the relay (50-5000ms)</li>
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">holdDurationMs</code> - For gates that need to hold the button (1000-120000ms)</li>
              <li><code className="bg-surfaceHighlight px-1.5 py-0.5 rounded text-secondary">activeHigh</code> - false = LOW activates relay (most common)</li>
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
