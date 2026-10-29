/* Shared, pure trade-signal calculations for the combat center. */
(function (root) {
  'use strict';
  var ADD_RULES = { supportDist: 3, mfiLow: 20, mfiRecoverBars: 10, maPeriod: 20, obvLookback: 20, profileLookback: 120 };
  function n(v) { var x = Number(v); return v !== null && v !== '' && Number.isFinite(x) ? x : null; }
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
    var rsiRes = tech.rsi ? tech.rsi(bars, 14) : null;
    var rsi = rsiRes ? rsiRes.latest : null;
    var rsiPrev = rsiRes && rsiRes.series.length > 1 ? rsiRes.series[rsiRes.series.length - 2] : null;
    var rsiOk = rsi !== null && (rsi <= 35 || (rsi < 50 && rsiPrev !== null && rsi > rsiPrev));
    var macdRes = tech.macd ? tech.macd(bars, 12, 26, 9) : null;
    var macd = macdRes ? macdRes.latest : null;
    var macdPrevHist = macdRes && macdRes.histogram.length > 1 ? macdRes.histogram[macdRes.histogram.length - 2] : null;
    var macdOk = !!(macd && (macd.dif > macd.dea || (macdPrevHist !== null && macd.histogram > macdPrevHist)));
    var supports = [];
    if (profile && n(profile.poc) > 0) supports.push({ label: 'POC', value: profile.poc });
    if (profile && n(profile.val) > 0) supports.push({ label: '价值区下沿', value: profile.val });
    if (n(stock.entry) > 0) supports.push({ label: stock.inHolding ? '计划入场价' : '计划买入价', value: stock.entry });
    if (n(stock.heavy) > 0) supports.push({ label: '计划重仓价', value: stock.heavy });
    supports.sort(function (a, b) { return Math.abs(price / a.value - 1) - Math.abs(price / b.value - 1); });
    var support = supports[0] || null, dist = support ? Math.abs(price / support.value - 1) * 100 : null;
    var supportOk = !!support && dist <= ADD_RULES.supportDist, confirmOk = !!bottomDiv || recover;
    var confirmKnown = !!mfiRes;
    var scoreParts = [supportOk, confirmOk, trendOk, rsiOk, macdOk];
    var score = scoreParts.filter(Boolean).length;
    reasons.push(support ? support.label + ' ' + support.value.toFixed(2) + '，距离 ' + dist.toFixed(1) + '%' : '支撑数据不足');
    reasons.push(bottomDiv ? 'MFI 底背离确认' : recover ? 'MFI ' + recoverLow.toFixed(1) + ' 后回升上穿 ' + ADD_RULES.mfiLow : (confirmKnown ? '无 MFI 底背离 / 回升确认' : 'MFI 数据不足'));
    reasons.push('趋势过滤：' + (trendKnown ? (trendOk ? '通过' : '偏弱') : '数据不足') + '；MA20 ' + (n(maLatest) === null ? '—' : maLatest.toFixed(2)) + '；OBV ' + (obvNewLow === null ? '—' : obvNewLow ? '创新低' : '未创新低'));
    reasons.push('RSI(14) ' + (rsi === null ? '数据不足' : rsi.toFixed(1) + (rsiOk ? '（低位/回升确认）' : '（未确认）')));
    reasons.push('MACD ' + (macd === null ? '数据不足' : 'DIF ' + macd.dif.toFixed(3) + ' / DEA ' + macd.dea.toFixed(3) + (macdOk ? '（动能改善）' : '（未确认）')));
    var actionName = '买入';
    return { status: score >= 4 ? actionName + '条件较齐备' : score >= 3 ? actionName + '条件部分满足' : '观望', kind: score >= 4 ? 'add-ready' : score >= 3 ? 'add-watch' : 'watch', action: actionName, reasons: reasons, score: score, scoreMax: 5, dataReady: true, support: support, supportDist: dist, profile: profile, mfi: mfi, rsi: rsi, macd: macd, confirmations: { support: supportOk, mfi: confirmOk, trend: trendOk, rsi: rsiOk, macd: macdOk } };
  }
  root.StockTradeSignals = { evaluateAdd: evaluateAdd, rules: { add: ADD_RULES } };
})(typeof window !== 'undefined' ? window : globalThis);
