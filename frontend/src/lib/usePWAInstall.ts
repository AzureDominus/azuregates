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
 */
export function useServiceWorker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Register service worker
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        setRegistration(reg);
        console.log('[App] Service worker registered');

        // Check for updates periodically
        setInterval(() => {
          reg.update();
        }, 60 * 60 * 1000); // Check every hour
      }).catch((error) => {
        console.error('[App] Service worker registration failed:', error);
      });

      // Listen for controller change (new SW activated)
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Reload the page when new SW takes control
        window.location.reload();
      });

      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'SW_UPDATED') {
          console.log('[App] Service worker updated to:', event.data.version);
          setUpdateAvailable(true);
        }
      });
    }
  }, []);

  const applyUpdate = useCallback(() => {
    if (registration?.waiting) {
      // Tell the waiting SW to skip waiting
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }, [registration]);

  return {
    updateAvailable,
    applyUpdate,
  };
}
