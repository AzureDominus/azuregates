import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { DoorOpen, DoorClosed, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { GateCard } from '../components/GateCard';
import { useRequireAuth } from '../lib/auth';

export function Dashboard() {
  const { isReady } = useRequireAuth();
  
  const { data: locations, isLoading, error } = useQuery({
    queryKey: ['locations'],
    queryFn: api.getLocations,
    enabled: isReady, // Only fetch when authenticated
  });

  if (!isReady || isLoading) {
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
        <p>Failed to load gates</p>
        <p className="text-sm text-gray-500">{error instanceof Error ? error.message : 'Unknown error'}</p>
      </div>
    );
  }

  if (!locations || locations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-400">
        <DoorClosed className="w-12 h-12 mb-4" />
        <p>No gates configured</p>
        <Link to="/settings" className="mt-4 text-blue-400 hover:text-blue-300">
          Go to Settings to add gates
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      {locations.map((location) => (
        <div key={location.id} className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <DoorOpen className="w-5 h-5" />
            {location.name}
            {!location.enabled && (
              <span className="text-xs bg-yellow-600 px-2 py-0.5 rounded">Disabled</span>
            )}
          </h2>

          {location.areas?.map((area) => (
            <div key={area.id} className="space-y-3">
              <h3 className="text-lg text-gray-300 flex items-center gap-2">
                {area.name}
                {!area.enabled && (
                  <span className="text-xs bg-yellow-600 px-2 py-0.5 rounded">Disabled</span>
                )}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {area.gates?.map((gate) => (
                  <GateCard key={gate.id} gate={gate} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
