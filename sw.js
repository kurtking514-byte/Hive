/* Keeps the upload page working offline. Bump CACHE when you change files. */
const CACHE = 'hive-v26';
const TUS = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.1.0/dist/tus.min.js';
const FFLATE = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
const LIBS = [TUS, FFLATE];
/* Fonts and pinned libraries from these hosts are cached the first time they load. */
const CDN = ['https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const CORE = ['./', './index.html', './styles.css', './app.js', './config.js', './manifest.webmanifest', './icon.svg', './doodle.js', './autofill.js', './reviewer.js', './reviewer/lessons.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE);
    await Promise.all(LIBS.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* Own files, pinned libraries and fonts: answer from cache at once, refresh in the background.
   Everything else (Supabase uploads and API calls) goes straight to the network. */
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mine = url.origin === self.location.origin;
  if (!mine && !CDN.includes(url.origin)) return;

  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: mine });
    const fresh = fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    const res = await fresh;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  }));
});
