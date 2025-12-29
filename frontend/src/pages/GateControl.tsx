import { Link, getRouteApi } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import { api } from '../lib/api';
import { DeviceCard } from '../components/DeviceCard';
import { IconButton, Badge } from '../components/ui';

const routeApi = getRouteApi('/layout/devices/$deviceId');

export function DeviceControl() {
  const { deviceId } = routeApi.useParams();

  const { data: device, isLoading, error } = useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => api.getDevice(deviceId!),
    enabled: !!deviceId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon icon="ph:spinner" className="w-8 h-8 animate-spin text-secondary" />
      </div>
    );
  }

  if (error || !device) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-danger">
        <Icon icon="ph:warning-circle-fill" className="w-12 h-12 mb-4" />
        <p className="font-display text-lg">Failed to load device</p>
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
        <h1 className="text-2xl font-display font-bold text-white">{device.name}</h1>
      </div>

      <div className="max-w-md">
        <DeviceCard device={device} />
      </div>

      <div className="glass-panel rounded-xl p-4">
        <h2 className="text-lg font-display font-semibold text-white mb-4">Device Details</h2>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt className="text-gray-500 font-mono text-xs uppercase tracking-wider">ID</dt>
          <dd className="font-mono text-gray-300">{device.id}</dd>
          <dt className="text-gray-500 font-mono text-xs uppercase tracking-wider">Driver</dt>
          <dd className="text-gray-300">{device.driverType}</dd>
          <dt className="text-gray-500 font-mono text-xs uppercase tracking-wider">Enabled</dt>
          <dd>
            <Badge variant={device.enabled ? 'success' : 'warning'}>
              {device.enabled ? 'Yes' : 'No'}
            </Badge>
          </dd>
          <dt className="text-gray-500 font-mono text-xs uppercase tracking-wider">Capabilities</dt>
          <dd className="flex flex-wrap gap-1">
            {(device.capabilities as string[]).map((cap) => (
              <Badge key={cap} variant="secondary">{cap}</Badge>
            ))}
          </dd>
        </dl>
      </div>
    </div>
  );
}
