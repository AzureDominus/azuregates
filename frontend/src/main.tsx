import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { AuthProvider } from './lib/auth';
import { StartupScreen } from './components/StartupScreen';
import './index.css';

// Debug logging for mobile debugging
const DEBUG_ENABLED = new URLSearchParams(window.location.search).has('debug');
const debugLogs: string[] = [];
const maxDebugLogs = 50;

function debugLog(msg: string) {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const entry = `[${timestamp}] ${msg}`;
  console.log('[DEBUG]', entry);
  if (DEBUG_ENABLED) {
    debugLogs.unshift(entry);
    if (debugLogs.length > maxDebugLogs) debugLogs.pop();
    updateDebugOverlay();
  }
}

function updateDebugOverlay() {
  let overlay = document.getElementById('debug-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'debug-overlay';
    overlay.style.cssText = `
      position: fixed; bottom: 0; left: 0; right: 0; max-height: 40vh;
      background: rgba(0,0,0,0.9); color: #0f0; font-family: monospace;
      font-size: 10px; padding: 8px; overflow-y: auto; z-index: 99999;
      white-space: pre-wrap; word-break: break-all;
    `;
    document.body.appendChild(overlay);
  }
  overlay.textContent = debugLogs.join('\n');
}

// Expose globally for SW messages
(window as any).__debugLog = debugLog;

debugLog(`Page load: ${window.location.pathname}`);
debugLog(`SW controller: ${navigator.serviceWorker?.controller ? 'yes' : 'no'}`);
debugLog(`UA: ${navigator.userAgent.slice(0, 60)}...`);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});

const STARTUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * AppWrapper checks if the system is ready before rendering the main app.
 * If the backend just started and Authentik isn't ready, shows a splash screen.
 */
function AppWrapper() {
  const [isReady, setIsReady] = useState<boolean | null>(null);
  const [shouldBypassStartup, setShouldBypassStartup] = useState(false);

  useEffect(() => {
    // Check startup status once
    async function checkInitialStatus() {
      try {
        const response = await fetch('/api/health/startup', {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // If system is ready, skip startup screen
          if (data.status === 'ready') {
            setIsReady(true);
            return;
          }
          
          // If uptime > 5 mins, don't show splash (we're past the grace period)
          // Just try to load the app normally - it will show errors if needed
          if (data.uptimeMs > STARTUP_TIMEOUT_MS) {
            setShouldBypassStartup(true);
            setIsReady(true);
            return;
          }
          
          // System is starting and within grace period - show splash
          setIsReady(false);
        } else {
          // Backend not responding properly - try to show app anyway
          setShouldBypassStartup(true);
          setIsReady(true);
        }
      } catch {
        // Backend not reachable - this might be a fresh load before backend is up
        // Show startup screen
        setIsReady(false);
      }
    }
    
    checkInitialStatus();
  }, []);

  // Still checking
  if (isReady === null) {
    return null; // or a minimal loading indicator
  }

  // System not ready - show startup screen
  if (!isReady && !shouldBypassStartup) {
    return <StartupScreen onReady={() => setIsReady(true)} />;
  }

  // System ready - render app
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}

// Service worker registration is handled by usePWAInstall.ts hook in Layout
// Don't register here to avoid duplicate registration issues

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>
);
