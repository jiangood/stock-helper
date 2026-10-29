/*!
 * StaticQuotes SDK — browser-only same-origin cached market data.
 * External market providers are called only by GitHub Actions collector.
 */
(function (global) {
  'use strict';

  const REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
  const QUOTES_URL = 'data/stock-quotes.json';
  const INDEX_URL = 'data/index-cache.json';
  const INDEX_CODES = new Set(['sh000001', 'sz399001', 'sz399006']);
  const memory = new Map();
  const memoryAt = new Map();
  const MEMORY_TTL = 6 * 60 * 60 * 1000;
  const MAX_BACKGROUND_REFRESHES = 4;
  const refreshQueue = [];
  const refreshingUrls = new Set();
  let activeRefreshes = 0;

  function normalizeCode(code) {
    if (code === null || code === undefined) return null;
    const value = String(code).trim().toLowerCase().replace(/\s+/g, '');
    if (/^(sh|sz)\d{6}$/.test(value)) return value;
    if (/^\d{6}$/.test(value)) return (/^[5689]/.test(value) ? 'sh' : 'sz') + value;
    return null;
  }

  function marketSession(date) {
    const d = date instanceof Date ? date : new Date();
    const day = d.getDay();
    if (day === 0 || day === 6) return 'holiday';
    const minutes = d.getHours() * 60 + d.getMinutes();
    if (minutes < 540) return 'closed';
    if (minutes < 570) return 'pre';
    if (minutes <= 690) return 'open';
    if (minutes < 780) return 'lunch';
    if (minutes <= 900) return 'open';
    return 'closed';
  }
  // Static snapshots update through Actions once per day; never poll market data in the browser.
  function isTrading() { return false; }

  function storageGet(key) {
    try {
      const value = global.localStorage && global.localStorage.getItem('stock-helper-cache:' + key);
      return value ? JSON.parse(value) : null;
    } catch (_) { return null; }
  }
  function storageSet(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem('stock-helper-cache:' + key, JSON.stringify(value));
    } catch (_) { /* large history files may exceed localStorage quota */ }
  }
  // Keep one IndexedDB connection per page. Reopening/closing it for every
  // stock and K-line read adds avoidable latency on detail and combat pages.
  let indexedDbPromise = null;
  function openIndexedDb() {
    if (!global.indexedDB) return Promise.resolve(null);
    if (indexedDbPromise) return indexedDbPromise;
    indexedDbPromise = new Promise(resolve => {
      let request;
      try { request = global.indexedDB.open('stock-helper-static-cache', 1); }
      catch (_) { indexedDbPromise = null; return resolve(null); }
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains('snapshots')) {
            request.result.createObjectStore('snapshots');
          }
        } catch (_) {}
      };
      request.onerror = () => { indexedDbPromise = null; resolve(null); };
      request.onblocked = () => { indexedDbPromise = null; resolve(null); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try { db.close(); } catch (_) {}
          indexedDbPromise = null;
        };
        resolve(db);
      };
    });
    return indexedDbPromise;
  }
  async function indexedDbGet(key) {
    const db = await openIndexedDb();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx = db.transaction('snapshots', 'readonly');
        const get = tx.objectStore('snapshots').get(key);
        let value = null;
        get.onsuccess = () => { value = get.result || null; };
        get.onerror = () => resolve(null);
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  async function indexedDbSet(key, value) {
    const db = await openIndexedDb();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }
  async function cacheGet(key) {
    const indexed = await indexedDbGet(key);
    return indexed || storageGet(key);
  }
  async function cacheSet(key, value) {
    const saved = await indexedDbSet(key, value);
    if (!saved) storageSet(key, value);
  }
  async function fetchJson(relativeUrl) {
    const url = new URL(relativeUrl, document.baseURI).href;
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  function pumpRefreshQueue() {
    while (activeRefreshes < MAX_BACKGROUND_REFRESHES && refreshQueue.length) {
      const relativeUrl = refreshQueue.shift();
      activeRefreshes += 1;
      fetchJson(relativeUrl)
        .then(async value => {
          memory.set(relativeUrl, value);
          memoryAt.set(relativeUrl, Date.now());
          await cacheSet(relativeUrl, value);
        })
        .catch(() => { /* 保留上次有效缓存；后台刷新失败不影响当前结果 */ })
        .finally(() => {
          activeRefreshes -= 1;
          refreshingUrls.delete(relativeUrl);
          pumpRefreshQueue();
        });
    }
  }

  function scheduleRefresh(relativeUrl) {
    if (refreshingUrls.has(relativeUrl)) return;
    refreshingUrls.add(relativeUrl);
    refreshQueue.push(relativeUrl);
    pumpRefreshQueue();
  }

  async function loadJson(relativeUrl, force, cacheFirst) {
    if (!force && memory.has(relativeUrl) && Date.now() - (memoryAt.get(relativeUrl) || 0) < MEMORY_TTL) return memory.get(relativeUrl);
    const cached = await cacheGet(relativeUrl);

    // K 线计算优先使用本机最近一次成功缓存，避免每只股票都等待网络响应。
    // 后台刷新有并发上限；刷新失败不会覆盖或清空旧缓存。
    if (!force && cacheFirst && cached) {
      memory.set(relativeUrl, cached);
      memoryAt.set(relativeUrl, Date.now());
      scheduleRefresh(relativeUrl);
      return cached;
    }

    try {
      const value = await fetchJson(relativeUrl);
      memory.set(relativeUrl, value);
      memoryAt.set(relativeUrl, Date.now());
      await cacheSet(relativeUrl, value);
      return value;
    } catch (error) {
      if (cached) {
        memory.set(relativeUrl, cached);
        memoryAt.set(relativeUrl, Date.now());
        return cached;
      }
      throw new Error('静态行情缓存不可用，且本机没有上次有效缓存：' + error.message);
    }
  }

  async function loadStockCache(code, force, cacheFirst) {
    const file = 'data/stock-cache/' + code + '.json';
    try { return await loadJson(file, force, cacheFirst); }
    catch (error) { throw new Error(code + ' 不在当前静态缓存范围内或缓存暂不可用。为避免浏览器直接访问外部行情接口，未进行实时回源。'); }
  }

  class Client {
    constructor(options) { this.options = options || {}; }
    async fetch(codes, options) {
      const payload = await loadJson(QUOTES_URL, options && options.force);
      const result = {};
      (codes || []).map(normalizeCode).filter(Boolean).forEach(code => {
        if (payload.quotes && payload.quotes[code]) result[code] = payload.quotes[code];
      });
      if (!Object.keys(result).length) throw new Error('静态行情缓存中没有请求的股票代码。');
      return result;
    }
    async fetchOne(code) {
      const result = await this.fetch([code]);
      return result[normalizeCode(code)] || null;
    }
    async fetchDetail(code, options) {
      const normalized = normalizeCode(code);
      if (!normalized) throw new Error('无效的股票代码');
      const cache = await loadStockCache(normalized, options && options.force);
      if (cache.detail && Number(cache.detail.price) > 0) return cache.detail;
      const quote = await this.fetch([normalized], options).catch(() => ({}));
      if (quote[normalized]) return quote[normalized];
      throw new Error('静态缓存中没有该股票的有效详情数据。');
    }
    async fetchKline(code, options) {
      const normalized = normalizeCode(code);
      if (!normalized) throw new Error('无效的股票代码');
      const opts = options || {};
      const period = ['day', 'week', 'month'].includes(opts.period) ? opts.period : 'day';
      const adjust = opts.adjust === 'none' || opts.adjust === '' ? 'none' : (opts.adjust === 'hfq' ? 'hfq' : 'qfq');
      let bars = [];
      if (INDEX_CODES.has(normalized)) {
        if (period === 'month') {
          const indexes = await loadJson(INDEX_URL, opts.force);
          const cached = indexes.monthly && indexes.monthly[normalized];
          bars = cached && Array.isArray(cached.bars) ? cached.bars : [];
        }
      } else {
        const cache = await loadStockCache(normalized, opts.force, true);
        if (period === 'day') {
          const value = adjust === 'none' ? cache.dailyRaw : cache.dailyAdjusted;
          bars = value && Array.isArray(value.bars) ? value.bars : [];
        } else if (period === 'month') {
          bars = cache.monthlyAdjusted && Array.isArray(cache.monthlyAdjusted.bars) ? cache.monthlyAdjusted.bars : [];
        } else {
          const value = cache.weeklyAdjusted;
          bars = value && Array.isArray(value.bars) ? value.bars : [];
        }
      }
      const count = Math.min(1000, Math.max(10, Number(opts.count) || 180));
      bars = bars.slice(-count);
      if (!bars.length) throw new Error('静态缓存中没有 ' + period + ' K 线数据。');
      return { code: normalized, period, adjust, bars };
    }
  }

  global.StockQuotes = {
    VERSION: 'static-1.0.0',
    REFRESH_INTERVAL,
    Client,
    normalizeCode,
    marketSession,
    isTrading,
    async snapshotInfo() {
      try {
        const data = await loadJson(QUOTES_URL);
        return { updatedAt: data.updatedAt || null, marketDate: data.marketDate || null, status: data.status || 'unknown', source: data.source || 'static cache' };
      } catch (_) { return { status: 'unavailable' }; }
    }
  };
})(window);
