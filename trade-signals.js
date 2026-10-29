/* Shared, pure trade-signal calculations for the combat center. */
(function (root) {
  'use strict';
  var T_RULES = { vwapDev: 1, mfiLow: 25, mfiHigh: 75, volSurge: 1.3, volShrink: 1, trendDev: 2.5, spread: 2, stall: 0.5 };
  var ADD_RULES = { supportDist: 3, mfiLow: 20, mfiRecoverBars: 10, maPeriod: 20, obvLookback: 20, profileLookback: 120 };
  function n(v) { var x = Number(v); return v !== null && v !== '' && Number.isFinite(x) ? x : null; }
  function recentStall(bars) {
    if (!bars || bars.length < 5) return false;
    var last = bars[bars.length - 1], ref = bars[bars.length - 4];
    return !!(last && ref && n(last.close) !== null && n(ref.close) > 0 && Math.abs((last.close / ref.close - 1) * 100) <= T_RULES.stall);
  }
  function vwap(detail, trends) {
    var points = trends && Array.isArray(trends.points) ? trends.points : [];
    if (points.length) {
      var last = points[points.length - 1];
      if (n(last.avg) > 0) return { value: n(last.avg), source: '分时均价', time: last.time };
      var amount = 0, vol = 0, pv = 0;
      points.forEach(function (p) {
        var v = n(p.volume) || 0;
        if (n(p.amount) > 0 && v > 0) { amount += p.amount; vol += v; }
        else if (n(p.price) > 0 && v > 0) { pv += p.price * v; vol += v; }
      });
      if (amount > 0 && vol > 0) return { value: amount / (vol * 100), source: '分时成交额', time: last.time };
      if (pv > 0 && vol > 0) return { value: pv / vol, source: '分时加权', time: last.time };
    }
    return detail && n(detail.avg) > 0 ? { value: n(detail.avg), source: '当日均价', time: detail.time || null } : null;
  }
  function evaluateT(price, detail, trends, bars, holdingQty) {
    var reasons = [], vw = vwap(detail, trends), tech = root.TechInd;
    if (!(holdingQty > 0)) return { status: '观望', kind: 'watch', reasons: ['无持仓：不生成做T卖出条件'], dataReady: true };
    if (!Array.isArray(bars) || bars.length < 16 || !tech || !vw || !(price > 0)) {
      return { status: '数据不足', kind: 'data', reasons: ['做T需要有效分时均价与至少 16 根 15 分钟K'], dataReady: false };
    }
    var todayCn = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    var lastBarDate = String(bars[bars.length - 1] && bars[bars.length - 1].time || '').slice(0, 10);
    var lastTrendDate = String(trends && trends.points && trends.points.length ? trends.points[trends.points.length - 1].time || '' : '').slice(0, 10);
    if (lastBarDate !== todayCn || (lastTrendDate && lastTrendDate !== todayCn)) {
      return { status: '数据不足', kind: 'data', reasons: ['分钟K / 分时均价不是北京时间今天的数据，避免使用过期信号做T'], dataReady: false };
    }
    var mfiRes = tech.mfi(bars, 14), mfi = mfiRes ? mfiRes.latest : null;
    var vr = bars.length >= 15 ? tech.volumeRatio(bars, 3, 12) : null;
    var dev = (price / vw.value - 1) * 100, surge = vr !== null && vr >= T_RULES.volSurge;
    var shrink = vr !== null && vr < T_RULES.volShrink, single = Math.abs(dev) > T_RULES.trendDev && surge;
    var buy = dev <= -T_RULES.vwapDev && mfi !== null && mfi < T_RULES.mfiLow && shrink;
    var sell = dev >= T_RULES.vwapDev && mfi !== null && mfi > T_RULES.mfiHigh && surge && recentStall(bars);
    reasons.push('现价较均价 ' + (dev > 0 ? '+' : '') + dev.toFixed(2) + '%（阈值 ±' + T_RULES.vwapDev + '%）');
    reasons.push('15分 MFI ' + (mfi === null ? '不足' : mfi.toFixed(1)) + '；量比 ' + (vr === null ? '不足' : vr.toFixed(2) + '×'));
    if (single) return { status: '风险拦截', kind: 'risk', reasons: reasons.concat(['偏离均价超过 ' + T_RULES.trendDev + '% 且放量，禁止逆势做T']), dataReady: true };
    if (buy) return { status: '做T低吸条件满足', kind: 't-buy', reasons: reasons.concat(['低于均价、MFI 超卖且缩量']), dataReady: true, vwap: vw.value, target: vw.value * (1 + T_RULES.spread / 100) };
    if (sell) return { status: '做T高抛条件满足', kind: 't-sell', reasons: reasons.concat(['高于均价、MFI 超买、放量且近几根滞涨']), dataReady: true, vwap: vw.value };
    return { status: '观望', kind: 'watch', reasons: reasons.concat([single ? '单边过滤' : '未同时满足做T触发条件']), dataReady: true, vwap: vw.value };
  }
  function evaluateAdd(price, stock, bars) {
    var tech = root.TechInd, reasons = [];
    if (!(price > 0) || !Array.isArray(bars) || bars.length < 20 || !tech) {
      return { status: '数据不足', kind: 'data', reasons: ['补仓需要至少 20 根有效日K'], dataReady: false, score: 0 };
    }
    var profile = bars.length >= 20 ? tech.volumeProfile(bars, { bins: 30, lookback: ADD_RULES.profileLookback }) : null;
    var mfiRes = bars.length >= 16 ? tech.mfi(bars, 14) : null;
    var mfi = mfiRes ? mfiRes.latest : null;
    var div = mfiRes ? tech.detectDivergence(bars, mfiRes.series) : null;
    var bottomDiv = div && div.type === 'bottom';
    var recover = false, recoverLow = null;
    if (mfiRes && mfiRes.series.length >= 3) {
      var series = mfiRes.series, latest = series[series.length - 1];
      if (n(latest) !== null && latest >= ADD_RULES.mfiLow) {
        var from = Math.max(0, series.length - 1 - ADD_RULES.mfiRecoverBars);
        for (var i = series.length - 2; i >= from; i--) if (n(series[i]) !== null && series[i] < ADD_RULES.mfiLow) { recover = true; recoverLow = series[i]; break; }
      }
    }
    var maRes = bars.length >= ADD_RULES.maPeriod ? tech.ma(bars, ADD_RULES.maPeriod) : null;
    var maLatest = maRes ? maRes.latest : null, aboveMa = n(maLatest) !== null && price > maLatest;
    var obvNewLow = null;
    if (bars.length >= ADD_RULES.obvLookback) {
      var obvRes = tech.obv(bars), arr = obvRes.series.slice(-ADD_RULES.obvLookback).filter(function (v) { return n(v) !== null; });
      if (arr.length >= 2) obvNewLow = arr[arr.length - 1] <= Math.min.apply(null, arr.slice(0, -1));
    }
    var trendKnown = n(maLatest) !== null || obvNewLow !== null, trendOk = aboveMa || obvNewLow === false;
    var supports = [];
    if (profile && n(profile.poc) > 0) supports.push({ label: 'POC', value: profile.poc });
    if (profile && n(profile.val) > 0) supports.push({ label: '价值区下沿', value: profile.val });
    if (n(stock.heavy) > 0) supports.push({ label: '计划重仓价', value: stock.heavy });
    supports.sort(function (a, b) { return Math.abs(price / a.value - 1) - Math.abs(price / b.value - 1); });
    var support = supports[0] || null, dist = support ? Math.abs(price / support.value - 1) * 100 : null;
    var supportOk = !!support && dist <= ADD_RULES.supportDist, confirmOk = !!bottomDiv || recover;
    var confirmKnown = !!mfiRes, score = [supportOk, confirmOk, trendOk].filter(Boolean).length;
    reasons.push(support ? support.label + ' ' + support.value.toFixed(2) + '，距离 ' + dist.toFixed(1) + '%' : '支撑数据不足');
    reasons.push(bottomDiv ? 'MFI 底背离确认' : recover ? 'MFI ' + recoverLow.toFixed(1) + ' 后回升上穿 ' + ADD_RULES.mfiLow : (confirmKnown ? '无 MFI 底背离 / 回升确认' : 'MFI 数据不足'));
    reasons.push('趋势过滤：' + (trendKnown ? (trendOk ? '通过' : '偏弱') : '数据不足') + '；MA20 ' + (n(maLatest) === null ? '—' : maLatest.toFixed(2)) + '；OBV ' + (obvNewLow === null ? '—' : obvNewLow ? '创新低' : '未创新低'));
    return { status: score >= 3 ? '补仓条件较齐备' : score === 2 ? '补仓条件部分满足' : '观望', kind: score >= 3 ? 'add-ready' : score === 2 ? 'add-watch' : 'watch', reasons: reasons, score: score, dataReady: true, support: support, supportDist: dist, profile: profile, mfi: mfi };
  }
  root.StockTradeSignals = { evaluateT: evaluateT, evaluateAdd: evaluateAdd, rules: { t: T_RULES, add: ADD_RULES } };
})(typeof window !== 'undefined' ? window : globalThis);
