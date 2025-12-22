import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { api } from '../lib/api';

export function Settings() {
  const queryClient = useQueryClient();

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['health'],
    queryFn: api.getHealthReady,
    refetchInterval: 10000,
  });

  const reloadMutation = useMutation({
    mutationFn: api.reloadConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['gates'] });
    },
  });

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
                    {check.latencyMs && (
                      <span className="text-gray-500">{check.latencyMs}ms</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* Configuration */}
      <section className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h2 className="text-lg font-semibold mb-4">Configuration</h2>

        <div className="space-y-4">
          <p className="text-gray-400 text-sm">
            Configuration is loaded from <code className="bg-gray-700 px-1 rounded">gates.yaml</code>. 
            Reload to apply changes made to the file.
          </p>

          <button
            onClick={() => reloadMutation.mutate()}
            disabled={reloadMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors disabled:opacity-50"
          >
            {reloadMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Reload Configuration
          </button>

          {reloadMutation.isSuccess && (
            <p className="text-green-400 text-sm">Configuration reloaded successfully!</p>
          )}

          {reloadMutation.isError && (
            <p className="text-red-400 text-sm">
              Failed to reload: {reloadMutation.error instanceof Error ? reloadMutation.error.message : 'Unknown error'}
            </p>
          )}
        </div>
      </section>

      {/* Future: Config Editor */}
      <section className="bg-gray-800 rounded-lg p-4 border border-gray-700 opacity-50">
        <h2 className="text-lg font-semibold mb-4">Configuration Editor</h2>
        <p className="text-gray-400 text-sm">Coming soon - edit gates, areas, and locations through the UI.</p>
      </section>
    </div>
  );
}
