import { useEffect, useState, useRef } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Icon } from '@iconify/react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DeviceCard } from '../components/DeviceCard';
import { Badge } from '../components/ui';
import { useGateEvents } from '../lib/useGateEvents';

export function GuestAccess() {
  const search = useSearch({ strict: false }) as { token?: string };
  const token = search.token ?? null;
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

  // Get global config for maintenance mode and status messages
  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
    enabled: redeemed && !!scope,
    refetchInterval: 30000, // 30 seconds - keep in sync with global settings
  });

  const showStatusMessages = config?.settings?.showStatusMessages ?? true;
  const maintenanceMode = config?.settings?.maintenanceMode ?? false;
  
  const { getDeviceState } = useGateEvents();

  // Redeem token on mount - only attempt once
  useEffect(() => {
    if (token && !attemptedRef.current) {
      attemptedRef.current = true;
      redeemMutation.mutate(token);
    }
  }, [token]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-background z-[-1]" />
        <div className="glass-panel max-w-md w-full rounded-2xl p-8 text-center border-danger/30">
          <div className="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center mx-auto mb-6">
            <Icon icon="ph:warning-circle-fill" className="w-8 h-8 text-danger" />
          </div>
          <h1 className="text-2xl font-display font-bold text-white mb-2">Invalid Access Link</h1>
          <p className="text-gray-400 font-mono text-sm">
            This guest access link is missing a token. Please request a new link.
          </p>
        </div>
      </div>
    );
  }

  if (redeemMutation.isPending || (redeemed && scopeLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-background z-[-1]" />
        <div className="text-center space-y-4">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 border-4 border-white/10 rounded-full" />
            <div className="absolute inset-0 border-4 border-t-primary rounded-full animate-spin" />
          </div>
          <p className="text-primary font-mono text-sm tracking-widest uppercase animate-pulse">Validating Access Credentials...</p>
        </div>
      </div>
    );
  }

  if (redeemMutation.isError) {
    const errorMessage = redeemMutation.error instanceof Error 
      ? redeemMutation.error.message 
      : 'Unknown error';
    
    return (
      <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-background z-[-1]" />
        <div className="glass-panel max-w-md w-full rounded-2xl p-8 text-center border-danger/30 shadow-[0_0_50px_rgba(255,42,42,0.1)]">
          <div className="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center mx-auto mb-6 animate-bounce">
            <Icon icon="ph:warning-circle-fill" className="w-8 h-8 text-danger" />
          </div>
          <h1 className="text-2xl font-display font-bold text-white mb-2">Access Denied</h1>
          <p className="text-danger font-mono text-sm mb-6">{errorMessage}</p>
          <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">
            This link may have expired or already been used.
          </p>
        </div>
      </div>
    );
  }

  if (redeemed && scope) {
    // Filter devices based on scope
    const allowedDevices: any[] = [];
    
    if (scope.scopeDetails?.devices) {
      // Get full device details from locations data
      const allDevices = locations?.flatMap(l => 
        l.areas?.flatMap(a => a.devices || []) || []
      ) || [];
      
      for (const scopeDevice of scope.scopeDetails.devices) {
        const fullDevice = allDevices.find(d => d.id === scopeDevice.id);
        if (fullDevice) {
          // Filter capabilities to only allowed actions
          allowedDevices.push({
            ...fullDevice,
            capabilities: fullDevice.capabilities.filter((c: string) => 
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
      <div className="min-h-screen p-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-background z-[-1]" />
        {/* Ambient Background */}
        <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-[-1]">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-secondary/5 blur-[120px] animate-pulse-slow" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-primary/5 blur-[120px] animate-pulse-slow" style={{ animationDelay: '1.5s' }} />
        </div>

        <div className="max-w-2xl mx-auto space-y-8">
          {/* Maintenance Mode Banner */}
          {maintenanceMode && (
            <div className="glass-panel rounded-xl p-4 border-warning/30 bg-warning/5 flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
              <Icon icon="ph:wrench-fill" className="w-5 h-5 text-warning" />
              <span className="text-warning font-mono text-sm">System is in maintenance mode - commands are simulated</span>
            </div>
          )}

          {/* Header */}
          <div className="glass-panel rounded-2xl p-6 border-success/30 shadow-[0_0_30px_rgba(0,255,157,0.1)] animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-success/10 flex items-center justify-center border border-success/20">
                <Icon icon="ph:check-circle-fill" className="w-6 h-6 text-success" />
              </div>
              <div>
                <h1 className="text-2xl font-display font-bold text-white tracking-wide">Guest Access Granted</h1>
                <p className="text-gray-400 font-mono text-sm">
                  Scope: <strong className="text-white">{scope.scopeDetails?.name || scope.scopeId}</strong>
                </p>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-3 mt-4 pt-4 border-t border-white/5">
              <Badge variant="default">
                Expires in: {hoursRemaining}h {minutesRemaining}m
              </Badge>
              {/* <Badge variant="secondary">
                Actions: {scope.allowedActions.map(a => a.toUpperCase()).join(', ')}
              </Badge> */}
            </div>
          </div>

          {/* Devices */}
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150">
            <h2 className="text-xl font-display font-bold text-white flex items-center gap-3">
              <span className="text-gray-500 font-bold">///</span>
              Available Devices
            </h2>

            {allowedDevices.length === 0 ? (
              <div className="glass-panel rounded-xl p-8 text-center border-white/5">
                <p className="text-gray-400 font-mono">No devices available for your access scope.</p>
              </div>
            ) : (
              <div className="grid gap-6">
                {allowedDevices.map((device, index) => (
                  <div 
                    key={device.id}
                    className="animate-in zoom-in-95 duration-500 fill-mode-backwards"
                    style={{ animationDelay: `${index * 100}ms` }}
                  >
                    <DeviceCard 
                      device={device} 
                      deviceState={getDeviceState(device.id)}
                      showStatusMessages={showStatusMessages}
                      maintenanceMode={maintenanceMode}
                    />
                  </div>
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
