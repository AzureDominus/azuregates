import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import { api } from '../lib/api';
import { APP_NAME } from '../lib/constants';
import { Badge, Button } from '../components/ui';

const resultIcons = {
  success: 'ph:check-circle-fill',
  failure: 'ph:x-circle-fill',
  denied: 'ph:prohibit-fill',
};

const resultColors = {
  success: 'text-success/80',
  failure: 'text-danger/80',
  denied: 'text-primary/80',
};

const PAGE_SIZE = 20;

export function AuditLogs() {
  const [page, setPage] = useState(0);
  
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => api.getAuditLogs({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    refetchInterval: 10000,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  if (isLoading && page === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon icon="ph:spinner" className="w-8 h-8 animate-spin text-secondary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="w-16 h-16 rounded-xl bg-danger/10 flex items-center justify-center mb-4 border border-danger/20">
          <Icon icon="ph:warning-fill" className="w-8 h-8 text-danger" />
        </div>
        <p className="text-gray-400 font-display text-lg">Failed to load audit logs</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight mb-1">Audit Logs</h1>
          <p className="text-gray-400 font-mono text-sm">{APP_NAME} Activity History</p>
        </div>
        <div className="text-sm font-mono text-gray-500">
          {total > 0 && `${total.toLocaleString()} total entries`}
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center border-white/5">
          <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Icon icon="ph:file-text" className="w-8 h-8 text-gray-600" />
          </div>
          <p className="text-gray-500 font-mono">No audit logs yet. Execute some gate commands to see logs here.</p>
        </div>
      ) : (
        <>
          <div className="glass-panel rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1000px]">
                <thead className="text-left border-b border-white/5 bg-surfaceHighlight/50">
                  <tr>
                    <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider min-w-[180px]">Time</th>
                    <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider min-w-[120px]">User</th>
                    <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider min-w-[120px]">Gate</th>
                    <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider min-w-[80px]">Action</th>
                    <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider min-w-[100px]">Result</th>
                    <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider min-w-[80px]">Latency</th>
                    <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider min-w-[140px]">IP</th>
                    <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider min-w-[320px]">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {logs.map((log, index) => {
                    const resultIcon = resultIcons[log.result as keyof typeof resultIcons] || 'ph:x-circle-fill';
                    const resultColor = resultColors[log.result as keyof typeof resultColors] || 'text-gray-400';

                    return (
                      <tr 
                        key={log.id} 
                        className="transition-colors hover:bg-white/5 animate-in fade-in slide-in-from-bottom-2"
                        style={{ animationDelay: `${index * 20}ms` }}
                      >
                        <td className="py-3 px-4 font-mono text-xs text-gray-500 min-w-[180px]">
                          {new Date(log.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 font-display text-white whitespace-nowrap min-w-[120px]">
                          {log.user?.displayName || log.user?.email || log.userId || '-'}
                        </td>
                        <td className="py-3 px-4 font-display text-white whitespace-nowrap min-w-[120px]">
                          {log.gate?.name || log.gateId || '-'}
                        </td>
                        <td className="py-3 px-4 min-w-[80px]">
                          <Badge variant="default">
                            {log.action}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 min-w-[100px]">
                          <span className={`flex items-center gap-1.5 ${resultColor}`}>
                            <Icon icon={resultIcon} className="w-4 h-4" />
                            <span className="font-mono text-xs uppercase">{log.result}</span>
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-gray-500 whitespace-nowrap min-w-[80px]">
                          {log.latencyMs ? `${log.latencyMs}ms` : '-'}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-gray-500 whitespace-nowrap min-w-[140px]">
                          {log.clientIp || '-'}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-gray-600 min-w-[320px] break-words">
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
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 glass-panel rounded-xl px-4 py-3">
              <div className="text-sm font-mono text-gray-500">
                Page {page + 1} of {totalPages}
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage(0)}
                  icon="ph:caret-double-left-bold"
                  className="px-2 sm:px-3"
                >
                  <span className="sr-only">First</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  icon="ph:caret-left-bold"
                  className="px-2 sm:px-3"
                >
                  <span className="hidden sm:inline">Previous</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  className="px-2 sm:px-3"
                >
                  <span className="hidden sm:inline">Next</span>
                  <Icon icon="ph:caret-right-bold" className="w-4 h-4 sm:ml-1" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage(totalPages - 1)}
                  className="px-2 sm:px-3"
                >
                  <span className="sr-only">Last</span>
                  <Icon icon="ph:caret-double-right-bold" className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
