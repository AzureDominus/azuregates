import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, AlertCircle, CheckCircle, DoorOpen } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { GateCard } from '../components/GateCard';

export function GuestAccess() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { refetch: refetchAuth } = useAuth();
  const [redeemed, setRedeemed] = useState(false);
  const attemptedRef = useRef(false);

  // Redeem the token
  const redeemMutation = useMutation({
    mutationFn: (token: string) => api.redeemGuestToken(token),
    onSuccess: () => {
      setRedeemed(true);
      refetchAuth();
    },
  });

  // Get guest scope after redemption
  const { data: scope, isLoading: scopeLoading } = useQuery({
    queryKey: ['guest', 'scope'],
    queryFn: api.getGuestScope,
    enabled: redeemed,
    retry: false,
  });

  // Get gates for the scope
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: api.getLocations,
    enabled: redeemed && !!scope,
  });

  // Redeem token on mount - only attempt once
  useEffect(() => {
    if (token && !attemptedRef.current) {
      attemptedRef.current = true;
      redeemMutation.mutate(token);
    }
  }, [token]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
        <div className="max-w-md w-full bg-gray-800 rounded-lg p-6 border border-gray-700 text-center">
          <AlertCircle className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Invalid Access Link</h1>
          <p className="text-gray-400">
            This guest access link is missing a token. Please request a new link.
          </p>
        </div>
      </div>
    );
  }

  if (redeemMutation.isPending || (redeemed && scopeLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-4" />
          <p className="text-gray-400">Validating your access...</p>
        </div>
      </div>
    );
  }

  if (redeemMutation.isError) {
    const errorMessage = redeemMutation.error instanceof Error 
      ? redeemMutation.error.message 
      : 'Unknown error';
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
        <div className="max-w-md w-full bg-gray-800 rounded-lg p-6 border border-red-600 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Access Denied</h1>
          <p className="text-gray-400 mb-4">{errorMessage}</p>
          <p className="text-sm text-gray-500">
            This link may have expired or already been used.
          </p>
        </div>
      </div>
    );
  }

  if (redeemed && scope) {
    // Filter gates based on scope
    const allowedGates: any[] = [];
    
    if (scope.scopeDetails?.gates) {
      // Get full gate details from locations data
      const allGates = locations?.flatMap(l => 
        l.areas?.flatMap(a => a.gates || []) || []
      ) || [];
      
      for (const scopeGate of scope.scopeDetails.gates) {
        const fullGate = allGates.find(g => g.id === scopeGate.id);
        if (fullGate) {
          // Filter capabilities to only allowed actions
          allowedGates.push({
            ...fullGate,
            capabilities: fullGate.capabilities.filter((c: string) => 
              scope.allowedActions.includes(c)
            ),
          });
        }
      }
    }

    const expiresAt = new Date(scope.expiresAt);
    const timeRemaining = expiresAt.getTime() - Date.now();
    const hoursRemaining = Math.max(0, Math.floor(timeRemaining / (1000 * 60 * 60)));
    const minutesRemaining = Math.max(0, Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60)));

    return (
      <div className="min-h-screen bg-gray-900 p-4">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="bg-gray-800 rounded-lg p-4 border border-green-600 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <CheckCircle className="w-6 h-6 text-green-400" />
              <h1 className="text-xl font-bold">Guest Access Granted</h1>
            </div>
            <p className="text-gray-400 text-sm">
              You have access to <strong>{scope.scopeDetails?.name || scope.scopeId}</strong>
            </p>
            <p className="text-gray-500 text-xs mt-2">
              Access expires in {hoursRemaining}h {minutesRemaining}m • 
              Allowed actions: {scope.allowedActions.join(', ')}
            </p>
          </div>

          {/* Gates */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <DoorOpen className="w-5 h-5" />
              Available Gates
            </h2>

            {allowedGates.length === 0 ? (
              <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 text-center text-gray-400">
                No gates available for your access scope.
              </div>
            ) : (
              <div className="grid gap-4">
                {allowedGates.map((gate) => (
                  <GateCard key={gate.id} gate={gate} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}
