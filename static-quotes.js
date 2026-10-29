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
  function isTrading(date) {
    const state = marketSession(date);
    return state === 'open' || state === 'pre';
  }

  function storageGet(key) {
    try {
      const value = global.localStorage && global.localStorage.getItem('stock-helper-cache:' + key);
      return value ? JSON.parse(value) : null;
    } catch (_) { return null; }
  }
  function storageSet(key, value) {
    try {
      if (global.localStorage) global.localStorage.setItem('stock-helper-cache:' + key, JSON.stringify(value));
    } catch (_) { /* quota/private mode: in-memory cache still works */ }
  }
  async function loadJson(relativeUrl, force) {
    if (!force && memory.has(relativeUrl) && Date.now() - (memoryAt.get(relativeUrl) || 0) < MEMORY_TTL) return memory.get(relativeUrl);
    const cached = storageGet(relativeUrl);
    try {
      const url = new URL(relativeUrl, document.baseURI).href;
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const value = await response.json();
      memory.set(relativeUrl, value);
      memoryAt.set(relativeUrl, Date.now());
      storageSet(relativeUrl, value);
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

  function weeklyBars(dailyBars) {
    const groups = new Map();
    (dailyBars || []).forEach(bar => {
      if (!bar || !bar.time) return;
      const date = new Date(String(bar.time).slice(0, 10) + 'T00:00:00Z');
      if (Number.isNaN(date.getTime())) return;
      const day = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - day);
      const key = date.toISOString().slice(0, 10);
      let item = groups.get(key);
      if (!item) {
        item = { time: key, open: Number(bar.open), close: Number(bar.close), high: Number(bar.high), low: Number(bar.low), volume: 0 };
        groups.set(key, item);
      }
      item.close = Number(bar.close);
      item.high = Math.max(item.high, Number(bar.high));
      item.low = Math.min(item.low, Number(bar.low));
      if (Number.isFinite(Number(bar.volume))) item.volume += Number(bar.volume);
    });
    return Array.from(groups.values());
  }

  async function loadStockCache(code, force) {
    const file = 'data/stock-cache/' + code + '.json';
    try { return await loadJson(file, force); }
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
        const cache = await loadStockCache(normalized, opts.force);
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
