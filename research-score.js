/*!
 * 研报评分 ResearchScore v1.0.0
 * ---------------------------------------------------------------------------
 * 复算「资料/个股研报」里那张 10 项百分制选股评分卡中，可以纯靠行情数据算出来的 4 项：
 *   · 总市值 <200 亿           权重 8
 *   · 股价盘整 2-3 年充分吸收   权重 9
 *   · 股价位于月线底部区域      权重 9
 *   · 底部成交量开始显著放大    权重 6
 * 合计 32 分。其余 6 项（国资背景 / 垄断地位 / 产品持续涨价 / 扣非净利爆发 /
 * 主营集中 / 盈利模式）需要基本面判断，不自动评分，因此这里不输出 100 分制总分。
 *
 * 阈值用 17 份带评分卡明细的研报做过回归校准（scripts/calibrate_research_score.js），
 * 口径说明见 README「研报评分」一节。
 *
 * 浏览器：window.ResearchScore；Node：module.exports
 * ---------------------------------------------------------------------------
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.ResearchScore = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  /**
   * 所有阈值集中在这里，便于用研报样本回归校准（scripts/calibrate_research_score.js）。
   */
  const CONFIG = {
    weights: { cap: 8, consolidation: 9, bottom: 9, volume: 6 },

    // 市值：100 亿以内满分；100-200 亿（原准则的合格线内）给中等分；200 亿以上按对数衰减
    cap: { fullYi: 100, midYi: 200, midScore: 6.5, decay: 3, min: 3 },

    // 盘整：近 36 个月收盘箱体；箱体高度 20% 以下给满、80% 以上归零；高点距今 6 个月起算、24 个月给满
    consolidation: { window: 36, boxFull: 0.20, boxZero: 0.80, monthsZero: 6, monthsFull: 24, min: 4, max: 9 },

    // 月线底部：全历史收盘分位 0.6 + 52 周位置 0.4；位置越低分越高，55% 以上触底
    bottom: { wAll: 0.6, w52: 0.4, exponent: 0.8, min: 4, max: 10 },

    // 底部放量：近 6 个月月均量 / 之前 36 个月月均量；量比 0.6 起算、3.0 满分
    volume: { recent: 6, base: 36, zero: 0.6, full: 3.0, min: 0, max: 9, weeklyRecent: 4, weeklyBase: 24 },

    bands: [
      { key: 'good', min: 24, label: '位置优秀' },
      { key: 'mid', min: 18, label: '位置中性' },
      { key: 'high', min: -Infinity, label: '位置偏高' }
    ]
  };

  const isNum = v => typeof v === 'number' && isFinite(v);

  function num(v) {
    if (v === null || v === undefined || v === '' || v === '-') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }

  function clamp(v, min, max) {
    if (!isNum(v)) return null;
    return v < min ? min : v > max ? max : v;
  }

  function mean(list) {
    const values = (list || []).map(num).filter(v => v !== null);
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /** 当前值在数组中的分位（0-100，越大越贵） */
  function percentile(values, current) {
    const list = (values || []).map(num).filter(v => v !== null);
    const cur = num(current);
    if (!list.length || cur === null) return null;
    let below = 0;
    for (const v of list) if (v <= cur) below++;
    return below / list.length * 100;
  }

  function closesOf(bars) {
    return (Array.isArray(bars) ? bars : []).map(b => num(b && b.close)).filter(v => v !== null && v > 0);
  }

  /**
   * 周 K 合成月 K（每月取最后一根的收盘价，成交量按月累加），用于月 K 缓存缺失时兜底。
   * @param {Array} weekly
   */
  function deriveMonthly(weekly) {
    const bars = Array.isArray(weekly) ? weekly : [];
    const months = [];
    let current = null;
    bars.forEach(bar => {
      const close = num(bar && bar.close);
      const time = String((bar && bar.time) || '');
      if (close === null || close <= 0 || time.length < 7) return;
      const key = time.slice(0, 7);
      if (!current || current.key !== key) {
        current = { key, bar: { time, open: num(bar.open), close, high: num(bar.high), low: num(bar.low), volume: num(bar.volume) } };
        months.push(current);
      } else {
        current.bar.close = close;
        current.bar.high = num(bar.high) !== null ? num(bar.high) : current.bar.high;
        current.bar.low = num(bar.low) !== null ? num(bar.low) : current.bar.low;
        current.bar.volume = (current.bar.volume || 0) + (num(bar.volume) || 0);
      }
    });
    return months.map(item => item.bar);
  }

  /** 去掉最后一根未走完的月 K（成交量不完整会压低均量） */
  function dropPartialMonth(bars, asOfTime) {
    const list = Array.isArray(bars) ? bars.slice() : [];
    const month = String(asOfTime || '').slice(0, 7);
    if (!month || !list.length) return list;
    while (list.length && String(list[list.length - 1].time || '').slice(0, 7) === month) list.pop();
    return list;
  }

  /** 第 7 项：总市值 <200 亿 */
  function scoreCap(cap) {
    const cfg = CONFIG.cap;
    const value = num(cap);
    if (value === null || value <= 0) return null;
    const yi = value / 1e8;
    if (yi <= cfg.fullYi) return 10;
    if (yi <= cfg.midYi) return cfg.midScore;
    return clamp(cfg.midScore - cfg.decay * Math.log10(yi / cfg.midYi), cfg.min, cfg.midScore);
  }

  /** 第 8 项：股价盘整 2-3 年充分吸收（月 K） */
  function scoreConsolidation(monthly) {
    const cfg = CONFIG.consolidation;
    const bars = Array.isArray(monthly) ? monthly.slice(-cfg.window) : [];
    const closes = closesOf(bars);
    if (closes.length < 12) return { score: null, metrics: { boxHeight: null, months: null } };

    let max = -Infinity;
    let min = Infinity;
    let peakIndex = 0;
    closes.forEach((v, i) => {
      if (v > max) { max = v; peakIndex = i; }
      if (v < min) min = v;
    });
    if (!(min > 0) || !isFinite(max) || !isFinite(min)) return { score: null, metrics: { boxHeight: null, months: null } };

    const boxHeight = (max - min) / min;
    const monthsAgo = closes.length - 1 - peakIndex;
    const horizontal = clamp((cfg.boxZero - boxHeight) / (cfg.boxZero - cfg.boxFull), 0, 1);
    const duration = clamp((monthsAgo - cfg.monthsZero) / (cfg.monthsFull - cfg.monthsZero), 0, 1);
    const score = clamp(10 * (0.5 * horizontal + 0.5 * duration), cfg.min, cfg.max);
    return { score, metrics: { boxHeight, months: monthsAgo } };
  }

  /** 第 9 项：股价位于月线底部区域（月 K 全历史分位 + 52 周位置） */
  function scoreBottom(monthly, price, high52, low52) {
    const cfg = CONFIG.bottom;
    const closes = closesOf(monthly);
    const p = num(price);
    if (p === null || p <= 0 || closes.length < 6) return { score: null, position: null, metrics: {} };

    const pAll = percentile(closes, p);
    const hi = num(high52);
    const lo = num(low52);
    const p52 = hi !== null && lo !== null && hi > lo ? (p - lo) / (hi - lo) * 100 : null;

    let weightSum = 0;
    let acc = 0;
    [[pAll, cfg.wAll], [p52, cfg.w52]].forEach(([value, weight]) => {
      if (value === null) return;
      weightSum += weight;
      acc += clamp(value, 0, 100) * weight;
    });
    if (!(weightSum > 0)) return { score: null, position: null, metrics: {} };

    const position = acc / weightSum / 100;             // 0（最低）~ 1（最高）
    const score = clamp(10 * Math.pow(1 - position, cfg.exponent), cfg.min, cfg.max);
    return { score, position, metrics: { pAll, p52 } };
  }

  /** 第 10 项：底部成交量开始显著放大（月均量，必要时退回周均量） */
  function scoreVolume(monthly, weekly, asOfTime) {
    const cfg = CONFIG.volume;
    const bars = dropPartialMonth(monthly, asOfTime);
    const volumes = bars.map(b => num(b && b.volume)).filter(v => v !== null && v > 0);
    let ratio = volumeRatio(volumes, cfg.recent, cfg.base);
    let window = { recent: cfg.recent, base: cfg.base, period: 'month' };

    if (ratio === null) {
      const weekVols = (Array.isArray(weekly) ? weekly : []).map(b => num(b && b.volume)).filter(v => v !== null && v > 0);
      ratio = volumeRatio(weekVols, cfg.weeklyRecent, cfg.weeklyBase);
      window = { recent: cfg.weeklyRecent, base: cfg.weeklyBase, period: 'week' };
    }
    if (ratio === null) return { score: null, metrics: { volRatio: null } };

    const score = clamp(10 * (ratio - cfg.zero) / (cfg.full - cfg.zero), cfg.min, cfg.max);
    return { score, metrics: { volRatio: ratio, volumeWindow: window } };
  }

  function volumeRatio(values, recent, base) {
    const list = (values || []).filter(v => isNum(v) && v > 0);
    if (list.length < recent + 12) return null;
    const now = mean(list.slice(-recent));
    const before = mean(list.slice(-(recent + base), -recent));
    return now && before ? now / before : null;
  }

  function bandOf(points) {
    const cfg = CONFIG.bands;
    for (const band of cfg) if (isNum(points) && points >= band.min) return band;
    return cfg[cfg.length - 1];
  }

  function lastTime(bars) {
    for (let i = bars.length - 1; i >= 0; i--) {
      const time = String((bars[i] && bars[i].time) || '');
      if (time) return time;
    }
    return '';
  }

  /**
   * 计算一只股票的 32 分制评分。
   * @param {{cap?:number, monthly?:Array, weekly?:Array, daily?:Array,
   *          price?:number, high52?:number, low52?:number}} input
   */
  function compute(input) {
    const src = input || {};
    const daily = Array.isArray(src.daily) ? src.daily : [];
    const weekly = Array.isArray(src.weekly) ? src.weekly : [];
    let monthly = Array.isArray(src.monthly) ? src.monthly : [];
    if (monthly.length < 12 && weekly.length >= 12) monthly = deriveMonthly(weekly);

    const asOf = lastTime(daily) || lastTime(weekly) || lastTime(monthly);
    const cap = scoreCap(src.cap);
    const consolidation = scoreConsolidation(monthly);
    const bottom = scoreBottom(monthly, src.price, src.high52, src.low52);
    const volume = scoreVolume(monthly, weekly, asOf);

    const items = {
      cap,
      consolidation: consolidation.score,
      bottom: bottom.score,
      volume: volume.score
    };

    const weights = CONFIG.weights;
    let points = 0;
    let max = 0;
    Object.keys(weights).forEach(key => {
      const score = items[key];
      if (!isNum(score)) return;
      max += weights[key];
      points += weights[key] * score / 10;
    });

    const totalMax = Object.keys(weights).reduce((sum, key) => sum + weights[key], 0);
    const known = Object.keys(weights).filter(key => isNum(items[key])).length;
    const rounded = Math.round(points * 10) / 10;
    const band = max === totalMax ? bandOf(rounded) : null;

    return {
      version: VERSION,
      items,
      points: known ? rounded : null,
      max: known ? max : null,
      totalMax,
      known,
      complete: known === Object.keys(weights).length,
      band: known ? band : null,
      metrics: {
        capYi: num(src.cap) !== null ? num(src.cap) / 1e8 : null,
        boxHeight: consolidation.metrics.boxHeight,
        months: consolidation.metrics.months,
        position: isNum(bottom.position) ? bottom.position : null,
        pAll: bottom.metrics.pAll,
        p52: bottom.metrics.p52,
        volRatio: volume.metrics.volRatio,
        volumeWindow: volume.metrics.volumeWindow || null
      }
    };
  }

  return {
    VERSION,
    CONFIG,
    isNum,
    num,
    clamp,
    percentile,
    scoreCap,
    scoreConsolidation,
    scoreBottom,
    scoreVolume,
    bandOf,
    deriveMonthly,
    compute
  };
});
