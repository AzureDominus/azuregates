import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';
import { AuthProvider } from './lib/auth';
import { StartupScreen } from './components/StartupScreen';
import './index.css';

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

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      console.log('[App] Service worker registered:', registration.scope);

      // Check for updates on page load
      registration.update();

      // Listen for new service worker installing
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content is available, notify user
              console.log('[App] New version available');
              // The Layout component will handle showing the update notification
            }
          });
        }
      });
    }).catch((error) => {
      console.error('[App] Service worker registration failed:', error);
    });

    // Handle controller change (new SW activated)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[App] New service worker activated, reloading...');
      window.location.reload();
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppWrapper />
  </React.StrictMode>
);
