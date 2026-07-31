const CACHE_NAME = 'pheran-v2';
const STATIC_ASSETS = [
  '/',
  '/shop',
  '/product',
  '/cart',
  '/checkout',
  '/order-confirmed',
  '/custom',
  '/account',
  '/gallery',
  '/support',
  '/policies',
  '/mvp/styles.css',
  '/mvp/script.js',
  '/css/variables.css',
  '/manifest.json',
];

// Install: cache static shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: remove old caches (including pheran-v1 with stale /mvp/*.html entries)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for API/data, cache-first for assets
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Always fetch API calls fresh (no caching)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
      headers: { 'Content-Type': 'application/json' }
    })));
    return;
  }

  // For data.json — network first, fall back to cache
  if (url.pathname.endsWith('data.json')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // For Google Fonts — cache first, network fallback
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, clone));
        return res;
      }))
    );
    return;
  }

  // For everything else — cache first, network fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});

// Background sync: flush any queued session events
self.addEventListener('sync', event => {
  if (event.tag === 'sync-session') {
    event.waitUntil(
      self.registration.sync && fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synced: true, ts: Date.now() })
      }).catch(() => {})
    );
  }
});

// Push notifications
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'PHERAN', {
      body: data.body || 'You have a new update',
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/')
  );
});
