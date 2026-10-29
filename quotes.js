/*!
 * StockQuotes SDK v1.5.0
 * ---------------------------------------------------------------------------
 * 股票行情 SDK —— A 股实时行情聚合封装（浏览器 / Node 通用，无依赖）
 *
 * 数据源（自动降级，取到数据即止）
 *   1) eastmoney  东方财富 push2 批量接口（JSON，支持跨域）
 *   2) tencent    腾讯财经 qt.gtimg.cn 批量接口（GBK，支持跨域）
 *   3) tencent    腾讯 ifzq K 线接口（JSON，支持跨域）
 *
 * 特性
 *   · 批量拉取（自动分片，单次默认 60 只）、单只拉取
 *   · 股息率（TTM：近 12 个月已除权分红 ÷ 现价，以腾讯口径为准，东财 f133 兜底）
 *   · 单只详情（开高低收、量额、换手、量比、振幅、PE/PB、市值、涨跌停）
 *   · 日/周/月 K 线（前复权/后复权/不复权）
 *   · 代码格式宽容：'002408' / 'sz002408' / 'SZ002408'
 *   · 多源 + 多域名自动降级，单个源缺数据时用下一个源补齐
 *   · 超时、重试、内置短时缓存、外部 AbortSignal 取消
 *   · A 股交易时段判断（供自动刷新调度使用）
 *   · 结构化错误（QuoteError，带 code）
 *
 * 快速开始
 *   const quotes = new StockQuotes.Client({ timeout: 8000, cacheTTL: 1000 });
 *   const data = await quotes.fetch(['sz002408', '600519']);
 *   // data = { sz002408: { code, name, price, prevClose, change, todayChange,
 *   //                     pe, pb, totalCap, floatCap, divYield, time }, ... }
 *
 * 单只详情 / K 线（详情页使用）
 *   await quotes.fetchDetail('sz002408');
 *   // { code, name, price, open, high, low, prevClose, avg, volume, amount,
 *   //   turnover, volumeRatio, amplitude, limitUp, limitDown, pe, pb,
 *   //   totalCap, floatCap, change, todayChange, time }
 *   await quotes.fetchKline('sz002408', { period: 'day', count: 240, adjust: 'qfq' });
 *   // { code, period, adjust, bars: [{ time:'2026-10-28', open, close, high, low, volume }] }
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

  const VERSION = '1.5.0';
  const REFRESH_INTERVAL = 1800000; // 价值投资：盘中最多每 30 分钟刷新一次

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
    eastmoneyHistory: ['push2his.eastmoney.com', 'push2delay.eastmoney.com'],
    tencent: ['qt.gtimg.cn'],
    tencentApp: ['ifzq.gtimg.cn', 'web.ifzq.gtimg.cn']
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

  /** K 线日期统一成 yyyy-mm-dd（兼容 20251103 / 2025-11-03） */
  const barTime = v => {
    const s = String(v || '').trim();
    if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return s.slice(0, 10);
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
      out[code] = build(code, price, num(item.f18), num(item.f4), num(item.f3), null, {
        pe: num(item.f9),
        pb: num(item.f23),
        totalCap: num(item.f20),
        floatCap: num(item.f21),
        divYield: num(item.f133)          // 股息率（%），仅作兜底
      });
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
      const totalCapYi = num(f[45]);
      const floatCapYi = num(f[44]);
      out[code] = build(code, price, num(f[4]), num(f[31]), num(f[32]), f[1], {
        pe: num(f[39]),                                       // 市盈率(TTM)
        pb: num(f[46]),
        totalCap: totalCapYi === null ? null : totalCapYi * 1e8,   // 亿 -> 元
        floatCap: floatCapYi === null ? null : floatCapYi * 1e8,
        divYield: num(f[64])                                  // 股息率(TTM, %)
      });
    }
    return out;
  }

  function build(code, price, prevClose, change, todayChange, name, extra) {
    if (todayChange === null && prevClose && prevClose > 0) {
      todayChange = (price - prevClose) / prevClose * 100;
    }
    const e = extra || {};
    return {
      code, name: name || null, price, prevClose, change, todayChange,
      pe: e.pe === undefined ? null : e.pe,
      pb: e.pb === undefined ? null : e.pb,
      totalCap: e.totalCap === undefined ? null : e.totalCap,
      floatCap: e.floatCap === undefined ? null : e.floatCap,
      divYield: e.divYield === undefined ? null : e.divYield,
      time: Date.now()
    };
  }

  /* ────────────────────── 单只详情解析 ────────────────────── */

  /** 东方财富 stock/get JSON -> 详情 */
  function parseEastmoneyDetail(json) {
    const d = json && json.data;
    if (!d) return null;
    const price = num(d.f43);
    if (price === null || price <= 0) return null;

    const market = d.f107 === 1 ? 'sh' : d.f107 === 0 ? 'sz' : '';
    const code = market + String(d.f57 || '');

    return detail(code, {
      name: d.f58 || null,
      price,
      prevClose: num(d.f60),
      change: num(d.f169),
      todayChange: num(d.f170),
      open: num(d.f46),
      high: num(d.f44),
      low: num(d.f45),
      avg: num(d.f71),
      volume: num(d.f47),          // 手
      amount: num(d.f48),          // 元
      turnover: num(d.f168),       // %
      volumeRatio: num(d.f50),
      amplitude: num(d.f171),      // %
      limitUp: num(d.f51),
      limitDown: num(d.f52),
      pe: num(d.f162),             // 市盈率（动）
      peStatic: num(d.f163),       // 市盈率（静）
      peTtm: num(d.f164),          // 市盈率（TTM）
      pb: num(d.f167),
      roe: num(d.f173),            // %
      grossMargin: num(d.f186),    // %
      netMargin: num(d.f187),      // %
      revenue: num(d.f183),        // 元
      revenueYoY: num(d.f184),     // %
      profit: num(d.f105),         // 元
      profitYoY: num(d.f185),      // %
      navPerShare: num(d.f92),
      high52: num(d.f174),
      low52: num(d.f175),
      listedAt: num(d.f189),
      board: d.f198 || null,
      totalShares: num(d.f84),
      floatShares: num(d.f85),
      totalCap: num(d.f116),       // 元
      floatCap: num(d.f117),       // 元
      time: d.f86 ? Number(d.f86) * 1000 : Date.now()
    });
  }

  /** 腾讯 qt.gtimg.cn 文本 -> 详情 */
  function parseTencentDetail(text) {
    const m = /v_([a-z]{2}\d{6})="([^"]*)"/.exec(text || '');
    if (!m) return null;
    const f = m[2].split('~');
    if (f.length < 50) return null;
    const price = num(f[3]);
    if (price === null || price <= 0) return null;

    const amountWan = num(f[37]);
    const totalCapYi = num(f[45]);
    const floatCapYi = num(f[44]);

    return detail(m[1], {
      name: f[1] || null,
      price,
      prevClose: num(f[4]),
      change: num(f[31]),
      todayChange: num(f[32]),
      open: num(f[5]),
      high: num(f[33]),
      low: num(f[34]),
      avg: null,
      volume: num(f[6]),
      amount: amountWan === null ? null : amountWan * 1e4,
      turnover: num(f[38]),
      volumeRatio: num(f[49]),
      amplitude: num(f[43]),
      limitUp: num(f[47]),
      limitDown: num(f[48]),
      pe: null,
      peStatic: null,
      peTtm: num(f[39]),
      pb: num(f[46]),
      roe: null,
      grossMargin: null,
      netMargin: null,
      revenue: null,
      revenueYoY: null,
      profit: null,
      profitYoY: null,
      navPerShare: null,
      high52: null,
      low52: null,
      listedAt: null,
      board: null,
      totalShares: null,
      floatShares: null,
      totalCap: totalCapYi === null ? null : totalCapYi * 1e8,
      floatCap: floatCapYi === null ? null : floatCapYi * 1e8,
      time: parseTencentTime(f[30])
    });
  }

  function detail(code, f) {
    if (f.change === null && f.prevClose && f.price != null) {
      f.change = f.price - f.prevClose;
    }
    if (f.todayChange === null && f.prevClose) {
      f.todayChange = (f.price - f.prevClose) / f.prevClose * 100;
    }
    if (f.avg === null && f.amount && f.volume) {
      f.avg = f.amount / (f.volume * 100);
    }
    f.code = code;
    return f;
  }

  function parseTencentTime(s) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(s || ''));
    if (!m) return Date.now();
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  /* ────────────────────── K 线解析 ────────────────────── */

  /** 腾讯 fqkline JSON -> K 线数组（日期, 开, 收, 高, 低, 量） */
  function parseTencentKline(json, code, period, adjust) {
    const d = json && json.data && json.data[code];
    if (!d) return [];
    const rows = d[(adjust || '') + period] || d[period] || [];
    if (!Array.isArray(rows)) return [];
    return rows.map(r => ({
      time: barTime(r[0]),
      open: num(r[1]),
      close: num(r[2]),
      high: num(r[3]),
      low: num(r[4]),
      volume: num(r[5])
    })).filter(b => b.open !== null && b.close !== null && b.high !== null && b.low !== null);
  }

  /** 东方财富 kline JSON -> K 线数组 */
  function parseEastmoneyKline(json) {
    const k = json && json.data && json.data.klines;
    if (!Array.isArray(k)) return [];
    return k.map(line => {
      const f = String(line).split(',');
      return {
        time: barTime(f[0]),
        open: num(f[1]),
        close: num(f[2]),
        high: num(f[3]),
        low: num(f[4]),
        volume: num(f[5])
      };
    }).filter(b => b.open !== null && b.close !== null);
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
                   + `&fields=f2,f3,f4,f9,f12,f18,f20,f21,f23,f133&_=${Date.now()}`;
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

  /* ────────────────────── 单只详情 / K 线数据源 ────────────────────── */

  const DETAIL_FIELDS = [
    'f43', 'f44', 'f45', 'f46', 'f47', 'f48', 'f50', 'f51', 'f52',
    'f57', 'f58', 'f60', 'f71', 'f84', 'f85', 'f86', 'f92', 'f105', 'f107',
    'f116', 'f117', 'f162', 'f163', 'f164', 'f167', 'f168', 'f169', 'f170', 'f171',
    'f173', 'f174', 'f175', 'f183', 'f184', 'f185', 'f186', 'f187', 'f189', 'f198'
  ].join(',');

  const PERIOD_KLT = { day: 101, week: 102, month: 103 };
  const ADJUST_FQT = { qfq: 1, hfq: 2, '': 0 };

  const DETAIL_PROVIDERS = {
    eastmoney: {
      id: 'eastmoney',
      async fetch(code, ctx) {
        const path = `/api/qt/stock/get?fltt=2&secid=${toSecId(code)}&fields=${DETAIL_FIELDS}&_=${Date.now()}`;
        const json = await requestJSON(HOSTS.eastmoney, path, ctx);
        return parseEastmoneyDetail(json);
      }
    },
    tencent: {
      id: 'tencent',
      async fetch(code, ctx) {
        const path = `/q=${code}&_=${Date.now()}`;
        const text = await requestText(HOSTS.tencent, path, ctx, 'gbk');
        return parseTencentDetail(text);
      }
    }
  };

  const KLINE_PROVIDERS = {
    tencent: {
      id: 'tencent',
      async fetch(code, opts, ctx) {
        const path = `/appstock/app/fqkline/get?param=${code},${opts.period},,,${opts.count},${opts.adjust}&_=${Date.now()}`;
        const json = await requestJSON(HOSTS.tencentApp, path, ctx);
        return parseTencentKline(json, code, opts.period, opts.adjust);
      }
    },
    eastmoney: {
      id: 'eastmoney',
      async fetch(code, opts, ctx) {
        const path = `/api/qt/stock/kline/get?secid=${toSecId(code)}&fields1=f1,f2,f3,f4,f5,f6`
                   + `&fields2=f51,f52,f53,f54,f55,f56,f57`
                   + `&klt=${PERIOD_KLT[opts.period]}&fqt=${ADJUST_FQT[opts.adjust]}`
                   + `&end=20500101&lmt=${opts.count}&_=${Date.now()}`;
        const json = await requestJSON(HOSTS.eastmoneyHistory, path, ctx);
        return parseEastmoneyKline(json);
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
     *           prevClose:number|null, change:number|null, todayChange:number|null,
     *           pe:number|null, pb:number|null, totalCap:number|null, floatCap:number|null,
     *           divYield:number|null}>>}
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

    /**
     * 单只详情（东方财富 stock/get 主源，腾讯降级）
     * @param {string} code
     * @param {object} [opts]
     * @returns {Promise<{code:string, name:string|null, price:number, open:number|null,
     *   high:number|null, low:number|null, prevClose:number|null, avg:number|null,
     *   volume:number|null, amount:number|null, turnover:number|null, volumeRatio:number|null,
     *   amplitude:number|null, limitUp:number|null, limitDown:number|null,
     *   pe:number|null, peStatic:number|null, peTtm:number|null, pb:number|null,
     *   roe:number|null, grossMargin:number|null, netMargin:number|null,
     *   revenue:number|null, revenueYoY:number|null, profit:number|null, profitYoY:number|null,
     *   navPerShare:number|null, high52:number|null, low52:number|null, listedAt:number|null,
     *   board:string|null, totalCap:number|null, floatCap:number|null,
     *   change:number|null, todayChange:number|null, time:number}>}
     */
    async fetchDetail(code, opts) {
      const c = normalizeCode(code);
      if (!c) throw new QuoteError('无效的股票代码: ' + code, 'PARSE');

      const o = opts || {};
      const key = 'detail:' + c;
      const cached = this._readCache(key, o.force);
      if (cached) return cached;

      const ctx = this._context(o);
      let lastErr = null;

      for (const id of this.options.providers) {
        const provider = DETAIL_PROVIDERS[id];
        if (!provider) continue;
        if (!this._available('detail:' + id)) continue;
        try {
          const data = await provider.fetch(c, ctx);
          if (data && data.price > 0) return this._cacheResult(key, data);
        } catch (e) {
          if (e && e.code === 'ABORTED') throw e;
          this.stats.failures++;
          lastErr = e;
          this._markDown('detail:' + id);
        }
      }

      const err = lastErr || new QuoteError('所有行情源均不可用', 'UNAVAILABLE');
      this._notifyError(err);
      throw err;
    }

    /**
     * K 线（腾讯 fqkline 主源，东方财富 kline 降级）
     * @param {string} code
     * @param {{period?:'day'|'week'|'month', count?:number, adjust?:'qfq'|'hfq'|'',
     *          force?:boolean, signal?:AbortSignal}} [opts]
     * @returns {Promise<{code:string, period:string, adjust:string,
     *   bars:Array<{time:string, open:number, close:number, high:number, low:number, volume:number|null}>}>}
     */
    async fetchKline(code, opts) {
      const c = normalizeCode(code);
      if (!c) throw new QuoteError('无效的股票代码: ' + code, 'PARSE');

      const o = opts || {};
      const period = (o.period === 'week' || o.period === 'month') ? o.period : 'day';
      const adjust = o.adjust === '' || o.adjust === 'none' ? '' : (o.adjust === 'hfq' ? 'hfq' : 'qfq');
      const count = Math.min(1000, Math.max(10, o.count | 0 || 180));

      const key = `kline:${c}:${period}:${adjust}:${count}`;
      const cached = this._readCache(key, o.force);
      if (cached) return cached;

      const ctx = this._context(o);
      const spec = { period, count, adjust };
      let lastErr = null;

      for (const id of ['tencent', 'eastmoney']) {
        const provider = KLINE_PROVIDERS[id];
        if (!this._available('kline:' + id)) continue;
        try {
          const bars = await provider.fetch(c, spec, ctx);
          if (bars && bars.length) return this._cacheResult(key, { code: c, period, adjust, bars });
        } catch (e) {
          if (e && e.code === 'ABORTED') throw e;
          this.stats.failures++;
          lastErr = e;
          this._markDown('kline:' + id);
        }
      }

      const err = lastErr || new QuoteError('K 线数据不可用', 'UNAVAILABLE');
      this._notifyError(err);
      throw err;
    }

    /* 内部工具 */

    _context(o) {
      return {
        timeout: this.options.timeout,
        retries: Math.max(0, this.options.retries | 0),
        signal: o.signal || null,
        stats: this.stats
      };
    }

    _available(key) {
      return Date.now() >= (this._downUntil[key] || 0);
    }

    _markDown(key) {
      this._downUntil[key] = Date.now() + (this.options.providerBackoff || 0);
    }

    _cacheResult(key, data) {
      this.lastError = null;
      this.stats.lastAt = Date.now();
      this._writeCache(key, data);
      return data;
    }

    _notifyError(err) {
      this.lastError = err;
      if (typeof this.options.onError === 'function') {
        try { this.options.onError(err); } catch (_) { /* ignore */ }
      }
    }

    /* 单个分片：按数据源顺序尝试，缺的代码交给下一个源补 */
    async _fetchChunk(codes, ctx) {
      const missing = new Set(codes);
      const out = {};
      const filledBy = {};

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
              filledBy[code] = id;
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

      await this._supplementDividend(out, filledBy, ctx);
      return out;
    }

    /**
     * 股息率补齐：腾讯口径（近 12 个月已除权分红 ÷ 现价）已实测校准，优先采用；
     * 主源是东财且 f133 缺失/无值时，用腾讯再补一次。
     */
    async _supplementDividend(out, filledBy, ctx) {
      const codes = Object.keys(out).filter(c => filledBy[c] !== 'tencent');
      if (!codes.length) return;
      if (Date.now() < (this._downUntil['dividend:tencent'] || 0)) return;

      try {
        const map = await PROVIDERS.tencent.fetch(codes, ctx);
        codes.forEach(c => {
          const d = map[c];
          if (d && d.divYield != null) out[c].divYield = d.divYield;
          else if (out[c].divYield == null) out[c].divYield = null;
        });
        this._downUntil['dividend:tencent'] = 0;
      } catch (e) {
        if (e && e.code === 'ABORTED') throw e;
        this.stats.failures++;
        this._downUntil['dividend:tencent'] = Date.now() + (this.options.providerBackoff || 0);
      }
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
    fetchDetail: (code, opts) => defaultClient.fetchDetail(code, opts),
    fetchKline: (code, opts) => defaultClient.fetchKline(code, opts),
    clearCache: () => defaultClient.clearCache(),
    get lastError() { return defaultClient.lastError; },
    get stats() { return defaultClient.stats; }
  };
});
