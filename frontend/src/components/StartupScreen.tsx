import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';

interface StartupStatus {
  status: 'ready' | 'starting';
  startedAt: string;
  uptimeMs: number;
  version: string;
  checks: {
    authentik: boolean;
    database: boolean;
  };
}

interface StartupScreenProps {
  onReady: () => void;
}

const STARTUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 5000; // 5 seconds

export function StartupScreen({ onReady }: StartupScreenProps) {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  const checkStartup = useCallback(async () => {
    try {
      const response = await fetch('/api/health/startup', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data: StartupStatus = await response.json();
      setStatus(data);
      setError(null);
      
      // Check if system is ready
      if (data.status === 'ready') {
        onReady();
        return true;
      }
      
      // Check if we've exceeded the timeout based on backend uptime
      if (data.uptimeMs > STARTUP_TIMEOUT_MS) {
        setTimedOut(true);
        return true;
      }
      
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check startup status');
      return false;
    }
  }, [onReady]);

  useEffect(() => {
    // Don't poll if we've timed out
    if (timedOut) return;
    
    // Initial check
    checkStartup();
    
    // Set up polling interval
    const interval = setInterval(async () => {
      setPollCount(prev => prev + 1);
      const shouldStop = await checkStartup();
      if (shouldStop) {
        clearInterval(interval);
      }
    }, POLL_INTERVAL_MS);
    
    return () => clearInterval(interval);
  }, [checkStartup, timedOut]);

  // Calculate progress (0-100) based on typical startup time (estimate 2 mins)
  const estimatedStartupMs = 2 * 60 * 1000;
  const progress = status ? Math.min(100, (status.uptimeMs / estimatedStartupMs) * 100) : 0;

  // If timed out, show error state
  if (timedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        {/* Ambient Background */}
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-danger/5 blur-[120px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-danger/5 blur-[120px]" />
        </div>

        <div className="glass-panel max-w-md w-full rounded-2xl p-8 text-center border-danger/30 shadow-[0_0_50px_rgba(255,42,42,0.1)]">
          <div className="w-16 h-16 rounded-full bg-danger/10 flex items-center justify-center mx-auto mb-6">
            <Icon icon="ph:warning-circle-fill" className="w-8 h-8 text-danger" />
          </div>
          
          <h1 className="text-2xl font-display font-bold text-white mb-2">
            System Unavailable
          </h1>
          
          <p className="text-gray-400 font-mono text-sm mb-6">
            The system failed to start within the expected time.
            Please check the server logs or contact an administrator.
          </p>

          {status && (
            <div className="text-xs font-mono text-gray-600 space-y-1">
              <div>Authentik: {status.checks.authentik ? '✓' : '✗'}</div>
              <div>Database: {status.checks.database ? '✓' : '✗'}</div>
              <div>Uptime: {Math.floor(status.uptimeMs / 1000)}s</div>
            </div>
          )}

          <button
            onClick={() => window.location.reload()}
            className="mt-6 px-4 py-2 bg-danger/20 border border-danger/30 rounded-lg text-danger font-mono text-sm hover:bg-danger/30 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Loading/starting state
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      {/* Ambient Background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/5 blur-[120px] animate-pulse" style={{ animationDuration: '4s' }} />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px] animate-pulse" style={{ animationDuration: '4s', animationDelay: '2s' }} />
      </div>

      <div className="glass-panel max-w-md w-full rounded-2xl p-8 text-center border-secondary/30 shadow-[0_0_50px_rgba(0,210,255,0.1)]">
        {/* Logo/Icon */}
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-secondary/20 to-primary/20 flex items-center justify-center mx-auto mb-6 border border-secondary/30">
          <Icon icon="ph:door-open-fill" className="w-10 h-10 text-secondary" />
        </div>

        <h1 className="text-3xl font-display font-bold text-white mb-2 tracking-wide">
          AzureGates
        </h1>
        
        <p className="text-gray-400 font-mono text-sm mb-8">
          System Starting...
        </p>

        {/* Progress Bar */}
        <div className="relative h-2 bg-surfaceHighlight rounded-full overflow-hidden mb-6">
          <div 
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-secondary to-primary rounded-full transition-all duration-1000 ease-out"
            style={{ width: `${Math.max(5, progress)}%` }}
          />
          {/* Animated shimmer */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
        </div>

        {/* Status Checks */}
        <div className="space-y-2 mb-6">
          <StatusCheck 
            label="Authentication Service" 
            ready={status?.checks.authentik ?? false} 
            checking={!status}
          />
          <StatusCheck 
            label="Database" 
            ready={status?.checks.database ?? false} 
            checking={!status}
          />
        </div>

        {/* Uptime/Version */}
        <div className="text-xs font-mono text-gray-600 space-y-1">
          {status && (
            <>
              <div>Uptime: {Math.floor(status.uptimeMs / 1000)}s</div>
              <div>Backend v{status.version}</div>
            </>
          )}
          {error && !status && (
            <div className="text-danger">Connecting to backend...</div>
          )}
          <div className="text-gray-700">Poll #{pollCount}</div>
        </div>
      </div>
    </div>
  );
}

function StatusCheck({ label, ready, checking }: { label: string; ready: boolean; checking: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-surfaceHighlight/50 rounded-lg">
      <span className="text-sm font-mono text-gray-400">{label}</span>
      {checking ? (
        <Icon icon="ph:spinner" className="w-4 h-4 text-gray-500 animate-spin" />
      ) : ready ? (
        <Icon icon="ph:check-circle-fill" className="w-4 h-4 text-success" />
      ) : (
        <Icon icon="ph:clock-fill" className="w-4 h-4 text-primary animate-pulse" />
      )}
    </div>
  );
}
