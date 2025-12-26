import { useQuery } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import { api } from '../lib/api';
import { Badge } from '../components/ui';

const resultIcons = {
  success: 'ph:check-circle-fill',
  failure: 'ph:x-circle-fill',
  denied: 'ph:prohibit-fill',
};

const resultColors = {
  success: 'text-success',
  failure: 'text-danger',
  denied: 'text-primary',
};

// Color-coded action badges
const actionColors: Record<string, 'primary' | 'secondary' | 'success' | 'danger' | 'default'> = {
  open: 'success',
  close: 'primary',
  stop: 'danger',
  toggle: 'secondary',
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
      {!logs || logs.length === 0 ? (
        <div className="glass-panel rounded-xl p-12 text-center border-white/5">
          <div className="w-16 h-16 rounded-xl bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Icon icon="ph:file-text" className="w-8 h-8 text-gray-600" />
          </div>
          <p className="text-gray-500 font-mono">No audit logs yet. Execute some gate commands to see logs here.</p>
        </div>
      ) : (
        <div className="glass-panel rounded-xl overflow-hidden">
          <div className="overflow-x-auto table-scroll">
            <table className="w-full text-sm">
              <thead className="text-left border-b border-white/5 bg-surfaceHighlight/50">
                <tr>
                  <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider">Time</th>
                  <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider">User</th>
                  <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider">Gate</th>
                  <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider">Action</th>
                  <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider">Result</th>
                  <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider hidden sm:table-cell">Latency</th>
                  <th className="py-4 px-4 font-mono text-xs text-gray-500 uppercase tracking-wider hidden md:table-cell">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {logs.map((log, index) => {
                  const resultIcon = resultIcons[log.result as keyof typeof resultIcons] || 'ph:x-circle-fill';
                  const resultColor = resultColors[log.result as keyof typeof resultColors] || 'text-gray-400';
                  const actionColor = actionColors[log.action.toLowerCase()] || 'default';
                  
                  // Row background based on result - using explicit rgba for visibility
                  const isSuccess = log.result === 'success';
                  const isFailure = log.result === 'failure' || log.result === 'denied';

                  return (
                    <tr 
                      key={log.id} 
                      className="transition-colors animate-in fade-in slide-in-from-bottom-2"
                      style={{ 
                        animationDelay: `${index * 20}ms`,
                        backgroundColor: isFailure 
                          ? 'rgba(255, 42, 42, 0.08)' 
                          : isSuccess 
                          ? 'rgba(0, 255, 157, 0.06)' 
                          : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = isFailure 
                          ? 'rgba(255, 42, 42, 0.15)' 
                          : isSuccess 
                          ? 'rgba(0, 255, 157, 0.1)' 
                          : 'rgba(255, 255, 255, 0.05)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = isFailure 
                          ? 'rgba(255, 42, 42, 0.08)' 
                          : isSuccess 
                          ? 'rgba(0, 255, 157, 0.06)' 
                          : 'transparent';
                      }}
                    >
                      <td className="py-3 px-4 font-mono text-xs text-gray-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-display text-white">
                        {log.user?.displayName || log.user?.email || log.userId || '-'}
                      </td>
                      <td className="py-3 px-4 font-display text-white">
                        {log.gate?.name || log.gateId || '-'}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={actionColor}>
                          {log.action}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`flex items-center gap-1.5 ${resultColor}`}>
                          <Icon icon={resultIcon} className="w-4 h-4" />
                          <span className="font-mono text-xs uppercase">{log.result}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-gray-500 hidden sm:table-cell">
                        {log.latencyMs ? `${log.latencyMs}ms` : '-'}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-gray-600 max-w-xs truncate hidden md:table-cell" title={log.clientIp || ''}>
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
      )}
    </div>
  );
}
