// This project intentionally ships no service worker (see mvp/kill-sw.js) — a
// previous version of this file cached opaque 206 Partial Content responses via
// Cache.put(), which throws, and broke admin image uploads in production.
// Nothing should register this URL anymore, but the file is kept in place as a
// safety net: a browser holding a stale registration from before this change
// will still fetch this exact file, so it self-unregisters and clears its
// caches immediately instead of running the old broken logic.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.registration.unregister(),
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))),
    ]).then(() => self.clients.matchAll({ type: 'window' })).then(clients => {
      clients.forEach(client => client.navigate(client.url))
    })
  )
})
