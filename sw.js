/* オフラインでも画面が開けるようにアプリ本体をキャッシュする。
   ※ 音声認識そのものはブラウザ側のサービスなのでネット接続が必要。 */
const VERSION = 'honyaku-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './css/style.css', './js/app.js', './js/transcript.js', './icons/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

// ネット優先・失敗したらキャッシュ（更新がすぐ反映されるように）
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    try {
      const res = await fetch(request);
      if (res.ok) (await caches.open(VERSION)).put(request, res.clone());
      return res;
    } catch {
      return (await caches.match(request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
