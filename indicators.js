/*!
 * 量价指标 TechInd v1.0.0
 * ---------------------------------------------------------------------------
 * 做T / 补仓面板用的纯函数指标，浏览器 window.TechInd、Node module.exports 通用，无依赖。
 *
 *   mfi(bars, period)                资金流量指标 MFI（0~100）
 *   rsi(bars, period)                相对强弱指标 RSI（0~100）
 *   macd(bars, fast, slow, signal)   MACD（DIF / DEA / 柱）
 *   obv(bars)                        能量潮 OBV（累计）
 *   adLine(bars)                     累积/派发线 A/D
 *   ma(bars, n)                      简单移动平均
 *   pivotLows(series, k)             枢轴低点（左右各 k 根）
 *   pivotHighs(series, k)            枢轴高点
 *   detectDivergence(price, ind)     价格与指标背离（底背离 / 顶背离）
 *   volumeProfile(bars, opts)        筹码分布近似（POC / 价值区）
 *   volumeRatio(bars, recent, base)  近段均量 ÷ 前段均量
 *
 * 数据不足一律返回 null，不返回 0；MFI 负资金流为 0 时按 100 处理。
 * 阈值集中在下方常量，便于按品种调参。
 * ---------------------------------------------------------------------------
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.TechInd = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  /* ── 可调阈值 ── */
  const MFI_PERIOD = 14;        // MFI 默认周期
  const PIVOT_K = 2;            // 枢轴点左右确认根数
  const DIV_LOOKBACK = 120;     // 背离只在最近多少根内找枢轴
  const DIV_MIN_IND_DIFF = 1.5; // 指标反向幅度至少多少点才算背离（过滤噪音）
  const VALUE_AREA = 0.7;       // 价值区占比（70% 成交量）
  const PROFILE_BINS = 30;      // 筹码分布分箱数
  const PROFILE_LOOKBACK = 120; // 筹码分布回看根数

  const isNum = v => typeof v === 'number' && isFinite(v);

  const num = v => {
    if (v === null || v === undefined || v === '' || v === '-') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  /** bars -> 数值序列；已是数值数组时原样返回 */
  function toSeries(input, key) {
    if (!Array.isArray(input)) return [];
    return input.map(v => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return isFinite(v) ? v : null;
      return num(v[key || 'close']);
    });
  }

  /** 典型价 (H+L+C)/3 */
  function typical(bar) {
    const h = num(bar && bar.high);
    const l = num(bar && bar.low);
    const c = num(bar && bar.close);
    return h === null || l === null || c === null ? null : (h + l + c) / 3;
  }

  const clamp100 = v => Math.max(0, Math.min(100, v));

  /**
   * 资金流量指标 MFI
   * @param {Array<{high:number, low:number, close:number, volume:number}>} bars
   * @param {number} [period=14]
   * @returns {{series:Array<number|null>, latest:number|null, period:number}}
   */
  function mfi(bars, period) {
    const p = Math.max(1, Math.floor(num(period) || MFI_PERIOD));
    const list = Array.isArray(bars) ? bars : [];
    if (list.length < p + 1) return { series: [], latest: null, period: p };

    const tp = list.map(typical);
    const flow = list.map((b, i) => {
      const v = num(b && b.volume);
      return tp[i] === null || v === null ? null : tp[i] * v;
    });

    const series = new Array(list.length).fill(null);

    // MFI 的 p 个周期指 p 次价格变化：第一个值应在第 p 根 K 线上产生。
    // 每个窗口直接按有效的相邻典型价变化计算，避免滚动和缺失数据时错移下标。
    for (let i = p; i < list.length; i++) {
      let pos = 0;
      let neg = 0;
      let completeWindow = true;
      for (let k = i - p + 1; k <= i; k++) {
        if (tp[k] === null || tp[k - 1] === null || flow[k] === null) {
          completeWindow = false;
          break;
        }
        const diff = tp[k] - tp[k - 1];
        if (diff > 0) pos += flow[k];
        else if (diff < 0) neg += flow[k];
      }
      if (!completeWindow) continue;

      let value;
      if (neg <= 0) value = pos > 0 ? 100 : 50;
      else value = clamp100(100 - 100 / (1 + pos / neg));
      series[i] = value;
    }

    const latest = series.length ? series[series.length - 1] : null;
    return { series, latest, period: p };
  }

  /**
   * RSI 相对强弱指标，采用 Wilder 平滑法。
   * @returns {{series:Array<number|null>, latest:number|null, period:number}}
   */
  function rsi(bars, period) {
    const p = Math.max(1, Math.floor(num(period) || 14));
    const list = Array.isArray(bars) ? bars : [];
    const closes = list.map(b => num(b && b.close));
    const series = new Array(list.length).fill(null);
    if (list.length <= p || closes.some(v => v === null)) return { series, latest: null, period: p };
    let gain = 0, loss = 0;
    for (let i = 1; i <= p; i++) {
      const d = closes[i] - closes[i - 1];
      gain += Math.max(0, d);
      loss += Math.max(0, -d);
    }
    gain /= p; loss /= p;
    const value = () => loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
    series[p] = value();
    for (let i = p + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      gain = (gain * (p - 1) + Math.max(0, d)) / p;
      loss = (loss * (p - 1) + Math.max(0, -d)) / p;
      series[i] = value();
    }
    return { series, latest: series[series.length - 1], period: p };
  }

  /**
   * MACD：DIF = EMA(fast)-EMA(slow)，DEA 为 DIF 的 signal 周期 EMA，
   * histogram = 2 * (DIF-DEA)。无足够历史时相关值为 null。
   */
  function macd(bars, fast, slow, signal) {
    const f = Math.max(1, Math.floor(num(fast) || 12));
    const s = Math.max(f + 1, Math.floor(num(slow) || 26));
    const sig = Math.max(1, Math.floor(num(signal) || 9));
    const list = Array.isArray(bars) ? bars : [];
    const closes = list.map(b => num(b && b.close));
    const dif = new Array(list.length).fill(null);
    const dea = new Array(list.length).fill(null);
    const histogram = new Array(list.length).fill(null);
    if (list.length < s + sig - 1 || closes.some(v => v === null)) {
      return { dif, dea, histogram, latest: null, fast: f, slow: s, signal: sig };
    }
    function ema(values, period) {
      const out = new Array(values.length).fill(null);
      if (values.length < period) return out;
      let seed = 0;
      for (let i = 0; i < period; i++) seed += values[i];
      let prev = seed / period;
      out[period - 1] = prev;
      const alpha = 2 / (period + 1);
      for (let i = period; i < values.length; i++) {
        prev = values[i] * alpha + prev * (1 - alpha);
        out[i] = prev;
      }
      return out;
    }
    const fastEma = ema(closes, f);
    const slowEma = ema(closes, s);
    for (let i = s - 1; i < list.length; i++) dif[i] = fastEma[i] - slowEma[i];
    const first = dif.findIndex(v => v !== null);
    const compact = dif.slice(first).map(v => v === null ? 0 : v);
    const signalEma = ema(compact, sig);
    for (let i = first; i < list.length; i++) {
      const v = signalEma[i - first];
      if (v === null) continue;
      dea[i] = v;
      histogram[i] = 2 * (dif[i] - v);
    }
    const i = list.length - 1;
    const latest = dif[i] === null || dea[i] === null ? null : { dif: dif[i], dea: dea[i], histogram: histogram[i] };
    return { dif, dea, histogram, latest, fast: f, slow: s, signal: sig };
  }

  /**
   * 能量潮 OBV：涨加量、跌减量
   * @returns {{series:Array<number|null>, latest:number|null}}
   */
  function obv(bars) {
    const list = Array.isArray(bars) ? bars : [];
    if (list.length < 2) return { series: [], latest: null };

    const series = new Array(list.length).fill(null);
    let acc = 0;
    series[0] = 0;

    for (let i = 1; i < list.length; i++) {
      const c = num(list[i] && list[i].close);
      const prev = num(list[i - 1] && list[i - 1].close);
      const v = num(list[i] && list[i].volume) || 0;
      if (c === null || prev === null) continue;
      if (c > prev) acc += v;
      else if (c < prev) acc -= v;
      series[i] = acc;
    }

    return { series, latest: series[series.length - 1] };
  }

  /**
   * 累积/派发线 A/D
   * @returns {{series:Array<number|null>, latest:number|null}}
   */
  function adLine(bars) {
    const list = Array.isArray(bars) ? bars : [];
    if (!list.length) return { series: [], latest: null };

    const series = new Array(list.length).fill(null);
    let acc = 0;

    for (let i = 0; i < list.length; i++) {
      const h = num(list[i] && list[i].high);
      const l = num(list[i] && list[i].low);
      const c = num(list[i] && list[i].close);
      const v = num(list[i] && list[i].volume);
      if (h === null || l === null || c === null || v === null) continue;
      const mfm = h > l ? ((c - l) - (h - c)) / (h - l) : 0;
      acc += mfm * v;
      series[i] = acc;
    }

    return { series, latest: series[series.length - 1] };
  }

  /**
   * 简单移动平均
   * @returns {{series:Array<number|null>, latest:number|null, n:number}}
   */
  function ma(bars, n) {
    const period = Math.max(1, Math.floor(num(n) || 20));
    const closes = toSeries(bars, 'close');
    const series = new Array(closes.length).fill(null);
    if (closes.length < period) return { series, latest: null, n: period };

    let sum = 0;
    let count = 0;
    for (let i = 0; i < closes.length; i++) {
      const v = closes[i];
      if (v !== null) { sum += v; count++; }
      if (i >= period) {
        const old = closes[i - period];
        if (old !== null) { sum -= old; count--; }
      }
      if (i >= period - 1 && count === period) series[i] = sum / period;
    }

    return { series, latest: series[series.length - 1], n: period };
  }

  /** 通用枢轴：dir = 'low' | 'high' */
  function pivots(series, k, dir) {
    const list = Array.isArray(series) ? series : [];
    const w = Math.max(1, Math.floor(num(k) || PIVOT_K));
    const out = [];
    for (let i = w; i < list.length - w; i++) {
      const v = num(list[i]);
      if (v === null) continue;
      let ok = true;
      let strict = false;
      for (let j = i - w; j <= i + w; j++) {
        if (j === i) continue;
        const x = num(list[j]);
        if (x === null) continue;
        if (dir === 'low' ? x < v : x > v) { ok = false; break; }
        if (dir === 'low' ? x > v : x < v) strict = true;
      }
      if (ok && strict) out.push(i);
    }
    return out;
  }

  const pivotLows = (series, k) => pivots(series, k === undefined ? PIVOT_K : k, 'low');
  const pivotHighs = (series, k) => pivots(series, k === undefined ? PIVOT_K : k, 'high');

  /**
   * 价格与指标背离（默认找最近两个枢轴）
   * @param {Array|Array<object>} price 价格序列或 bars
   * @param {Array<number|null>} ind 指标序列
   * @param {{k?:number, lookback?:number, minIndDiff?:number}} [opts]
   * @returns {null|{type:'bottom'|'top', barsAgo:number, index:number,
   *   priceFrom:number, priceTo:number, indFrom:number, indTo:number, indDelta:number}}
   */
  function detectDivergence(price, ind, opts) {
    const o = opts || {};
    const p = toSeries(price, 'close');
    const x = Array.isArray(ind) ? ind.map(num) : [];
    const n = Math.min(p.length, x.length);
    if (n < 5) return null;

    const k = o.k === undefined ? PIVOT_K : Math.max(1, o.k | 0);
    const lookback = Math.max(k * 4, o.lookback || DIV_LOOKBACK);
    const minDiff = isNum(o.minIndDiff) ? o.minIndDiff : DIV_MIN_IND_DIFF;
    const from = Math.max(0, n - lookback);

    const slice = (arr) => arr.slice(0, n);
    const ps = slice(p);
    const xs = slice(x);

    const pick = indices => indices.filter(i => i >= from && ps[i] !== null && xs[i] !== null);
    const lows = pick(pivotLows(ps, k));
    const highs = pick(pivotHighs(ps, k));

    const candidates = [];

    if (lows.length >= 2) {
      const i1 = lows[lows.length - 2];
      const i2 = lows[lows.length - 1];
      const dInd = xs[i2] - xs[i1];
      if (ps[i2] < ps[i1] && dInd >= minDiff) {
        candidates.push({
          type: 'bottom',
          barsAgo: n - 1 - i2,
          index: i2,
          priceFrom: ps[i1],
          priceTo: ps[i2],
          indFrom: xs[i1],
          indTo: xs[i2],
          indDelta: dInd
        });
      }
    }

    if (highs.length >= 2) {
      const i1 = highs[highs.length - 2];
      const i2 = highs[highs.length - 1];
      const dInd = xs[i1] - xs[i2];
      if (ps[i2] > ps[i1] && dInd >= minDiff) {
        candidates.push({
          type: 'top',
          barsAgo: n - 1 - i2,
          index: i2,
          priceFrom: ps[i1],
          priceTo: ps[i2],
          indFrom: xs[i1],
          indTo: xs[i2],
          indDelta: dInd
        });
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => b.index - a.index);
    return candidates[0];
  }

  /**
   * 筹码分布近似：把每根 K 的成交量按 [low, high] 均匀摊到价格分箱
   * （不是真实逐笔筹码，只用于找密集区）
   * @param {Array} bars
   * @param {{bins?:number, lookback?:number}} [opts]
   * @returns {null|{poc:number, val:number, vah:number, lo:number, hi:number,
   *   bins:Array<{price:number, volume:number}>, count:number}}
   */
  function volumeProfile(bars, opts) {
    const o = opts || {};
    const list = (Array.isArray(bars) ? bars : []).slice(-(Math.max(1, o.lookback || PROFILE_LOOKBACK)));
    const rows = list.filter(b => num(b && b.low) !== null && num(b && b.high) !== null
      && num(b.high) >= num(b.low));
    if (rows.length < 2) return null;

    const binCount = Math.max(3, Math.floor(num(o.bins) || PROFILE_BINS));
    const lo = Math.min.apply(null, rows.map(b => num(b.low)));
    const hi = Math.max.apply(null, rows.map(b => num(b.high)));
    if (!(hi > lo)) return null;

    const step = (hi - lo) / binCount;
    const vols = new Array(binCount).fill(0);
    let total = 0;
    let missingVol = 0;

    for (const b of rows) {
      const l = num(b.low);
      const h = num(b.high);
      let v = num(b.volume);
      if (v === null) { missingVol++; v = 0; }
      let a = Math.floor((l - lo) / step);
      let c = Math.floor((h - lo) / step);
      a = Math.max(0, Math.min(binCount - 1, a));
      c = Math.max(0, Math.min(binCount - 1, c));
      if (c < a) { const t = a; a = c; c = t; }
      const per = v / (c - a + 1);
      for (let i = a; i <= c; i++) vols[i] += per;
      total += v;
    }

    // 缺量数据时退化为等权，仍能反映价格停留时间
    if (total <= 0) {
      for (const b of rows) {
        const l = num(b.low);
        const h = num(b.high);
        let a = Math.max(0, Math.min(binCount - 1, Math.floor((l - lo) / step)));
        let c = Math.max(0, Math.min(binCount - 1, Math.floor((h - lo) / step)));
        if (c < a) { const t = a; a = c; c = t; }
        const per = 1 / (c - a + 1);
        for (let i = a; i <= c; i++) vols[i] += per;
        total += 1;
      }
    }

    let pocIdx = 0;
    for (let i = 1; i < binCount; i++) if (vols[i] > vols[pocIdx]) pocIdx = i;

    // 价值区：从 POC 向两侧扩张，直到覆盖 70% 成交量
    const target = total * (isNum(o.valueArea) ? o.valueArea : VALUE_AREA);
    let left = pocIdx;
    let right = pocIdx;
    let acc = vols[pocIdx];
    while (acc < target && (left > 0 || right < binCount - 1)) {
      const lv = left > 0 ? vols[left - 1] : -1;
      const rv = right < binCount - 1 ? vols[right + 1] : -1;
      if (lv >= rv) { left--; acc += vols[left]; }
      else { right++; acc += vols[right]; }
    }

    const center = i => lo + (i + 0.5) * step;
    return {
      poc: center(pocIdx),
      val: lo + left * step,
      vah: lo + (right + 1) * step,
      lo,
      hi,
      step,
      count: rows.length,
      bins: vols.map((v, i) => ({ price: center(i), volume: v }))
    };
  }

  /**
   * 近段均量 ÷ 前段均量（放量 > 1.3）
   * @param {Array} bars
   * @param {number} [recent=3]
   * @param {number} [base=12]
   * @returns {number|null}
   */
  function volumeRatio(bars, recent, base) {
    const list = Array.isArray(bars) ? bars : [];
    const r = Math.max(1, recent | 0 || 3);
    const b = Math.max(1, base | 0 || 12);
    if (list.length < r + b) return null;

    const tail = list.slice(-r);
    const prev = list.slice(-(r + b), -r);
    const avg = arr => {
      const vs = arr.map(x => num(x && x.volume)).filter(v => v !== null);
      return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
    };
    const a = avg(tail);
    const p = avg(prev);
    if (a === null || p === null || p <= 0) return null;
    return a / p;
  }

  return {
    VERSION,
    MFI_PERIOD,
    PIVOT_K,
    DIV_LOOKBACK,
    DIV_MIN_IND_DIFF,
    VALUE_AREA,
    PROFILE_BINS,
    PROFILE_LOOKBACK,
    isNum,
    num,
    mfi,
    rsi,
    macd,
    obv,
    adLine,
    ma,
    pivotLows,
    pivotHighs,
    detectDivergence,
    volumeProfile,
    volumeRatio
  };
});
