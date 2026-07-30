const CACHE_NAME = 'pheran-v1';
const STATIC_ASSETS = [
  '/mvp/homepage.html',
  '/mvp/category.html',
  '/mvp/product.html',
  '/mvp/cart.html',
  '/mvp/checkout.html',
  '/mvp/confirmation.html',
  '/mvp/custom.html',
  '/mvp/account.html',
  '/mvp/gallery.html',
  '/mvp/support.html',
  '/mvp/about.html',
  '/mvp/policies.html',
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

// Activate: remove old caches
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
        // Cache successful responses for same-origin requests
        if (res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/mvp/homepage.html');
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

// Push notifications (future)
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'PHERAN', {
      body: data.body || 'You have a new update',
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      data: { url: data.url || '/mvp/homepage.html' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data?.url || '/mvp/homepage.html')
  );
});
