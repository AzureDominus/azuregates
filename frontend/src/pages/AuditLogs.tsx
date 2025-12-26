import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, CheckCircle, XCircle, Ban } from 'lucide-react';
import { api } from '../lib/api';

const resultIcons = {
  success: CheckCircle,
  failure: XCircle,
  denied: Ban,
};

const resultColors = {
  success: 'text-green-400',
  failure: 'text-red-400',
  denied: 'text-yellow-400',
};

export function AuditLogs() {
  const { data: logs, isLoading, error } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => api.getAuditLogs({ limit: 50 }),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-400">
        <AlertCircle className="w-12 h-12 mb-4" />
        <p>Failed to load audit logs</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit Logs</h1>

      {!logs || logs.length === 0 ? (
        <div className="text-center text-gray-400 py-12">
          No audit logs yet. Execute some gate commands to see logs here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left border-b border-gray-700">
              <tr>
                <th className="pb-3 pr-4">Time</th>
                <th className="pb-3 pr-4">User</th>
                <th className="pb-3 pr-4">Gate</th>
                <th className="pb-3 pr-4">Action</th>
                <th className="pb-3 pr-4">Result</th>
                <th className="pb-3 pr-4">Latency</th>
                <th className="pb-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {logs.map((log) => {
                const ResultIcon = resultIcons[log.result as keyof typeof resultIcons] || XCircle;
                const resultColor = resultColors[log.result as keyof typeof resultColors] || 'text-gray-400';

                return (
                  <tr key={log.id} className="hover:bg-gray-800/50">
                    <td className="py-3 pr-4 text-gray-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="py-3 pr-4">
                      {log.user?.displayName || log.user?.email || log.userId || '-'}
                    </td>
                    <td className="py-3 pr-4">
                      {log.gate?.name || log.gateId || '-'}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="px-2 py-0.5 bg-gray-700 rounded text-xs font-medium">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`flex items-center gap-1 ${resultColor}`}>
                        <ResultIcon className="w-4 h-4" />
                        {log.result}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-400">
                      {log.latencyMs ? `${log.latencyMs}ms` : '-'}
                    </td>
                    <td className="py-3 text-gray-500 text-xs max-w-xs truncate" title={log.clientIp}>
                      {log.result === 'failure' || log.result === 'denied'
                        ? log.errorMessage || '-'
                        : log.metadata?.message || '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
