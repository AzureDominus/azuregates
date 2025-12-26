/**
 * AzureGates Service Worker
 * Provides offline caching, background sync, and API fallback logic
 */

const APP_NAME = 'AzureGates';
const APP_VERSION = '1.0.2';
const CACHE_NAME = `gates-cache-v${APP_VERSION}`;

// Assets to cache on install
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// API endpoints that should use cache-first strategy
const CACHEABLE_API_PATTERNS = [
  '/api/locations',
  '/api/gates',
  '/api/config',
];

// API endpoints that should never be cached
const NO_CACHE_API_PATTERNS = [
  '/api/auth',
  '/api/guest/redeem',
  '/api/health',
];

/**
 * Install event - cache static assets
 */
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing ${APP_NAME} v${APP_VERSION}`);
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating ${APP_NAME} v${APP_VERSION}`);
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('gates-cache-') && name !== CACHE_NAME)
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'SW_UPDATED',
            version: APP_VERSION,
          });
        });
      });
    })
  );
});

/**
 * Fetch event - network-first with cache fallback for API, cache-first for assets
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (!url.protocol.startsWith('http')) {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (NO_CACHE_API_PATTERNS.some((pattern) => url.pathname.startsWith(pattern))) {
      event.respondWith(networkOnly(request));
      return;
    }

    if (CACHEABLE_API_PATTERNS.some((pattern) => url.pathname.startsWith(pattern))) {
      event.respondWith(networkFirstWithCache(request));
      return;
    }

    event.respondWith(networkOnly(request));
    return;
  }

  event.respondWith(cacheFirstWithNetwork(request, event));
});

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    console.error('[SW] Network request failed:', error);
    return new Response(
      JSON.stringify({ error: 'Network unavailable', offline: true }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_NAME);
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      const headers = new Headers(cachedResponse.headers);
      headers.set('X-From-Cache', 'true');
      return new Response(cachedResponse.body, {
        status: cachedResponse.status,
        statusText: cachedResponse.statusText,
        headers,
      });
    }
    
    return new Response(
      JSON.stringify({ error: 'Network unavailable and no cached data', offline: true }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

async function cacheFirstWithNetwork(request, event) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  
  if (cachedResponse) {
    if (event && event.waitUntil) {
      event.waitUntil(
        fetch(request).then((networkResponse) => {
          if (networkResponse.ok) {
            cache.put(request, networkResponse);
          }
        }).catch(() => {})
      );
    }
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed for:', request.url);
    
    if (request.mode === 'navigate') {
      const cachedIndex = await cache.match('/');
      if (cachedIndex) {
        return cachedIndex;
      }
    }
    
    return new Response('Offline', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'GET_VERSION':
      event.ports[0]?.postMessage({ version: APP_VERSION });
      break;
      
    case 'CLEAR_CACHE':
      caches.delete(CACHE_NAME).then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;
      
    default:
      break;
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || 'Gate activity detected',
    icon: '/icons/icon-192.svg',
    badge: '/icons/icon-192.svg',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
    },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || APP_NAME, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const url = event.notification.data?.url || '/';
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
