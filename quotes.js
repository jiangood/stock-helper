/*!
 * StockQuotes SDK v1.1.0
 * ---------------------------------------------------------------------------
 * 股票行情 SDK —— A 股实时行情聚合封装（浏览器 / Node 通用，无依赖）
 *
 * 数据源（自动降级，取到数据即止）
 *   1) eastmoney  东方财富 push2 批量接口（JSON，支持跨域）
 *   2) tencent    腾讯财经 qt.gtimg.cn 批量接口（GBK，支持跨域）
 *
 * 特性
 *   · 批量拉取（自动分片，单次默认 60 只）、单只拉取
 *   · 代码格式宽容：'002408' / 'sz002408' / 'SZ002408'
 *   · 多源 + 多域名自动降级，单个源缺数据时用下一个源补齐
 *   · 超时、重试、内置短时缓存、外部 AbortSignal 取消
 *   · A 股交易时段判断（供自动刷新调度使用）
 *   · 结构化错误（QuoteError，带 code）
 *
 * 快速开始
 *   const quotes = new StockQuotes.Client({ timeout: 8000, cacheTTL: 1000 });
 *   const data = await quotes.fetch(['sz002408', '600519']);
 *   // data = { sz002408: { code, name, price, prevClose, change, todayChange, time }, ... }
 *
 * 交易时段
 *   StockQuotes.marketSession()   // 'holiday' | 'closed' | 'pre' | 'open' | 'lunch'
 *   StockQuotes.isTrading()       // 是否处于需要实时刷新的时段
 *   StockQuotes.REFRESH_INTERVAL  // 交易时段建议刷新间隔（毫秒）
 * ---------------------------------------------------------------------------
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.StockQuotes = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const VERSION = '1.1.0';
  const REFRESH_INTERVAL = 3000;

  const DEFAULTS = {
    providers: ['eastmoney', 'tencent'],  // 依次尝试
    chunkSize: 60,                        // 每次请求最多多少只
    timeout: 8000,                        // 单次请求超时（ms）
    retries: 1,                           // 单次请求重试次数
    cacheTTL: 0,                          // 结果缓存（ms），0 = 不缓存
    providerBackoff: 30000,               // 某个源整体失败后，暂停使用多久（ms）
    onError: null                         // (QuoteError) => void
  };

  const HOSTS = {
    eastmoney: ['push2delay.eastmoney.com', 'push2.eastmoney.com'],
    tencent: ['qt.gtimg.cn']
  };

  /* ────────────────────────── 错误 ────────────────────────── */

  class QuoteError extends Error {
    /**
     * @param {string} message
     * @param {'TIMEOUT'|'HTTP'|'NETWORK'|'PARSE'|'ABORTED'|'UNAVAILABLE'} code
     * @param {Error} [cause]
     */
    constructor(message, code, cause) {
      super(message);
      this.name = 'QuoteError';
      this.code = code;
      this.cause = cause || null;
    }
  }

  /* ────────────────────────── 代码工具 ────────────────────────── */

  /** '600519' | 'SH600519' -> 'sh600519' */
  function normalizeCode(code) {
    if (code === null || code === undefined) return null;
    const c = String(code).trim().toLowerCase().replace(/\s+/g, '');
    if (/^(sh|sz)\d{6}$/.test(c)) return c;
    if (/^\d{6}$/.test(c)) return (/^[5689]/.test(c) ? 'sh' : 'sz') + c;
    return null;
  }

  /** 'sh600519' -> '1.600519' */
  function toSecId(code) {
    const c = normalizeCode(code);
    return c ? (c.startsWith('sh') ? '1.' : '0.') + c.slice(2) : null;
  }

  /** '1.600519' -> 'sh600519' */
  function fromSecId(secid) {
    const m = /^([01])\.(\d{6})$/.exec(String(secid || ''));
    return m ? (m[1] === '1' ? 'sh' : 'sz') + m[2] : null;
  }

  const num = v => {
    if (v === null || v === undefined || v === '' || v === '-') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  /* ────────────────────────── 解析器 ────────────────────────── */

  /** 东方财富 ulist.np JSON -> 行情映射 */
  function parseEastmoney(json) {
    const out = {};
    const diff = json && json.data && json.data.diff;
    if (!diff) return out;
    const list = Array.isArray(diff) ? diff : Object.values(diff);
    for (const item of list) {
      if (!item) continue;
      const price = num(item.f2);
      if (price === null || price <= 0) continue;
      const code = fromSecId(item.f12) || normalizeCode(item.f12);
      if (!code) continue;
      out[code] = build(code, price, num(item.f18), num(item.f4), num(item.f3), null);
    }
    return out;
  }

  /** 腾讯 qt.gtimg.cn 文本 -> 行情映射
   *  v_sz002408="51~名称~002408~最新价~昨收~今开~...~时间~涨跌~涨跌幅~..."
   */
  function parseTencent(text) {
    const out = {};
    if (!text) return out;
    const re = /v_([a-z]{2}\d{6})="([^"]*)"/g;
    let m;
    while ((m = re.exec(text))) {
      const code = m[1];
      const f = m[2].split('~');
      if (f.length < 33) continue;
      const price = num(f[3]);
      if (price === null || price <= 0) continue;
      out[code] = build(code, price, num(f[4]), num(f[31]), num(f[32]), f[1]);
    }
    return out;
  }

  function build(code, price, prevClose, change, todayChange, name) {
    if (todayChange === null && prevClose && prevClose > 0) {
      todayChange = (price - prevClose) / prevClose * 100;
    }
    return { code, name: name || null, price, prevClose, change, todayChange, time: Date.now() };
  }

  /* ────────────────────────── 交易时段 ────────────────────────── */

  /**
   * A 股交易时段
   * @param {Date} [date]
   * @returns {'holiday'|'closed'|'pre'|'open'|'lunch'}
   */
  function marketSession(date) {
    const d = date instanceof Date ? date : new Date();
    const day = d.getDay();
    if (day === 0 || day === 6) return 'holiday';
    const t = d.getHours() * 60 + d.getMinutes();
    if (t < 9 * 60 + 15) return 'closed';
    if (t < 9 * 60 + 30) return 'pre';
    if (t <= 11 * 60 + 30) return 'open';
    if (t < 13 * 60) return 'lunch';
    if (t <= 15 * 60) return 'open';
    return 'closed';
  }

  /** 是否处于需要实时刷新的时段 */
  function isTrading(date) {
    const s = marketSession(date);
    return s === 'open' || s === 'pre';
  }

  /* ────────────────────────── 数据源 ────────────────────────── */

  const PROVIDERS = {
    /* 东方财富：JSON，批量 */
    eastmoney: {
      id: 'eastmoney',
      hosts: HOSTS.eastmoney,
      async fetch(codes, ctx) {
        const secids = codes.map(toSecId).filter(Boolean).join(',');
        const path = `/api/qt/ulist.np/get?fltt=2&secids=${secids}`
                   + `&fields=f2,f3,f4,f12,f18&_=${Date.now()}`;
        const json = await requestJSON(this.hosts, path, ctx);
        return parseEastmoney(json);
      }
    },

    /* 腾讯财经：GBK 文本，批量，作为备用 */
    tencent: {
      id: 'tencent',
      hosts: HOSTS.tencent,
      async fetch(codes, ctx) {
        const path = `/q=${codes.join(',')}&_=${Date.now()}`;
        const text = await requestText(this.hosts, path, ctx, 'gbk');
        return parseTencent(text);
      }
    }
  };

  async function requestJSON(hosts, path, ctx) {
    const text = await requestText(hosts, path, ctx, 'utf-8');
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new QuoteError('行情数据解析失败', 'PARSE', e);
    }
  }

  async function requestText(hosts, path, ctx, encoding) {
    let lastErr = null;
    for (const host of hosts) {
      for (let attempt = 0; attempt <= ctx.retries; attempt++) {
        try {
          const buf = await requestBuffer(host, path, ctx);
          return new TextDecoder(encoding || 'utf-8').decode(buf);
        } catch (e) {
          if (e.code === 'ABORTED') throw e;
          lastErr = e;
        }
      }
    }
    throw lastErr || new QuoteError('行情接口不可用', 'UNAVAILABLE');
  }

  async function requestBuffer(host, path, ctx) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ctx.timeout);
    const onAbort = () => controller.abort();

    if (ctx.signal) {
      if (ctx.signal.aborted) { clearTimeout(timer); throw new QuoteError('请求已取消', 'ABORTED'); }
      ctx.signal.addEventListener('abort', onAbort, { once: true });
    }

    ctx.stats.requests++;

    try {
      const res = await fetch(`https://${host}${path}`, {
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit'
      });
      if (!res.ok) throw new QuoteError(`HTTP ${res.status} (${host})`, 'HTTP');
      return await res.arrayBuffer();
    } catch (e) {
      if (e instanceof QuoteError) throw e;
      if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) {
        if (ctx.signal && ctx.signal.aborted) throw new QuoteError('请求已取消', 'ABORTED');
        throw new QuoteError(`请求超时 (${host})`, 'TIMEOUT');
      }
      throw new QuoteError(`网络错误 (${host}): ${e && e.message}`, 'NETWORK', e);
    } finally {
      clearTimeout(timer);
      if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
    }
  }

  /* ────────────────────────── Client ────────────────────────── */

  class Client {
    /**
     * @param {object} [options] 见 DEFAULTS
     */
    constructor(options) {
      this.options = Object.assign({}, DEFAULTS, options || {});
      this._cache = new Map();
      this._downUntil = {};            // providerId -> 时间戳，失败后短暂停用
      this.lastError = null;
      this.stats = { requests: 0, failures: 0, lastAt: null };
    }

    /** 单只行情，未取到返回 null */
    async fetchOne(code, opts) {
      const c = normalizeCode(code);
      if (!c) throw new QuoteError('无效的股票代码: ' + code, 'PARSE');
      const data = await this.fetch([c], opts);
      return data[c] || null;
    }

    /**
     * 批量拉取行情
     * @param {Array<string|number>} codes
     * @param {object} [opts]
     * @param {AbortSignal} [opts.signal]
     * @param {boolean} [opts.force] 跳过缓存
     * @returns {Promise<Object<string, {code:string, name:string|null, price:number,
     *           prevClose:number|null, change:number|null, todayChange:number|null}>>}
     */
    async fetch(codes, opts) {
      const o = opts || {};
      const list = Array.from(new Set((codes || []).map(normalizeCode).filter(Boolean)));
      if (!list.length) return {};

      const key = list.join(',');
      const cached = this._readCache(key, o.force);
      if (cached) return cached;

      const ctx = {
        timeout: this.options.timeout,
        retries: Math.max(0, this.options.retries | 0),
        signal: o.signal || null,
        stats: this.stats
      };

      const chunks = chunk(list, Math.max(1, this.options.chunkSize | 0));
      const results = await Promise.all(chunks.map(c => this._fetchChunk(c, ctx)));

      const data = Object.assign({}, ...results);
      if (!Object.keys(data).length) {
        const err = this.lastError || new QuoteError('所有行情源均不可用', 'UNAVAILABLE');
        if (typeof this.options.onError === 'function') {
          try { this.options.onError(err); } catch (_) { /* ignore */ }
        }
        throw err;
      }

      this.lastError = null;
      this.stats.lastAt = Date.now();
      this._writeCache(key, data);
      return data;
    }

    clearCache() { this._cache.clear(); }

    /* 单个分片：按数据源顺序尝试，缺的代码交给下一个源补 */
    async _fetchChunk(codes, ctx) {
      const missing = new Set(codes);
      const out = {};

      for (const id of this.options.providers) {
        if (!missing.size) break;
        const provider = PROVIDERS[id];
        if (!provider) continue;
        if (Date.now() < (this._downUntil[id] || 0)) continue;   // 该源刚失败过，暂时跳过

        try {
          const map = await provider.fetch(Array.from(missing), ctx);
          Object.keys(map).forEach(code => {
            if (missing.has(code)) {
              out[code] = map[code];
              missing.delete(code);
            }
          });
          this._downUntil[id] = 0;
        } catch (e) {
          if (e && e.code === 'ABORTED') throw e;
          this.stats.failures++;
          this.lastError = e;
          this._downUntil[id] = Date.now() + (this.options.providerBackoff || 0);
        }
      }
      return out;
    }

    _readCache(key, force) {
      const ttl = this.options.cacheTTL || 0;
      if (force || ttl <= 0) return null;
      const hit = this._cache.get(key);
      return hit && Date.now() - hit.at < ttl ? hit.data : null;
    }

    _writeCache(key, data) {
      const ttl = this.options.cacheTTL || 0;
      if (ttl <= 0) return;
      this._cache.set(key, { at: Date.now(), data });
      if (this._cache.size > 50) this._cache.delete(this._cache.keys().next().value);
    }
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /* ────────────────────────── 导出 ────────────────────────── */

  const defaultClient = new Client({ cacheTTL: 1000 });

  return {
    VERSION,
    Client,
    QuoteError,
    DEFAULTS,
    REFRESH_INTERVAL,
    PROVIDERS,
    normalizeCode,
    toSecId,
    fromSecId,
    parseEastmoney,
    parseTencent,
    marketSession,
    isTrading,
    fetch: (codes, opts) => defaultClient.fetch(codes, opts),
    fetchOne: (code, opts) => defaultClient.fetchOne(code, opts),
    clearCache: () => defaultClient.clearCache(),
    get lastError() { return defaultClient.lastError; },
    get stats() { return defaultClient.stats; }
  };
});
