/* In Search of Pink: keeps the app working with no signal. Bump VERSION when the app files change. */
var VERSION = 'pink-v3';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-64.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Fonts: keep a copy after the first load.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(VERSION).then(function (c) {
        return c.match(req).then(function (hit) {
          return hit || fetch(req).then(function (res) { c.put(req, res.clone()); return res; });
        });
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // App files: answer from the phone right away, refresh the copy in the background.
  event.respondWith(
    caches.open(VERSION).then(function (c) {
      var key = req.mode === 'navigate' ? './index.html' : req;
      return c.match(key).then(function (hit) {
        var refresh = fetch(req).then(function (res) {
          if (res && res.ok) c.put(key, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || refresh;
      });
    })
  );
});
