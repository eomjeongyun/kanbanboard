const CACHE = 'kanbanboard-shell-v5';
const SHELL = [
  './', './index.html', './style.css', './app.js', './manifest.webmanifest',
  './fonts/YeongdeokSea.woff2',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then(cached => {
      const fresh = fetch(event.request).then(response => {
        if (response.ok) caches.open(CACHE).then(cache => cache.put('./index.html', response.clone()));
        return response;
      }).catch(() => cached);
      event.waitUntil(fresh.then(() => {}).catch(() => {}));
      return cached || fresh;
    }));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok && new URL(event.request.url).origin === location.origin) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  })));
});
