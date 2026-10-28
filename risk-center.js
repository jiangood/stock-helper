/* Read-only portfolio overview backed by public holdings.json. No orders or manual risk-price inputs. */
(function (root) {
  'use strict';
  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function calculateHolding(holding, quote, plan) {
    holding = holding || {}; quote = quote || {}; plan = plan || {};
    var quantity = num(holding.quantity), cost = num(holding.cost), price = num(quote.price);
    var validQuantity = quantity !== null && quantity > 0, validCost = cost !== null && cost > 0, validPrice = price !== null && price > 0;
    var marketValue = validQuantity && validPrice ? quantity * price : null;
    var costValue = validQuantity && validCost ? quantity * cost : null;
    var pnl = marketValue !== null && costValue !== null ? marketValue - costValue : null;
    var pnlPct = pnl !== null && costValue > 0 ? pnl / costValue * 100 : null;
    var doublePrice = validCost ? cost * 2 : null;
    var target1 = num(plan.tp1), target2 = num(plan.tp2);
    function targetGain(target) { return validPrice && validQuantity && target !== null && target > price ? (target - price) * quantity : null; }
    return {
      code: String(holding.code || '').toLowerCase(), name: plan.name || holding.code || '未命名',
      quantity: validQuantity ? quantity : null, cost: validCost ? cost : null, price: validPrice ? price : null,
      quoteTime: quote.time || null, marketValue: marketValue, costValue: costValue, pnl: pnl, pnlPct: pnlPct,
      weightOfStocks: null, doublePrice: doublePrice, doubleReached: validPrice && doublePrice !== null && price >= doublePrice,
      target1: target1, target2: target2, target1Gain: targetGain(target1), target2Gain: targetGain(target2),
      target1Reached: validPrice && target1 !== null && price >= target1, target2Reached: validPrice && target2 !== null && price >= target2
    };
  }
  function summarize(rows) {
    rows = Array.isArray(rows) ? rows : [];
    var validRows = rows.filter(function (r) { return r.marketValue !== null; });
    var completeQuotes = validRows.length === rows.length && rows.length > 0;
    var totalMarketValue = completeQuotes ? validRows.reduce(function (sum, r) { return sum + r.marketValue; }, 0) : null;
    rows.forEach(function (r) { r.weightOfStocks = completeQuotes && totalMarketValue > 0 && r.marketValue !== null ? r.marketValue / totalMarketValue * 100 : null; });
    var pnlComplete = rows.length > 0 && rows.every(function (r) { return r.pnl !== null; });
    var costComplete = rows.length > 0 && rows.every(function (r) { return r.costValue !== null; });
    var totalCostValue = costComplete ? rows.reduce(function (sum, r) { return sum + r.costValue; }, 0) : null;
    var totalPnl = pnlComplete ? rows.reduce(function (sum, r) { return sum + r.pnl; }, 0) : null;
    var rankedRows = completeQuotes ? rows.slice().sort(function (a, b) { return b.marketValue - a.marketValue; }) : [];
    var largest = rankedRows.length ? rankedRows[0] : null;
    var topThreeValue = rankedRows.slice(0, 3).reduce(function (sum, r) { return sum + r.marketValue; }, 0);
    return {
      count: rows.length, completeQuotes: completeQuotes, totalMarketValue: totalMarketValue,
      totalCostValue: totalCostValue, pnl: totalPnl,
      portfolioPnlPct: pnlComplete && totalCostValue !== null && totalCostValue > 0 ? totalPnl / totalCostValue * 100 : null,
      largestHoldingName: largest ? largest.name : null,
      largestHoldingWeight: largest && totalMarketValue > 0 ? largest.marketValue / totalMarketValue * 100 : null,
      topThreeWeight: completeQuotes && totalMarketValue > 0 ? topThreeValue / totalMarketValue * 100 : null
    };
  }
  var api = { num: num, calculateHolding: calculateHolding, summarize: summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  var stocks = [], quotes = {}, initialized = false;
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>\"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' :
      Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2) + '%'; }
  function stockForCode(code) {
    var c = String(code || '').trim().toLowerCase();
    if (/^\d{6}$/.test(c)) c = (/^[5689]/.test(c) ? 'sh' : 'sz') + c;
    return stocks.find(function (s) { return String(s.code || '').toLowerCase() === c; }) || null;
  }
  function getQuote(code) {
    var stock = stockForCode(code);
    return stock ? quotes[stock.code] || null : quotes[String(code || '').toLowerCase()] || null;
  }
  function ensureUi() {
    if (root.document.getElementById('risk-positions')) { initialized = true; return; }
    var holdingsPane = root.document.getElementById('holdings-pane');
    if (!holdingsPane) return;
    var pane = root.document.createElement('section');
    pane.id = 'risk-pane'; pane.className = 'mt-4 pt-4 border-top';
    pane.setAttribute('aria-labelledby', 'risk-center-heading');
    pane.innerHTML = [
      '<div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3"><div><div id="risk-center-heading" class="panel-title">持仓风险概览</div><div class="panel-subtitle">自动计算持仓市值、浮动盈亏、组合内仓位与集中度；不再要求维护止损参考价、组合总资产或风险预算。</div></div><div id="risk-quote-note" class="panel-subtitle">等待行情数据…</div></div>',
      '<div id="risk-summary" class="row g-2 mb-3"></div>',
      '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2"><div><div class="panel-title">实际持仓明细</div><div class="panel-subtitle">持仓数量与成本来自 holdings.json；止盈目标从股票池自动读取；网页只读。</div></div><button id="risk-refresh" class="btn btn-sm btn-outline-secondary" type="button">重新读取 JSON</button></div>',
      '<div id="risk-positions" class="insight-grid mb-3"></div>',
      '<div class="panel-subtitle mt-2">口径说明：组合盈亏按录入成本与当前页面报价计算；股票仓位为各持仓市值占全部持仓市值的比例，前 3 大持仓集中度也以全部持仓市值为分母。止盈收益是达到股票池目标价时的静态情景，不是预测；未计手续费、税费、滑点、跳空和流动性影响。该页面不计算账户总资产仓位或精确止损风险金额。</div>'
    ].join('');
    holdingsPane.appendChild(pane);
    pane.querySelector('#risk-refresh').addEventListener('click', function () { render(true); });
    initialized = true;
  }
  function render(force) {
    if (!initialized) return;
    var listNode = root.document.getElementById('risk-positions');
    if (!root.StockHoldings) { if (listNode) listNode.innerHTML = '<div class="empty-state">持仓 JSON 模块未加载，请刷新页面。</div>'; return; }
    root.StockHoldings.load(!!force).then(renderWithData).catch(function (error) {
      var list = root.document.getElementById('risk-positions');
      if (list) list.innerHTML = '<div class="empty-state">读取 holdings.json 失败；请确认文件已提交并部署。' + esc(error && error.message || '') + '</div>';
    });
  }
  function renderWithData(data) {
    if (!initialized) return;
    var summaryNode = root.document.getElementById('risk-summary'), listNode = root.document.getElementById('risk-positions');
    if (!summaryNode || !listNode) return;
    var holdings = data && Array.isArray(data.holdings) ? data.holdings : [];
    var rows = holdings.map(function (h) {
      var stock = stockForCode(h.code), quote = getQuote(h.code);
      return calculateHolding(h, quote, stock || { name: h.code });
    });
    var summary = summarize(rows), note = root.document.getElementById('risk-quote-note');
    if (note) note.textContent = '行情来自当前页面缓存；' + (rows.length && rows.every(function (r) { return r.quoteTime; }) ?
      '各持仓均有报价时间，仍请核对是否为最新。' : '部分报价时间缺失或行情不可用，相关指标会显示为未知。');
    var cards = [
      ['持仓市值', summary.totalMarketValue === null ? (summary.count ? '部分行情缺失' : '—') : '¥' + money(summary.totalMarketValue), summary.completeQuotes ? '所有持仓均有有效价格' : '行情缺失时不将缺失值当作零'],
      ['组合浮动盈亏', summary.pnl === null ? (summary.count ? '数据不完整' : '—') : (summary.pnl > 0 ? '+' : '') + '¥' + money(summary.pnl), '按录入成本与当前页面报价计算'],
      ['组合盈亏率', summary.portfolioPnlPct === null ? '成本或行情不完整' : pct(summary.portfolioPnlPct), summary.totalCostValue === null ? '需要所有持仓都有有效成本' : '成本合计 ¥' + money(summary.totalCostValue)],
      ['持仓集中度', summary.largestHoldingWeight === null ? '行情不完整' : esc(summary.largestHoldingName) + ' · ' + pct(summary.largestHoldingWeight), summary.topThreeWeight === null ? '前 3 大持仓占比待行情完整' : '前 3 大持仓合计 ' + pct(summary.topThreeWeight)]
    ];
    summaryNode.innerHTML = cards.map(function (item) {
      return '<div class="col-6 col-lg-3"><div class="insight-card h-100"><div class="mini-label">' + esc(item[0]) + '</div><div class="fs-5 fw-bold">' + esc(item[1]) + '</div><div class="mini-label mt-1">' + esc(item[2]) + '</div></div></div>';
    }).join('');
    if (!rows.length) { listNode.innerHTML = '<div class="empty-state">holdings.json 中暂无有效持仓。请维护 data/holdings.json；网页不会保存持仓数据。</div>'; return; }
    listNode.innerHTML = rows.map(function (r) {
      function targetDetail(target, gain, reached) {
        if (target === null) return '股票池未设置';
        if (reached) return '已触及/超过目标价';
        return gain === null ? '目标价不高于现价或行情不可用' : '静态潜在收益约 ¥' + money(gain);
      }
      var marketStatus = r.price === null ? '行情缺失' : ('现价 ' + money(r.price) + (r.quoteTime ? ' · ' + r.quoteTime : ' · 时间未返回'));
      return '<article class="insight-card">'
        + '<div><div class="fw-bold">' + esc(r.name) + '</div><div class="mini-label">' + esc(r.code) + ' · ' + esc(marketStatus) + '</div></div>'
        + '<div class="d-flex flex-wrap justify-content-between gap-2 mt-2"><div><div class="mini-label">持仓市值</div><div class="fs-5 fw-bold">' + (r.marketValue === null ? '—' : '¥' + money(r.marketValue)) + '</div></div><div><div class="mini-label">持仓盈亏</div><div class="fw-semibold ' + (r.pnl > 0 ? 'text-up' : r.pnl < 0 ? 'text-down' : 'text-body-secondary') + '">' + (r.pnl === null ? '—' : (r.pnl > 0 ? '+' : '') + '¥' + money(r.pnl) + ' (' + pct(r.pnlPct) + ')') + '</div></div><div><div class="mini-label">股票仓位</div><div class="fw-semibold">' + pct(r.weightOfStocks) + '</div></div></div>'
        + '<div class="row g-2 mt-1"><div class="col-6"><div class="mini-label">止盈目标 1 · 股票池</div><div class="fw-semibold">' + (r.target1 === null ? '未设置' : money(r.target1)) + '</div></div>'
        + '<div class="col-6"><div class="mini-label">止盈目标 2 · 股票池</div><div class="fw-semibold">' + (r.target2 === null ? '未设置' : money(r.target2)) + '</div></div></div>'
        + '<div class="mini-label mt-2">成本翻倍参考价：' + (r.doublePrice === null ? '—' : money(r.doublePrice)) + ' · ' + (r.doubleReached ? '已到成本翻倍参考价' : '未到成本翻倍参考价') + '</div>'
        + '<div class="mini-label mt-2">止盈1：' + esc(targetDetail(r.target1, r.target1Gain, r.target1Reached)) + ' · 止盈2：' + esc(targetDetail(r.target2, r.target2Gain, r.target2Reached)) + '</div></article>';
    }).join('');
  }
  function initUi(stocksArg, quotesArg) { stocks = Array.isArray(stocksArg) ? stocksArg : []; quotes = quotesArg || {}; ensureUi(); render(); }
  function onTab(target) { if (target === 'holdings') render(); }
  if (root.StockBusiness) {
    var originalInit = root.StockBusiness.init, originalOnTab = root.StockBusiness.onTab;
    root.StockBusiness.init = function (stocksArg, quotesArg, quoteClientArg) { initUi(stocksArg, quotesArg); return originalInit.apply(this, arguments); };
    root.StockBusiness.onTab = function (target) { if (typeof originalOnTab === 'function') originalOnTab.apply(this, arguments); onTab(target); };
  } else root.document.addEventListener('DOMContentLoaded', function () { ensureUi(); });
  ensureUi();
})(typeof window !== 'undefined' ? window : null);
