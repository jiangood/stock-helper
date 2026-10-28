/* Read-only portfolio risk center backed by public holdings.json. Does not place orders or change Croc rules. */
(function (root) {
  'use strict';

  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function calculateHolding(holding, quote, plan, riskPlan) {
    holding = holding || {}; quote = quote || {}; plan = plan || {}; riskPlan = riskPlan || {};
    var quantity = num(holding.quantity), cost = num(holding.cost), price = num(quote.price);
    var validQuantity = quantity !== null && quantity > 0;
    var validCost = cost !== null && cost > 0;
    var validPrice = price !== null && price > 0;
    var marketValue = validQuantity && validPrice ? quantity * price : null;
    var costValue = validQuantity && validCost ? quantity * cost : null;
    var pnl = marketValue !== null && costValue !== null ? marketValue - costValue : null;
    var pnlPct = pnl !== null && costValue > 0 ? pnl / costValue * 100 : null;
    var doublePrice = validCost ? cost * 2 : null;
    var stopLoss = num(riskPlan.stopLoss);
    var target1 = num(riskPlan.target1 !== undefined && riskPlan.target1 !== '' ? riskPlan.target1 : plan.tp1);
    var target2 = num(riskPlan.target2 !== undefined && riskPlan.target2 !== '' ? riskPlan.target2 : plan.tp2);
    var stopRisk = null, stopDistancePct = null, stopState = 'unset';
    if (stopLoss !== null && validPrice) {
      if (stopLoss > 0 && stopLoss < price) {
        stopRisk = (price - stopLoss) * quantity;
        stopDistancePct = (price - stopLoss) / price * 100;
        stopState = 'valid';
      } else stopState = 'invalid';
    } else if (stopLoss !== null) stopState = 'unverified';
    function targetGain(target) {
      return validPrice && validQuantity && target !== null && target > price ? (target - price) * quantity : null;
    }
    return {
      code: String(holding.code || '').toLowerCase(), name: holding.name || plan.name || holding.code || '未命名',
      quantity: validQuantity ? quantity : null, cost: validCost ? cost : null, price: validPrice ? price : null,
      quoteTime: quote.time || null, marketValue: marketValue, costValue: costValue, pnl: pnl, pnlPct: pnlPct,
      weightOfStocks: null, weightOfAssets: null, stopLoss: stopLoss, stopRisk: stopRisk,
      doublePrice: doublePrice, doubleReached: validPrice && doublePrice !== null && price >= doublePrice,
      stopDistancePct: stopDistancePct, stopState: stopState, target1: target1, target2: target2,
      target1Gain: targetGain(target1), target2Gain: targetGain(target2),
      target1Reached: validPrice && target1 !== null && price >= target1,
      target2Reached: validPrice && target2 !== null && price >= target2
    };
  }

  function summarize(rows, accountEquity, riskBudget) {
    rows = Array.isArray(rows) ? rows : [];
    var equity = num(accountEquity), budget = num(riskBudget);
    var validRows = rows.filter(function (r) { return r.marketValue !== null; });
    var completeQuotes = validRows.length === rows.length && rows.length > 0;
    var knownMarketValue = validRows.reduce(function (sum, r) { return sum + r.marketValue; }, 0);
    var totalMarketValue = completeQuotes ? knownMarketValue : null;
    rows.forEach(function (r) {
      r.weightOfStocks = completeQuotes && totalMarketValue > 0 && r.marketValue !== null ? r.marketValue / totalMarketValue * 100 : null;
      r.weightOfAssets = equity !== null && equity > 0 && r.marketValue !== null ? r.marketValue / equity * 100 : null;
    });
    var knownPnlRows = rows.filter(function (r) { return r.pnl !== null; });
    var pnlComplete = knownPnlRows.length === rows.length && rows.length > 0;
    var costRows = rows.filter(function (r) { return r.costValue !== null; });
    var costComplete = costRows.length === rows.length && rows.length > 0;
    var totalCostValue = costComplete ? costRows.reduce(function (sum, r) { return sum + r.costValue; }, 0) : null;
    var totalPnl = pnlComplete ? knownPnlRows.reduce(function (sum, r) { return sum + r.pnl; }, 0) : null;
    var rankedRows = completeQuotes ? rows.slice().sort(function (a, b) { return b.marketValue - a.marketValue; }) : [];
    var largestHolding = rankedRows.length ? rankedRows[0] : null;
    var topThreeValue = rankedRows.slice(0, 3).reduce(function (sum, r) { return sum + r.marketValue; }, 0);
    var riskRows = rows.filter(function (r) { return r.stopRisk !== null; });
    var missingRisk = rows.length - riskRows.length;
    var knownRisk = riskRows.reduce(function (sum, r) { return sum + r.stopRisk; }, 0);
    return {
      count: rows.length, completeQuotes: completeQuotes, knownMarketValue: knownMarketValue,
      totalMarketValue: totalMarketValue, accountEquity: equity !== null && equity > 0 ? equity : null,
      accountExposurePct: equity !== null && equity > 0 && completeQuotes ? totalMarketValue / equity * 100 : null,
      totalCostValue: totalCostValue, pnl: totalPnl,
      portfolioPnlPct: pnlComplete && totalCostValue !== null && totalCostValue > 0 ? totalPnl / totalCostValue * 100 : null,
      pnlComplete: pnlComplete, largestHoldingName: largestHolding ? largestHolding.name : null,
      largestHoldingWeight: largestHolding && totalMarketValue > 0 ? largestHolding.marketValue / totalMarketValue * 100 : null,
      topThreeWeight: completeQuotes && totalMarketValue > 0 ? topThreeValue / totalMarketValue * 100 : null,
      knownRisk: knownRisk, missingRisk: missingRisk,
      riskComplete: rows.length > 0 && missingRisk === 0,
      riskBudget: budget !== null && budget > 0 ? budget : null,
      riskBudgetPct: budget !== null && budget > 0 && missingRisk === 0 ? knownRisk / budget * 100 : null,
      budgetExceeded: budget !== null && budget > 0 && missingRisk === 0 ? knownRisk > budget : null
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
  function pct(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(2) + '%';
  }
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
    if (root.document.getElementById('risk-pane')) { initialized = true; return; }
    var nav = root.document.querySelector('.bottom-tabs');
    if (!nav) return;
    nav.style.gridTemplateColumns = 'repeat(6, minmax(0, 1fr))';
    var tab = root.document.createElement('button');
    tab.className = 'bottom-tab'; tab.type = 'button'; tab.dataset.target = 'risk';
    tab.innerHTML = '<span class="tab-icon">⚖</span><span>风险</span>';
    nav.appendChild(tab);
    var pane = root.document.createElement('main');
    pane.id = 'risk-pane'; pane.dataset.pane = 'risk';
    pane.className = 'app-pane container-fluid px-3 py-3 d-none';
    pane.innerHTML = [
      '<div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3"><div><div class="panel-title">持仓风险中心</div><div class="panel-subtitle">只读当前浏览器的持仓与页面行情；风险退出参考价、组合总资产和风险预算由你手工设定。不会下单，也不修改原有鳄鱼纪律。</div></div><div id="risk-quote-note" class="panel-subtitle">等待行情数据…</div></div>',
      '<div id="risk-summary" class="row g-2 mb-3"></div>',
      '<section class="insight-card mb-3"><div class="fw-semibold mb-2">组合参数（来自 holdings.json）</div><div class="d-flex flex-wrap gap-4"><div><div class="mini-label">组合总资产</div><div id="risk-account-equity-value" class="fw-semibold">未设置</div></div><div><div class="mini-label">组合风险预算</div><div id="risk-budget-value" class="fw-semibold">未设置</div></div></div><div id="risk-source-note" class="panel-subtitle mt-2">参数与持仓统一维护在data/holdings.json 中。</div></section>',
      '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2"><div><div class="panel-title">实际持仓风险明细</div><div class="panel-subtitle">持仓、风险退出参考价和止盈覆盖值均从 holdings.json 读取；网页只读。</div></div><button id="risk-refresh" class="btn btn-sm btn-outline-secondary" type="button">重新读取 JSON</button></div>',
      '<div id="risk-positions" class="insight-grid mb-3"></div>',
      '<div class="panel-subtitle mt-2">口径说明：参考价风险敞口 = max(现价 − 风险退出参考价, 0) × 持股数量；仅在参考价低于有效现价时计算。未设参考价、行情缺失或参数无效的持仓不会被当作风险为零。鳄鱼体系强调区分正常波动与本金永久损失；这里的参考价只用于情景测算，不代表建议按价格机械止损，须结合基本面与周期逻辑。止盈收益是达到目标价时的静态情景，不是预测；未计手续费、税费、滑点、跳空和流动性影响。</div>',
      '<div class="panel-subtitle mt-2">风险预算比较只有在每只持仓都具备有效行情和有效风险退出参考价时才给出完整结论。组合总资产为手工输入，不会自动从券商同步。</div>'
    ].join('');
    nav.parentNode.insertBefore(pane, nav);
    pane.querySelector('#risk-refresh').addEventListener('click', function () { render(true); });
    initialized = true;
  }
  function render(force) {
    if (!initialized) return;
    var listNode = root.document.getElementById('risk-positions');
    if (!root.StockHoldings) {
      if (listNode) listNode.innerHTML = '<div class="empty-state">持仓 JSON 模块未加载，请刷新页面。</div>';
      return;
    }
    root.StockHoldings.load(!!force).then(function (data) { renderWithData(data); }).catch(function (error) {
      var list = root.document.getElementById('risk-positions');
      if (list) list.innerHTML = '<div class="empty-state">读取 holdings.json 失败；请确认文件已提交并部署。' + esc(error && error.message || '') + '</div>';
    });
  }
  function renderWithData(data) {
    if (!initialized) return;
    var summaryNode = root.document.getElementById('risk-summary'), listNode = root.document.getElementById('risk-positions');
    if (!summaryNode || !listNode) return;
    var holdings = data && Array.isArray(data.holdings) ? data.holdings : [];
    var settings = data && data.portfolio ? data.portfolio : {};
    var planMap = {};
    holdings.forEach(function (h) {
      var key = String(h.code || '').toLowerCase();
      planMap[key] = { stopLoss: h.riskExitPrice };
      if (h.target1 !== null && h.target1 !== undefined) planMap[key].target1 = h.target1;
      if (h.target2 !== null && h.target2 !== undefined) planMap[key].target2 = h.target2;
    });
    var equityValue = root.document.getElementById('risk-account-equity-value');
    var budgetValue = root.document.getElementById('risk-budget-value');
    var sourceNote = root.document.getElementById('risk-source-note');
    if (equityValue) equityValue.textContent = settings.totalAssets > 0 ? '¥' + money(settings.totalAssets) : '未设置';
    if (budgetValue) budgetValue.textContent = settings.riskBudget > 0 ? '¥' + money(settings.riskBudget) : '未设置';
    if (sourceNote) sourceNote.textContent = '数据文件：data/holdings.json' +
      (data.updatedAt ? ' · 文件更新时间 ' + data.updatedAt : '') +
      (data.sourceSnapshotDate ? ' · 初始持仓来源快照 ' + data.sourceSnapshotDate : '') +
      '。修改后需提交仓库并等待 GitHub Pages 更新；此文件公开可见。';
    var rows = holdings.map(function (h) {
      var stock = stockForCode(h.code), quote = getQuote(h.code), plan = stock || { name: h.name || h.code };
      var custom = planMap[String(h.code || '').toLowerCase()] || planMap[String(stock && stock.code || '').toLowerCase()] || {};
      return calculateHolding(h, quote, plan, custom);
    });
    var summary = summarize(rows, settings.totalAssets, settings.riskBudget);
    var note = root.document.getElementById('risk-quote-note');
    if (note) note.textContent = '行情来自当前页面缓存；' + (rows.length && rows.every(function (r) { return r.quoteTime; }) ?
      '各持仓均有报价时间，仍请核对是否为最新。' : '部分报价时间缺失或行情不可用，风险金额可能不完整。');
    var cards = [
      ['持仓市值', summary.totalMarketValue === null ? (summary.count ? '部分行情缺失' : '—') : '¥' + money(summary.totalMarketValue), summary.completeQuotes ? '所有持仓均有有效价格' : '仅显示有效报价，不把缺失行情当作零'],
      ['组合浮动盈亏', summary.pnl === null ? (summary.count ? '数据不完整' : '—') : (summary.pnl > 0 ? '+' : '') + '¥' + money(summary.pnl), '按录入成本与当前页面报价计算'],
      ['组合盈亏率', summary.portfolioPnlPct === null ? '成本或行情不完整' : pct(summary.portfolioPnlPct), summary.totalCostValue === null ? '需要所有持仓都有有效成本' : '成本合计 ¥' + money(summary.totalCostValue)],
      ['组合资产仓位', summary.accountExposurePct === null ? '需填写资产 / 行情完整' : pct(summary.accountExposurePct), '组合总资产为手工输入值'],
      ['持仓集中度', summary.largestHoldingWeight === null ? '行情不完整' : esc(summary.largestHoldingName) + ' · ' + pct(summary.largestHoldingWeight), summary.topThreeWeight === null ? '前 3 大持仓占比待行情完整' : '前 3 大持仓合计 ' + pct(summary.topThreeWeight)],
      ['参考价风险敞口', summary.riskComplete ? '¥' + money(summary.knownRisk) : '不完整：' + summary.missingRisk + ' 只待设置', summary.riskBudget === null ? '可选填写组合风险预算' : (summary.riskComplete ? '预算 ¥' + money(summary.riskBudget) + ' · ' + (summary.budgetExceeded ? '超出预算' : '未超预算') : '预算比较暂不完整')]
    ];
    summaryNode.innerHTML = cards.map(function (item) {
      return '<div class="col-6 col-lg-4"><div class="insight-card h-100"><div class="mini-label">' + esc(item[0]) + '</div><div class="fs-5 fw-bold">' + esc(item[1]) + '</div><div class="mini-label mt-1">' + esc(item[2]) + '</div></div></div>';
    }).join('');
    if (!rows.length) {
      listNode.innerHTML = '<div class="empty-state">holdings.json 中暂无有效持仓。请维护data/holdings.json；网页不会保存持仓数据。</div>';
      return;
    }
    listNode.innerHTML = rows.map(function (r) {
      var configKey = r.code, config = planMap[configKey] || {}, stock = stockForCode(r.code);
      var riskState = r.stopState === 'valid' ? '有效参考价' : r.stopState === 'invalid' ? '参考价无效' : r.stopState === 'unverified' ? '待核验' : '未设参考价';
      var riskClass = r.stopState === 'valid' ? 'flag-buy' : 'flag-warn';
      var stopDetail = r.stopRisk === null ? '风险金额暂不可计算' : '参考价距离 ' + pct(r.stopDistancePct) + ' · 风险约 ¥' + money(r.stopRisk);
      function targetDetail(target, gain, reached) {
        if (target === null) return '未设置';
        if (reached) return '已触及/超过目标价';
        return gain === null ? '目标价不高于现价或行情不可用' : '静态潜在收益约 ¥' + money(gain);
      }
      var marketStatus = r.price === null ? '行情缺失' : ('现价 ' + money(r.price) + (r.quoteTime ? ' · ' + r.quoteTime : ' · 时间未返回'));
      return '<article class="insight-card">'
        + '<div class="d-flex justify-content-between align-items-start gap-2"><div><div class="fw-bold">' + esc(r.name) + '</div><div class="mini-label">' + esc(r.code) + ' · ' + esc(marketStatus) + '</div></div><span class="flag ' + riskClass + '" style="margin:0">' + esc(riskState) + '</span></div>'
        + '<div class="d-flex flex-wrap justify-content-between gap-2 mt-2"><div><div class="mini-label">持仓市值</div><div class="fs-5 fw-bold">' + (r.marketValue === null ? '—' : '¥' + money(r.marketValue)) + '</div></div><div><div class="mini-label">持仓盈亏</div><div class="fw-semibold ' + (r.pnl > 0 ? 'text-up' : r.pnl < 0 ? 'text-down' : 'text-body-secondary') + '">' + (r.pnl === null ? '—' : (r.pnl > 0 ? '+' : '') + '¥' + money(r.pnl) + ' (' + pct(r.pnlPct) + ')') + '</div></div><div><div class="mini-label">股票仓位</div><div class="fw-semibold">' + pct(r.weightOfStocks) + '</div></div><div><div class="mini-label">组合资产仓位</div><div class="fw-semibold">' + pct(r.weightOfAssets) + '</div></div></div>'
        + '<div class="row g-2 mt-1"><div class="col-12 col-md-4"><div class="mini-label">风险退出参考价 · JSON</div><div class="fw-semibold">' + (r.stopLoss === null ? '未设置' : money(r.stopLoss)) + '</div></div>'
        + '<div class="col-6 col-md-4"><div class="mini-label">止盈目标 1 · JSON/股票池默认</div><div class="fw-semibold">' + (r.target1 === null ? '未设置' : money(r.target1)) + '</div></div>'
        + '<div class="col-6 col-md-4"><div class="mini-label">止盈目标 2 · JSON/股票池默认</div><div class="fw-semibold">' + (r.target2 === null ? '未设置' : money(r.target2)) + '</div></div></div>'
        + '<div class="mini-label mt-2">成本翻倍参考价：' + (r.doublePrice === null ? '—' : money(r.doublePrice)) + ' · ' + (r.doubleReached ? '已到成本翻倍参考价' : '未到成本翻倍参考价') + '</div>'
        + '<div class="mini-label mt-2">' + esc(stopDetail) + ' · 止盈1：' + esc(targetDetail(r.target1, r.target1Gain, r.target1Reached)) + ' · 止盈2：' + esc(targetDetail(r.target2, r.target2Gain, r.target2Reached)) + '</div></article>';
    }).join('');
  }
  function initUi(stocksArg, quotesArg) {
    stocks = Array.isArray(stocksArg) ? stocksArg : []; quotes = quotesArg || {};
    ensureUi(); render();
  }
  function onTab(target) { if (target === 'risk') render(); }
  if (root.StockBusiness) {
    var originalInit = root.StockBusiness.init, originalOnTab = root.StockBusiness.onTab;
    root.StockBusiness.init = function (stocksArg, quotesArg, quoteClientArg) {
      initUi(stocksArg, quotesArg); return originalInit.apply(this, arguments);
    };
    root.StockBusiness.onTab = function (target) {
      if (typeof originalOnTab === 'function') originalOnTab.apply(this, arguments);
      onTab(target);
    };
  } else root.document.addEventListener('DOMContentLoaded', function () { ensureUi(); });
  ensureUi();
})(typeof window !== 'undefined' ? window : null);
