import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Icon } from '@iconify/react';
import { useAuth } from '../lib/auth';
import { Button } from '../components/ui';

const POLLING_DURATION_MS = 2 * 60 * 1000; // 2 minutes
const POLLING_INTERVAL_MS = 10 * 1000; // 10 seconds

export function AccountDisabled() {
  const { user, logout, isActivated, refetch } = useAuth();
  const navigate = useNavigate();
  const [isPolling, setIsPolling] = useState(true);

  // Redirect to dashboard if user becomes re-activated
  useEffect(() => {
    if (isActivated) {
      navigate({ to: '/', replace: true });
    }
  }, [isActivated, navigate]);

  // Poll for activation status every 10 seconds, but only for first 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, POLLING_INTERVAL_MS);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      setIsPolling(false);
    }, POLLING_DURATION_MS);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [refetch]);

  const handleLogout = async () => {
    await logout();
  };

  const handleRefresh = () => {
    refetch();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-background z-[-1]" />
      {/* Ambient Background */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-[-1]">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-danger/5 blur-[120px] animate-pulse-slow" />
      </div>

      <div className="glass-panel max-w-md w-full rounded-2xl p-8 text-center border-danger/30 shadow-[0_0_50px_rgba(255,42,42,0.1)]">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-danger/10 rounded-2xl border border-danger/20 flex items-center justify-center animate-float">
            <Icon icon="ph:shield-slash-fill" className="w-10 h-10 text-danger" />
          </div>
        </div>
        
        <h1 className="text-3xl font-display font-bold text-white mb-2 tracking-wide">Account Disabled</h1>
        <p className="text-gray-400 font-mono text-sm mb-6">
          The account <span className="text-white font-bold">{user?.email}</span> has been deactivated.
        </p>

        <div className="bg-surfaceHighlight/50 rounded-xl p-4 mb-8 border border-white/5">
          <p className="text-xs text-gray-500 font-mono leading-relaxed">
            Your access privileges have been revoked by an administrator. Please contact support if you believe this is an error.
          </p>
        </div>

        <div className="space-y-3">
          <Button
            onClick={handleRefresh}
            variant="ghost"
            icon={isPolling ? "ph:spinner" : "ph:arrows-clockwise-bold"}
            className={`w-full ${isPolling ? '[&_svg]:animate-spin' : ''}`}
          >
            Check Status
          </Button>
          
          <Button
            onClick={handleLogout}
            variant="ghost"
            icon="ph:sign-out-bold"
            className="w-full text-gray-500 hover:text-white border-transparent hover:border-white/10"
          >
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
