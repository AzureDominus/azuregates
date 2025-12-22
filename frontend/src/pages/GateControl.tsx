import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { GateCard } from '../components/GateCard';

export function GateControl() {
  const { gateId } = useParams<{ gateId: string }>();

  const { data: gate, isLoading, error } = useQuery({
    queryKey: ['gate', gateId],
    queryFn: () => api.getGate(gateId!),
    enabled: !!gateId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    );
  }

  if (error || !gate) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-red-400">
        <AlertCircle className="w-12 h-12 mb-4" />
        <p>Failed to load gate</p>
        <Link to="/" className="mt-4 text-blue-400 hover:text-blue-300">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/" className="text-gray-400 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-bold">{gate.name}</h1>
      </div>

      <div className="max-w-md">
        <GateCard gate={gate} />
      </div>

      <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <h2 className="text-lg font-semibold mb-3">Gate Details</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-400">ID</dt>
          <dd className="font-mono">{gate.id}</dd>
          <dt className="text-gray-400">Driver</dt>
          <dd>{gate.driverType}</dd>
          <dt className="text-gray-400">Enabled</dt>
          <dd>{gate.enabled ? 'Yes' : 'No'}</dd>
          <dt className="text-gray-400">Capabilities</dt>
          <dd>{(gate.capabilities as string[]).join(', ')}</dd>
        </dl>
      </div>
    </div>
  );
}
