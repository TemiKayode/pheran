// One-time cleanup: this project has never shipped a service worker. Any
// registration found here is stale, left over from a previous deployment,
// and can silently serve outdated cached pages (including cached admin
// pages from before an auth fix). Unregister it and clear its caches.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister())
  }).catch(()=>{})
}
if ('caches' in window) {
  caches.keys().then(keys => {
    keys.forEach(key => caches.delete(key))
  }).catch(()=>{})
}
