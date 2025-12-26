import { Link, getRouteApi } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import { api } from '../lib/api';
import { GateCard } from '../components/GateCard';
import { IconButton, Badge } from '../components/ui';

const routeApi = getRouteApi('/layout/gates/$gateId');

export function GateControl() {
  const { gateId } = routeApi.useParams();

  const { data: gate, isLoading, error } = useQuery({
    queryKey: ['gate', gateId],
    queryFn: () => api.getGate(gateId!),
    enabled: !!gateId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon icon="ph:spinner" className="w-8 h-8 animate-spin text-secondary" />
      </div>
    );
  }

  if (error || !gate) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-danger">
        <Icon icon="ph:warning-circle-fill" className="w-12 h-12 mb-4" />
        <p className="font-display text-lg">Failed to load gate</p>
        <Link to="/" className="mt-4 text-secondary hover:text-secondary/80 interactive">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/">
          <IconButton 
            icon="ph:arrow-left-bold" 
            label="Back to Dashboard" 
            className="text-gray-400 hover:text-white hover:bg-white/5"
          />
        </Link>
        <h1 className="text-2xl font-display font-bold text-white">{gate.name}</h1>
      </div>

      <div className="max-w-md">
        <GateCard gate={gate} />
      </div>

      <div className="glass-panel rounded-xl p-4">
        <h2 className="text-lg font-display font-semibold text-white mb-4">Gate Details</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt className="text-gray-500 font-mono text-xs uppercase tracking-wider">ID</dt>
          <dd className="font-mono text-gray-300">{gate.id}</dd>
          <dt className="text-gray-500 font-mono text-xs uppercase tracking-wider">Driver</dt>
          <dd className="text-gray-300">{gate.driverType}</dd>
          <dt className="text-gray-500 font-mono text-xs uppercase tracking-wider">Enabled</dt>
          <dd>
            <Badge variant={gate.enabled ? 'success' : 'warning'}>
              {gate.enabled ? 'Yes' : 'No'}
            </Badge>
          </dd>
          <dt className="text-gray-500 font-mono text-xs uppercase tracking-wider">Capabilities</dt>
          <dd className="flex flex-wrap gap-1">
            {(gate.capabilities as string[]).map((cap) => (
              <Badge key={cap} variant="secondary">{cap}</Badge>
            ))}
          </dd>
        </dl>
      </div>
    </div>
  );
}
