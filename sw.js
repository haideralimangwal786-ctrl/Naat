const CACHE_NAME = 'naat-player-v1';
const ASSETS = [
  './',
  './index.html',
  './css/index.css',
  './js/index.js',
  './favicon.png',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/remixicon@4.9.0/fonts/remixicon.css'
];

// Install: Cache all assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Activate: Clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    })
  );
});

// Fetch: Serve from cache, then network
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});
