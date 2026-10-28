/* Stock Helper offline-first service worker. */
'use strict';
const CACHE_VERSION = 'stock-helper-v4';
const APP_CACHE = CACHE_VERSION + '-app';
const DATA_CACHE = CACHE_VERSION + '-data';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';
const CORE_ASSETS = [
  './',
  './index.html',
  './stock.html',
  './manifest.webmanifest',
  './icon.svg',
  './data/stocks.json',
  './data/holdings.json',
  './data/business-data.json',
  './croc.js',
  './indicators.js',
  './pinyin.js',
  './quotes.js',
  './holdings-data.js',
  './business.js',
  './risk-center.js',
  './stock.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(CORE_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key =>
      key.startsWith('stock-helper-') &&
      ![APP_CACHE, DATA_CACHE, RUNTIME_CACHE].includes(key)
    ).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const update = fetch(request).then(response => {
    if (response && (response.ok || response.type === 'opaque')) {
      cache.put(request, response.clone());
    }
    return response;
  });
  if (cached) {
    update.catch(() => {});
    return cached;
  }
  return update;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Keep cross-origin CDN dependencies available after their first successful load.
  if (url.origin !== self.location.origin) {
    if (request.destination === 'style' || request.destination === 'script' ||
        request.destination === 'font' || request.destination === 'image') {
      event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE).catch(() =>
        new Response('', {status: 503, statusText: 'Offline asset unavailable'})
      ));
    }
    return;
  }

  const path = url.pathname;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, APP_CACHE).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const isDetail = /\/stock\.html$/.test(path);
      return (await caches.match(isDetail ? './stock.html' : './index.html')) ||
        new Response('当前离线且应用尚未缓存，请联网打开一次后再试。', {
          status: 503, headers: {'Content-Type':'text/plain; charset=utf-8'}
        });
    }));
    return;
  }

  if (/\.(json)$/.test(path)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE).catch(async () =>
      (await caches.match(request)) || new Response('{}', {
        status: 503, headers: {'Content-Type':'application/json; charset=utf-8'}
      })
    ));
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      fetch(request).then(response => {
        if (response && response.ok) caches.open(APP_CACHE).then(cache => cache.put(request, response));
      }).catch(() => {});
      return cached;
    }
    return networkFirst(request, APP_CACHE);
  })().catch(() => new Response('离线资源暂不可用', {
    status: 503, headers: {'Content-Type':'text/plain; charset=utf-8'}
  })));
});
