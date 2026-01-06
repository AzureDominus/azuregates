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

    const debugLog = (window as any).__debugLog || console.log;
    let mounted = true;

    async function registerServiceWorker() {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          updateViaCache: 'none', // Always fetch SW from network
        });
        
        if (!mounted) return;
        debugLog('SW registered');

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

          debugLog('SW installing...');

          installingWorker.addEventListener('statechange', () => {
            debugLog(`SW state: ${installingWorker.state}`);
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // New update available
                debugLog('SW update available');
                setNewWorker(installingWorker);
                setUpdateAvailable(true);
              } else {
                // First install
                debugLog('SW first install');
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

    // Track if we had a controller when the page loaded
    // If not, this is a first install and we shouldn't reload on controllerchange
    const hadControllerOnLoad = !!navigator.serviceWorker.controller;
    debugLog(`Had controller on load: ${hadControllerOnLoad}`);

    // Listen for controller changes (new SW activated)
    // This is the authoritative signal that a new SW has taken control
    let hasReloaded = false;
    const handleControllerChange = () => {
      debugLog(`controllerchange fired, hadController=${hadControllerOnLoad}, hasReloaded=${hasReloaded}`);
      // Don't reload if:
      // 1. We already reloaded
      // 2. This is first install (no previous controller)
      if (hasReloaded) return;
      if (!hadControllerOnLoad) {
        debugLog('First SW install, skip reload');
        return;
      }
      hasReloaded = true;
      debugLog('Reloading due to SW change...');
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    // Listen for messages from service worker
    // SW_UPDATED is informational - we don't auto-reload here since controllerchange handles it
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SW_UPDATED') {
        debugLog(`SW_UPDATED msg: v${event.data.version}`);
        // Don't reload here - controllerchange event will handle the reload
        // This prevents double-reload issues
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
