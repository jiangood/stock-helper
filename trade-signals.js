/* Shared, pure trade-signal calculations for the combat center.
 *
 * 规则参数来自 2026-10 的回测（见 scripts/backtest_signals.js）：
 *   买入：现价 < 计划入场价 → 四项评分（超跌深度 / RSI / MFI / 动能）≥3 分
 *         下跌趋势下 MFI<20 一票否决（回测 20 日 -7.0%，胜率 25%）
 *   卖出：近 60 日最低收盘 ×1.2 启动跟踪，启动后最高收盘 ×0.95 离场（回撤 5%）
 *         回测：367 段拉升中位 +24.1%（死拿 +9.7%），距峰值中位 -6.9%，73% 跑赢
 *   不设止损：回测显示加 MA20 止损会把最好一笔 +52.8% 砍到 +5.4%
 */
(function (root) {
  'use strict';

  var RULES = {
    minBars: 60,
    maPeriod: 20,
    maLong: 60,
    rsiPeriod: 14,
    mfiPeriod: 14,
    deepDev: 12,          // 下跌趋势：偏离 MA20 ≤ -12%
    deepDrawdown: 35,     // 下跌趋势：60 日回撤 ≤ -35%
    shallowDev: 8,        // 回调 / 上涨：偏离 MA20 ≤ -8%
    shallowDrawdown: 25,  // 回调：60 日回撤 ≤ -25%
    rsiDown: 30,
    rsiPullbackLow: 25,
    rsiPullbackHigh: 35,
    rsiUp: 45,
    mfiDownOk: 30,        // 下跌趋势要求 MFI ≥ 30（资金未持续流出）
    mfiOtherOk: 25,       // 回调 / 上涨要求 MFI < 25（低位）
    mfiVeto: 20,          // 下跌趋势 MFI < 20 → 一票否决
    scoreReady: 3,
    exitArm: 1.2,         // 近 60 日最低收盘 × 1.2 启动
    exitTrail: 0.05,      // 启动后最高收盘 × 0.95 离场
    exitCooldown: 60      // 卖出后多少个交易日内不给买回提示
  };

  function n(v) {
    if (v === null || v === undefined || v === '') return null;
    var x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  function closeSeries(bars) {
    return bars.map(function (b) { return n(b && b.close); });
  }

  function pctText(v, digits) {
    if (v === null) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(digits === undefined ? 1 : digits) + '%';
  }

  /** 最近 period 根日 K 的最低收盘价 */
  function lowestClose(closes, end, period) {
    var from = Math.max(0, end - period + 1);
    var lo = Infinity;
    for (var i = from; i <= end; i++) {
      if (closes[i] !== null && closes[i] < lo) lo = closes[i];
    }
    return Number.isFinite(lo) ? lo : null;
  }

  /** 状态判定：up / below / down */
  function regimeOf(price, ma20, ma60) {
    if (ma20 === null || ma60 === null) return null;
    if (price >= ma20) return 'up';
    return ma20 >= ma60 ? 'below' : 'down';
  }

  var REGIME_LABEL = { up: '上涨趋势', below: '上升趋势回调', down: '下跌趋势' };

  /**
   * 买入评分
   * @returns {{status:string, kind:string, score:number, scoreMax:number, dataReady:boolean,
   *   inZone:boolean, entry:number|null, gapPct:number|null, regime:string|null,
   *   veto:boolean, parts:object, reasons:Array<string>, details:object}}
   */
  function evaluateAdd(price, stock, bars) {
    var tech = root.TechInd;
    var empty = {
      status: '数据不足', kind: 'data', score: 0, scoreMax: 4, dataReady: false,
      inZone: false, entry: null, gapPct: null, regime: null, veto: false,
      parts: {}, reasons: ['日 K 不足 ' + RULES.minBars + ' 根，无法计算买入条件'], details: {}
    };
    if (!(price > 0) || !Array.isArray(bars) || bars.length < RULES.minBars || !tech) return empty;

    var entry = n(stock && stock.entry);
    var closes = closeSeries(bars);
    var last = bars.length - 1;

    var ma20 = tech.ma(bars, RULES.maPeriod).latest;
    var ma60 = tech.ma(bars, RULES.maLong).latest;
    var rsiRes = tech.rsi ? tech.rsi(bars, RULES.rsiPeriod) : null;
    var mfiRes = tech.mfi ? tech.mfi(bars, RULES.mfiPeriod) : null;
    var macdRes = tech.macd ? tech.macd(bars, 12, 26, 9) : null;
    var obvRes = tech.obv ? tech.obv(bars) : null;

    var rsi = rsiRes ? rsiRes.latest : null;
    var mfi = mfiRes ? mfiRes.latest : null;
    var hist = macdRes && macdRes.histogram.length ? macdRes.histogram[last] : null;
    var histPrev = macdRes && macdRes.histogram.length > 1 ? macdRes.histogram[last - 1] : null;
    var obvNow = obvRes && obvRes.series.length ? obvRes.series[last] : null;
    var obvPrev = obvRes && obvRes.series.length > 20 ? obvRes.series[last - 20] : null;

    var regime = regimeOf(price, ma20, ma60);
    var dev20 = ma20 ? (price / ma20 - 1) * 100 : null;
    var low60 = lowestClose(closes, last, RULES.minBars);
    var peak60 = null;
    for (var i = Math.max(0, last - RULES.minBars + 1); i <= last; i++) {
      if (closes[i] !== null && (peak60 === null || closes[i] > peak60)) peak60 = closes[i];
    }
    var dd60 = peak60 ? (price / peak60 - 1) * 100 : null;

    var macdImproving = hist !== null && histPrev !== null && hist > histPrev;
    var obvUp = obvNow !== null && obvPrev !== null && obvNow >= obvPrev;

    var parts = {
      depth: false, rsi: false, mfi: false, mom: macdImproving || obvUp
    };
    if (regime === 'down') {
      parts.depth = (dev20 !== null && dev20 <= -RULES.deepDev) || (dd60 !== null && dd60 <= -RULES.deepDrawdown);
      parts.rsi = rsi !== null && rsi <= RULES.rsiDown;
      parts.mfi = mfi !== null && mfi >= RULES.mfiDownOk;
    } else if (regime === 'below') {
      parts.depth = (dev20 !== null && dev20 <= -RULES.shallowDev) || (dd60 !== null && dd60 <= -RULES.shallowDrawdown);
      parts.rsi = rsi !== null && rsi >= RULES.rsiPullbackLow && rsi < RULES.rsiPullbackHigh;
      parts.mfi = mfi !== null && mfi < RULES.mfiOtherOk;
    } else {
      parts.depth = dev20 !== null && dev20 <= -RULES.shallowDev;
      parts.rsi = rsi !== null && rsi <= RULES.rsiUp;
      parts.mfi = mfi !== null && mfi < RULES.mfiOtherOk;
    }

    var score = 0;
    Object.keys(parts).forEach(function (k) { if (parts[k]) score++; });

    var veto = regime === 'down' && mfi !== null && mfi < RULES.mfiVeto;
    var inZone = entry !== null && entry > 0 && price < entry;
    var gapPct = entry ? (price / entry - 1) * 100 : null;

    var reasons = [];
    if (entry === null || !(entry > 0)) {
      reasons.push('未配置计划入场价，不生成买入信号');
    } else if (inZone) {
      reasons.push('现价 ' + price.toFixed(2) + ' < 入场价 ' + entry.toFixed(2) + '（' + pctText(gapPct) + '）');
    } else {
      reasons.push('现价 ' + price.toFixed(2) + ' ≥ 入场价 ' + entry.toFixed(2) + '（' + pctText(gapPct) + '），不追高');
    }
    reasons.push((parts.depth ? '✓' : '✗') + ' 超跌深度：偏离 MA20 ' + (dev20 === null ? '—' : dev20.toFixed(1) + '%')
      + '，60 日回撤 ' + (dd60 === null ? '—' : dd60.toFixed(1) + '%'));
    reasons.push((parts.rsi ? '✓' : '✗') + ' RSI(14) ' + (rsi === null ? '—' : rsi.toFixed(1)));
    reasons.push((parts.mfi ? '✓' : '✗') + ' MFI(14) ' + (mfi === null ? '—' : mfi.toFixed(1))
      + (regime === 'down' ? '（下跌趋势需 ≥' + RULES.mfiDownOk + '）' : '（需 <' + RULES.mfiOtherOk + '）'));
    reasons.push((parts.mom ? '✓' : '✗') + ' 动能：MACD 柱 ' + (hist === null ? '—' : hist.toFixed(3))
      + (macdImproving ? '（改善）' : '（未改善）') + '；OBV ' + (obvUp ? '未创新低' : '走弱'));
    if (veto) reasons.push('！下跌趋势 + MFI<' + RULES.mfiVeto + '：资金持续流出，一票否决');

    var status, kind;
    if (entry === null || !(entry > 0)) { status = '未配置入场价'; kind = 'data'; }
    else if (!inZone) { status = '高于入场价'; kind = 'watch'; }
    else if (veto) { status = '观望 · 资金流出'; kind = 'watch'; }
    else if (score >= RULES.scoreReady) { status = '买入条件较齐备'; kind = 'add-ready'; }
    else if (score === RULES.scoreReady - 1) { status = '买入条件部分满足'; kind = 'add-watch'; }
    else { status = '观望'; kind = 'watch'; }

    return {
      status: status, kind: kind, score: score, scoreMax: 4, dataReady: true,
      inZone: inZone, entry: entry, gapPct: gapPct, regime: regime,
      regimeLabel: regime ? REGIME_LABEL[regime] : '状态未知',
      veto: veto, parts: parts, reasons: reasons,
      details: {
        dev20: dev20, dd60: dd60, rsi: rsi, mfi: mfi, ma20: ma20, ma60: ma60,
        low60: low60, peak60: peak60, macdHist: hist, macdImproving: macdImproving, obvUp: obvUp
      }
    };
  }

  /**
   * 止盈跟踪（不需要成本价）
   * 启动：近 60 日最低收盘 × 1.2；离场：启动后最高收盘 × 0.95
   */
  function evaluateExit(price, stock, bars) {
    var tech = root.TechInd;
    if (!(price > 0) || !Array.isArray(bars) || bars.length < RULES.minBars) {
      return {
        state: '数据不足', kind: 'data', armed: false, armLine: null, exitLine: null,
        peak: null, low60: null, drawdown: null, peakDate: '', triggerDate: '',
        reasons: ['日 K 不足 ' + RULES.minBars + ' 根，无法计算止盈线']
      };
    }
    var closes = closeSeries(bars);
    var last = bars.length - 1;
    var start = Math.max(0, last - 120);

    var armed = false;
    var peak = null, peakIdx = -1, armIdx = -1;
    var triggerIdx = -1;
    var low60 = null;

    for (var i = start; i <= last; i++) {
      if (closes[i] === null) continue;
      low60 = lowestClose(closes, i, RULES.minBars);
      if (!armed) {
        if (low60 !== null && closes[i] >= low60 * RULES.exitArm) {
          armed = true; armIdx = i; peak = closes[i]; peakIdx = i;
        }
      } else {
        if (closes[i] > peak) { peak = closes[i]; peakIdx = i; triggerIdx = -1; }
        else if (triggerIdx < 0 && closes[i] <= peak * (1 - RULES.exitTrail)) triggerIdx = i;
      }
    }

    var armLine = low60 !== null ? low60 * RULES.exitArm : null;
    var exitLine = peak !== null ? peak * (1 - RULES.exitTrail) : null;
    var drawdown = peak ? (price / peak - 1) * 100 : null;
    var distanceToExit = exitLine ? (price / exitLine - 1) * 100 : null;
    var barsSinceTrigger = triggerIdx >= 0 ? last - triggerIdx : -1;
    var cooldownDays = barsSinceTrigger >= 0 && barsSinceTrigger < RULES.exitCooldown ? RULES.exitCooldown - barsSinceTrigger : 0;

    var state, kind;
    if (!armed) { state = '未启动'; kind = 'exit-idle'; }
    else if (barsSinceTrigger < 0) { state = '跟踪中'; kind = 'exit-armed'; }
    else if (barsSinceTrigger <= 2) { state = '已触发'; kind = 'exit-triggered'; }
    else { state = '已离场'; kind = 'exit-closed'; }

    var reasons = [];
    if (!armed) {
      reasons.push('未启动：现价 ' + price.toFixed(2) + '，启动线 ' + (armLine === null ? '—' : armLine.toFixed(2))
        + '（近 60 日最低收盘 ' + (low60 === null ? '—' : low60.toFixed(2)) + ' × 1.2）');
    } else {
      reasons.push('已启动：启动线 ' + (armLine === null ? '—' : armLine.toFixed(2))
        + '，启动后最高收盘 ' + peak.toFixed(2) + '（' + (bars[peakIdx] ? bars[peakIdx].time : '') + '）');
      reasons.push('离场线 ' + exitLine.toFixed(2) + '（最高收盘 × 0.95），现价距线 ' + pctText(distanceToExit));
      if (state === '已触发') {
        reasons.push('已触发：收盘低于离场线，按规则次日收盘确认后卖出');
      } else if (state === '已离场') {
        reasons.push('已离场：' + (barsSinceTrigger >= 0 ? barsSinceTrigger : 0) + ' 个交易日前触发，本轮跟踪结束'
          + (cooldownDays > 0 ? '，冷却剩余 ' + cooldownDays + ' 个交易日' : ''));
      } else {
        reasons.push('跟踪中：回撤 ' + (drawdown === null ? '—' : drawdown.toFixed(1)) + '%，未达 5% 阈值');
      }
    }
    if (triggerIdx >= 0) {
      reasons.push('触发日 ' + bars[triggerIdx].time + '，收盘 ' + bars[triggerIdx].close.toFixed(2));
    }

    return {
      state: state, kind: kind, armed: armed,
      armLine: armLine, exitLine: exitLine, peak: peak, low60: low60,
      drawdown: drawdown, distanceToExit: distanceToExit,
      barsSinceTrigger: barsSinceTrigger, cooldownDays: cooldownDays,
      peakDate: peakIdx >= 0 && bars[peakIdx] ? bars[peakIdx].time : '',
      triggerDate: triggerIdx >= 0 ? bars[triggerIdx].time : '',
      reasons: reasons
    };
  }

  root.StockTradeSignals = {
    evaluateAdd: evaluateAdd,
    evaluateExit: evaluateExit,
    rules: { add: RULES, exit: RULES, all: RULES }
  };
})(typeof window !== 'undefined' ? window : globalThis);
