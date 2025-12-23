import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { stringify, parse } from 'yaml';
import { api, GatesConfig } from '../lib/api';

export function Settings() {
  const queryClient = useQueryClient();
  const [yamlContent, setYamlContent] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [originalYaml, setOriginalYaml] = useState('');

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

  // Update YAML content when config loads
  useEffect(() => {
    if (config) {
      const yaml = stringify(config, { indent: 2, lineWidth: 120 });
      setYamlContent(yaml);
      setOriginalYaml(yaml);
      setHasChanges(false);
      setParseError(null);
    }
  }, [config]);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['config-history'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['gates'] });
      setHasChanges(false);
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

  // Handle YAML content change
  const handleYamlChange = (value: string) => {
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

  // Handle save
  const handleSave = () => {
    try {
      const parsed = parse(yamlContent) as GatesConfig;
      saveMutation.mutate(parsed);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse YAML');
    }
  };

  // Handle discard changes
  const handleDiscard = () => {
    setYamlContent(originalYaml);
    setHasChanges(false);
    setParseError(null);
  };

  // Format timestamp from backup filename
  const formatBackupTime = (filename: string) => {
    // gates-2024-01-15T12-30-45-123Z.yaml -> 2024-01-15 12:30:45
    const match = filename.match(/gates-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
    if (match) {
      const [, year, month, day, hour, min, sec] = match;
      return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
    }
    return filename;
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
              Edit the configuration below. Changes are validated against the schema before saving.
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

            {/* YAML Editor */}
            <div className="relative">
              <textarea
                value={yamlContent}
                onChange={(e) => handleYamlChange(e.target.value)}
                className={`w-full h-[500px] p-4 bg-gray-900 text-gray-100 font-mono text-sm rounded-lg border ${
                  parseError ? 'border-red-500' : hasChanges ? 'border-yellow-500' : 'border-gray-700'
                } focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none`}
                spellCheck={false}
                placeholder="Loading configuration..."
              />
              {hasChanges && (
                <div className="absolute top-2 right-2 px-2 py-1 bg-yellow-600/80 text-yellow-100 text-xs rounded">
                  Unsaved changes
                </div>
              )}
            </div>

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
              <li><code className="bg-gray-700 px-1 rounded">webhook</code> - HTTP webhook driver for remote control</li>
              <li><code className="bg-gray-700 px-1 rounded">gpio</code> - GPIO driver for Raspberry Pi control</li>
            </ul>
          </div>
          <div>
            <h3 className="font-medium text-gray-300 mb-1">Gate Capabilities</h3>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><code className="bg-gray-700 px-1 rounded">open</code>, <code className="bg-gray-700 px-1 rounded">close</code>, <code className="bg-gray-700 px-1 rounded">stop</code>, <code className="bg-gray-700 px-1 rounded">toggle</code> - Gate actions</li>
              <li><code className="bg-gray-700 px-1 rounded">state</code> - Query gate state (if supported)</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
