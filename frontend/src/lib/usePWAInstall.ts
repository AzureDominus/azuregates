import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PWAInstallState {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  promptInstall: () => Promise<boolean>;
  dismissPrompt: () => void;
  showPrompt: boolean;
}

const INSTALL_DISMISSED_KEY = 'pwa-install-dismissed';
const INSTALL_DISMISSED_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Hook for managing PWA install prompt
 */
export function usePWAInstall(): PWAInstallState {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  // Check if running on iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

  // Check if already installed as PWA
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                         (navigator as any).standalone === true;
    setIsInstalled(isStandalone);
  }, []);

  // Listen for the beforeinstallprompt event
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
      
      // Check if user has dismissed the prompt recently
      const dismissedAt = localStorage.getItem(INSTALL_DISMISSED_KEY);
      if (dismissedAt) {
        const dismissedTime = parseInt(dismissedAt, 10);
        if (Date.now() - dismissedTime < INSTALL_DISMISSED_DURATION) {
          return; // Don't show prompt if dismissed recently
        }
      }
      
      // Show the prompt after a short delay
      setTimeout(() => {
        setShowPrompt(true);
      }, 3000); // Wait 3 seconds before showing
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Listen for app installed event
  useEffect(() => {
    const handler = () => {
      setIsInstalled(true);
      setShowPrompt(false);
      setInstallPrompt(null);
    };

    window.addEventListener('appinstalled', handler);
    return () => window.removeEventListener('appinstalled', handler);
  }, []);

  const promptInstall = useCallback(async (): Promise<boolean> => {
    if (!installPrompt) {
      return false;
    }

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setShowPrompt(false);
        return true;
      } else {
        // User dismissed, remember for 7 days
        localStorage.setItem(INSTALL_DISMISSED_KEY, Date.now().toString());
        setShowPrompt(false);
        return false;
      }
    } catch (error) {
      console.error('Error prompting PWA install:', error);
      return false;
    } finally {
      setInstallPrompt(null);
    }
  }, [installPrompt]);

  const dismissPrompt = useCallback(() => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, Date.now().toString());
    setShowPrompt(false);
  }, []);

  return {
    isInstallable: !!installPrompt,
    isInstalled,
    isIOS,
    promptInstall,
    dismissPrompt,
    showPrompt: showPrompt && !isInstalled && !!installPrompt,
  };
}

/**
 * Hook for managing service worker updates
 * Implements proper update lifecycle similar to Vercel/modern PWAs:
 * - Checks for updates on mount and periodically
 * - Listens for new service worker installation
 * - Provides method to apply updates (skipWaiting + reload)
 */
export function useServiceWorker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [newWorker, setNewWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let mounted = true;

    async function registerServiceWorker() {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          updateViaCache: 'none', // Always fetch SW from network
        });
        
        if (!mounted) return;
        console.log('[App] Service worker registered');

        // Check for updates immediately
        reg.update().catch(console.error);

        // Check for updates periodically (every 5 minutes in production)
        const updateInterval = setInterval(() => {
          reg.update().catch(console.error);
        }, 5 * 60 * 1000);

        // Handle new service worker installing
        const handleUpdateFound = () => {
          const installingWorker = reg.installing;
          if (!installingWorker) return;

          console.log('[App] New service worker installing...');

          installingWorker.addEventListener('statechange', () => {
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // New update available
                console.log('[App] New update available');
                setNewWorker(installingWorker);
                setUpdateAvailable(true);
              } else {
                // First install
                console.log('[App] Service worker installed for the first time');
              }
            }
          });
        };

        reg.addEventListener('updatefound', handleUpdateFound);

        // If there's already a waiting worker, it means an update was ready
        if (reg.waiting) {
          setNewWorker(reg.waiting);
          setUpdateAvailable(true);
        }

        return () => {
          clearInterval(updateInterval);
          reg.removeEventListener('updatefound', handleUpdateFound);
        };
      } catch (error) {
        console.error('[App] Service worker registration failed:', error);
      }
    }

    // Listen for controller changes (new SW activated)
    const handleControllerChange = () => {
      console.log('[App] Service worker controller changed, reloading...');
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    // Listen for messages from service worker
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        console.log('[App] Service worker updated to:', event.data.version);
        // If we get this message, the new SW is already active
        // Reload to get the new version
        window.location.reload();
      }
    };

    navigator.serviceWorker.addEventListener('message', handleMessage);

    registerServiceWorker();

    return () => {
      mounted = false;
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!newWorker) return;
    
    console.log('[App] Applying update...');
    // Tell the waiting SW to skip waiting and take over
    newWorker.postMessage({ type: 'SKIP_WAITING' });
  }, [newWorker]);

  return {
    updateAvailable,
    applyUpdate,
  };
}
