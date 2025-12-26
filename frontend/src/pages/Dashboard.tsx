import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Icon } from '@iconify/react';
import { api } from '../lib/api';
import { GateCard } from '../components/GateCard';
import { useRequireAuth } from '../lib/auth';
import { useGateEvents } from '../lib/useGateEvents';
import { StatusLight, Badge } from '../components/ui';

export function Dashboard() {
  const { isReady } = useRequireAuth();
  const { connected, getGateActiveStatus } = useGateEvents();
  
  const { data: locations, isLoading, error } = useQuery({
    queryKey: ['locations'],
    queryFn: api.getLocations,
    enabled: isReady, // Only fetch when authenticated
  });

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
    enabled: isReady,
  });

  const showStatusMessages = config?.settings?.showStatusMessages ?? true;

  if (!isReady || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon icon="ph:spinner" className="w-8 h-8 animate-spin text-secondary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-danger">
        <Icon icon="ph:warning-circle-fill" className="w-12 h-12 mb-4" />
        <p>Failed to load gates</p>
        <p className="text-sm text-gray-500">{error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>
    );
  }

  if (!locations || locations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <Icon icon="ph:door-fill" className="w-12 h-12 mb-4" />
        <p>No gates configured</p>
        <Link to="/settings" className="mt-4 text-secondary hover:text-secondary/80 interactive">
          Go to Settings to add gates
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-12 pb-12">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight mb-1">Dashboard</h1>
          <p className="text-gray-400 font-mono text-sm">System Status & Control</p>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 rounded-full glass-panel border-white/5">
          {connected ? (
            <>
              <StatusLight variant="success" pulse />
              <span className="text-xs font-mono text-success font-bold tracking-wider uppercase">System Online</span>
            </>
          ) : (
            <>
              <Icon icon="ph:wifi-slash-fill" className="w-4 h-4 text-danger" />
              <span className="text-xs font-mono text-danger font-bold tracking-wider uppercase">Reconnecting</span>
            </>
          )}
        </div>
      </div>

      {locations.map((location, locIndex) => (
        <div key={location.id} className="space-y-6">
          <div className="flex items-center gap-4 border-b border-white/10 pb-2">
            <h2 className="text-2xl font-display font-bold text-white flex items-center gap-3">
              <span className="text-gray-500 font-bold">///</span>
              {location.name}
            </h2>
            {!location.enabled && (
              <Badge variant="warning">Location Disabled</Badge>
            )}
          </div>

          {location.areas?.map((area, areaIndex) => (
            <div key={area.id} className="space-y-8 md:pl-6 md:border-l-2 border-white/5 mb-16 last:mb-0 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-base font-display font-bold text-white uppercase tracking-wider shadow-sm">
                    {area.name}
                  </span>
                </div>
                {!area.enabled && (
                  <Badge variant="warning">Area Disabled</Badge>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {area.gates?.map((gate, gateIndex) => (
                  <div 
                    key={gate.id} 
                    className="fill-mode-backwards"
                    style={{ animationDelay: `${(locIndex * 200) + (areaIndex * 100) + (gateIndex * 50)}ms` }}
                  >
                    <GateCard 
                      gate={gate} 
                      activeStatus={getGateActiveStatus(gate.id)}
                      showStatusMessages={showStatusMessages}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
