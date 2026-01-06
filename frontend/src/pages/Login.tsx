import { useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Icon } from '@iconify/react';
import { useAuth } from '../lib/auth';
import { Button, StatusLight } from '../components/ui';

export function Login() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { returnTo?: string; error?: string };
  const returnTo = search.returnTo || '/';
  const error = search.error;

  // If already authenticated, redirect
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate({ to: returnTo, replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, returnTo]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <Icon icon="ph:spinner" className="w-8 h-8 animate-spin text-secondary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient Background */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-secondary/10 blur-[150px] animate-pulse-slow" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-primary/10 blur-[150px] animate-pulse-slow" style={{ animationDelay: '2s' }} />

      <div className="max-w-md w-full space-y-8 relative z-10">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-surfaceHighlight border border-white/10 mb-6 shadow-[0_0_30px_rgba(0,210,255,0.15)] animate-float">
            <div className="w-10 h-10 border-2 border-primary rounded-lg transform rotate-45 flex items-center justify-center">
              <div className="w-4 h-4 bg-secondary rounded-sm animate-pulse" />
            </div>
          </div>
          <h1 className="text-5xl font-display font-bold text-white tracking-tight">GATES</h1>
          <p className="text-gray-400 font-mono text-sm tracking-widest uppercase">Secure Access Control System</p>
        </div>

        {error && (
          <div className="glass-panel border-danger/30 bg-danger/5 p-4 rounded-xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4">
            <Icon icon="ph:warning-circle-fill" className="w-5 h-5 text-danger flex-shrink-0" />
            <p className="text-danger text-sm font-mono">
              {error === 'auth_failed'
                ? 'Authentication failed. Access denied.'
                : error === 'session_expired'
                ? 'Session expired. Please try again.'
                : error === 'state_mismatch'
                ? 'Security validation failed. Please try again.'
                : 'System error. Please retry.'}
            </p>
          </div>
        )}

        <div className="glass-panel rounded-2xl p-8 backdrop-blur-xl">
          <Button
            onClick={() => login(returnTo)}
            variant="primary"
            size="lg"
            icon="ph:sign-in-bold"
            className="w-full shadow-[0_0_20px_rgba(255,170,0,0.3)] hover:shadow-[0_0_30px_rgba(255,170,0,0.5)] hover:scale-[1.02]"
          >
            <span className="font-display tracking-wide text-lg">AUTHENTICATE</span>
          </Button>

          <div className="mt-8 flex items-center justify-center gap-2 text-xs text-gray-500 font-mono uppercase tracking-widest opacity-60">
            <StatusLight variant="success" pulse size="sm" />
            <span>System Secure</span>
          </div>
        </div>
      </div>
    </div>
  );
}
