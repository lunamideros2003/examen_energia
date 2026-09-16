const CACHE_NAME = 'auditoria-cache-v1';
const APP_SHELL = [
  './',
  './index.html'
];

self.addEventListener('install', function (event) {
  console.log('Service worker instalando, guardando app shell');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
});

self.addEventListener('activate', function (event) {
  console.log('Service worker activado');
});

self.addEventListener('fetch', function (event) {
  event.respondWith(
    caches.match(event.request).then(function (cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(function () {
        console.log('Sin red y sin cache para: ' + event.request.url);
        return new Response('Sin conexion', { status: 503 });
      });
    })
  );
});
