const CACHE_NAME = 'tieng-han-hdv-v7.0.0';
const OFFLINE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './phrases.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys
      .filter(key => key !== CACHE_NAME)
      .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Network-first cho app.js và styles.css để luôn nhận code mới nhất
  const url = new URL(event.request.url);
  const isCore = url.pathname.endsWith('app.js') || url.pathname.endsWith('styles.css') || url.pathname.endsWith('index.html');

  if (isCore) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first cho icon, phrases, manifest
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(networkResponse => {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
