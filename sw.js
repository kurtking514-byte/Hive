/* Keeps the upload page working offline. Bump CACHE when you change files. */
const CACHE = 'hive-v40';
const TUS = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.1.0/dist/tus.min.js';
const FFLATE = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
/* KaTeX draws the math in lessons. Saved up front (with the fonts most math uses) so math
   lessons work offline even if they were never opened with signal. */
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';
const KATEX_FILES = ['katex.min.js', 'katex.min.css', ...['Main-Regular', 'Main-Bold', 'Math-Italic', 'AMS-Regular', 'Size1-Regular', 'Size2-Regular']
  .map(f => `fonts/KaTeX_${f}.woff2`)].map(f => KATEX + f);
const LIBS = [TUS, FFLATE, ...KATEX_FILES];
/* Fonts and pinned libraries from these hosts are cached the first time they load. */
const CDN = ['https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const CORE = ['./', './index.html', './styles.css', './app.js', './config.js', './manifest.webmanifest', './icon.svg', './doodle.js', './autofill.js', './reviewer.js', './pwa.js', './reviewer/lessons.json', './icon-192.png', './apple-touch-icon.png'];

/* Every lesson's notes and quiz, read from lessons.json. */
async function lessonFiles(c) {
  const r = await c.match('./reviewer/lessons.json'); if (!r) return [];
  const list = await r.clone().json().catch(() => []);
  return list.flatMap(l => [l.notes && `./reviewer/notes/${l.id}.txt`, l.quiz && `./reviewer/quiz/${l.id}.json`]).filter(Boolean);
}

/* A new version downloads the whole reviewer before it takes over, so after an update every
   lesson still works offline. A file that can't be downloaded right now is carried over from
   the old version instead of being lost. */
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(LIBS.map(u => c.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    const files = await lessonFiles(c);
    for (let i = 0; i < files.length; i += 6) {
      await Promise.all(files.slice(i, i + 6).map(async u => {
        try {
          const res = await fetch(u, { cache: 'reload' });
          if (res.ok) return c.put(u, res);
        } catch (err) {}
        const old = await caches.match(u, { ignoreSearch: true });
        if (old) await c.put(u, old);
      }));
    }
    // fonts saved by the old version come along too, so text keeps its look offline
    for (const k of await caches.keys()) {
      if (k === CACHE) continue;
      const oc = await caches.open(k);
      for (const req of await oc.keys()) {
        if (CDN.includes(new URL(req.url).origin) && !(await c.match(req))) await c.put(req, await oc.match(req));
      }
    }
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
    // own files always ask GitHub whether they changed, instead of taking the browser's
    // 10-minute copy (an unchanged file costs a tiny "not modified" reply, not a re-download)
    const fresh = fetch(mine ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : req).then(res => {
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
