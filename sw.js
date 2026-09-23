// Service worker de la copia ALOJADA. Generado por build_app_nube.py -- no
// editar a mano, se pisa en cada publicacion.
//
// Estrategia red-primero con la cache como respaldo, igual que el equipo
// (ver el comentario en WebPortal.cpp junto a /sw.js): un telefono que
// abrio la app una vez no puede quedar pegado a esa version para siempre.
//
// El nombre de la cache trae un hash del contenido publicado ESTE momento
// (build_app_nube.py lo calcula), asi que cada publicacion nueva tiene su
// propio nombre y activate() borra las viejas solo -- sin depender de que
// alguien suba un numero a mano.
const C = 'luxh-remoto-7906a15144';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Solo lo PROPIO. Supabase vive en otro origen y nunca pasa por aca:
  // cachear una respuesta de autenticacion o de un RPC seria mostrar un
  // estado viejo del equipo como si fuera el de ahora.
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
