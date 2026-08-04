const CACHE = 'bel-fish-v40';
const PRECACHE = [
  './index.html',
  './app.js',
  './data.js',
  './data_fisher.js',
  './data_guide.js',
  './data_rules.js',
  './data_depths.js',
  './data_uhamap.js',
  './leaflet.js',
  './markercluster.js',
  './leaflet.css',
  './markercluster.css',
  './markercluster-default.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];
const TILE_LIMIT = 900;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (req.url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.match(req).then(hit => {
        if (hit) return hit;
        return fetch(req).then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.keys().then(keys => {
              const tileKeys = keys.filter(k => k.url.includes('tile.openstreetmap.org'));
              const excess = tileKeys.length - (TILE_LIMIT - 1);
              if (excess <= 0) return null;
              return Promise.all(tileKeys.slice(0, excess).map(k => c.delete(k)));
            }).then(() => c.put(req, copy)));
          }
          return res;
        }).catch(() => Response.error());
      })
    );
    return;
  }

  if (req.url.includes('/index.html') || req.url.includes('/') && req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match('./index.html').then(fb => fb || caches.match('./').then(f => f || Response.error())))
    );
    return;
  }

  const staticFile = req.url.includes('app.js') || req.url.includes('data.js') ||
    req.url.includes('data_fisher.js') || req.url.includes('data_guide.js') ||
    req.url.includes('data_rules.js') || req.url.includes('data_depths.js') ||
    req.url.includes('data_uhamap.js') ||
    req.url.includes('leaflet.js') ||
    req.url.includes('markercluster.js') || req.url.includes('.css') ||
    req.url.includes('manifest.webmanifest') ||
    req.url.includes('icon-') || req.url.includes('apple-touch-icon');
  if (staticFile) {
    e.respondWith(
      caches.match(req).then(hit => {
        const update = fetch(req).then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        }).catch(() => Response.error());
        return hit ? Promise.all([hit, update]).then(a => a[0]) : update;
      })
    );
    return;
  }

  if (req.url.includes('api.open-meteo.com') || req.url.includes('nominatim.openstreetmap.org')) {
    e.respondWith(
      Promise.race([
        fetch(req),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
      ]).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req).then(hit => hit || Response.error()))
    );
    return;
  }
});
