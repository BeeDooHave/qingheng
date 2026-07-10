// 轻衡 Service Worker — app-shell offline caching
const CACHE = 'qingheng-v34';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './fonts/qh-num-500.woff2',
  './fonts/qh-num-700.woff2',
  './vendor/confetti.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for our own app shell: always try the dev server for the
// freshest code, update the cache, and fall back to cache only when offline.
// This keeps the home-screen PWA auto-updating (open the app → latest code),
// no manual refresh needed. Cross-origin requests (e.g. the GitHub Gist API)
// are left untouched so they always hit the live network — never cached.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // don't touch api.github.com etc.
  e.respondWith(
    // cache:'no-cache' → always revalidate with the dev server, bypassing the
    // browser HTTP cache, so code/style edits actually show up on next open.
    fetch(request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
