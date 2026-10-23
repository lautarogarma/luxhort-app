// Service worker del DEMOSTRADOR. Generado por build_app_demo.py -- no
// editar a mano, se pisa en cada publicacion. Red-primero con la cache como
// respaldo, igual que la app alojada (build_app_nube.py); el nombre de la
// cache lleva el hash de lo publicado, asi cada version borra la anterior.
const C = 'luxh-demo-395e54c8b7';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  // Solo las caches del DEMO: CacheStorage es por origen, no por scope, y el
  // origen es el mismo que el de la app alojada (luxh-remoto-*). Borrarle la
  // cache a ella era dejarla sin respaldo sin red (revisor, 2026-10-23).
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('luxh-demo-') && k !== C).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      const clon = res.clone();
      caches.open(C).then(c => c.put(e.request, clon));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
