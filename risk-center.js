/* Local-only holdings risk center. Does not place orders or change Croc rules. */
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
    var riskRows = rows.filter(function (r) { return r.stopRisk !== null; });
    var missingRisk = rows.length - riskRows.length;
    var knownRisk = riskRows.reduce(function (sum, r) { return sum + r.stopRisk; }, 0);
    return {
      count: rows.length, completeQuotes: completeQuotes, knownMarketValue: knownMarketValue,
      totalMarketValue: totalMarketValue, accountEquity: equity !== null && equity > 0 ? equity : null,
      accountExposurePct: equity !== null && equity > 0 && completeQuotes ? totalMarketValue / equity * 100 : null,
      pnl: pnlComplete ? knownPnlRows.reduce(function (sum, r) { return sum + r.pnl; }, 0) : null,
      pnlComplete: pnlComplete, knownRisk: knownRisk, missingRisk: missingRisk,
      riskComplete: rows.length > 0 && missingRisk === 0,
      riskBudget: budget !== null && budget > 0 ? budget : null,
      riskBudgetPct: budget !== null && budget > 0 && missingRisk === 0 ? knownRisk / budget * 100 : null,
      budgetExceeded: budget !== null && budget > 0 && missingRisk === 0 ? knownRisk > budget : null
    };
  }

  var api = { num: num, calculateHolding: calculateHolding, summarize: summarize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  var HOLDINGS_KEY = 'stock-helper-local-holdings-v1', RISK_KEY = 'stock-helper-risk-plan-v1';
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
  function readJson(key, fallback) {
    try { var value = JSON.parse(root.localStorage.getItem(key) || 'null'); return value == null ? fallback : value; }
    catch (_) { return fallback; }
  }
  function readHoldings() {
    var value = readJson(HOLDINGS_KEY, []);
    return Array.isArray(value) ? value.filter(function (h) {
      return h && typeof h.code === 'string' && num(h.quantity) > 0 && num(h.cost) > 0;
    }) : [];
  }
  function readRiskPlan() {
    var value = readJson(RISK_KEY, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function saveRiskPlan(value) {
    try { root.localStorage.setItem(RISK_KEY, JSON.stringify(value)); return true; }
    catch (_) {
      var status = root.document.getElementById('risk-save-status');
      if (status) status.textContent = '保存失败：浏览器本地存储不可用。';
      return false;
    }
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
    nav.style.gridTemplateColumns = 'repeat(5, minmax(0, 1fr))';
    var tab = root.document.createElement('button');
    tab.className = 'bottom-tab'; tab.type = 'button'; tab.dataset.target = 'risk';
    tab.innerHTML = '<span class="tab-icon">⚖</span><span>风险</span>';
    nav.appendChild(tab);
    var pane = root.document.createElement('main');
    pane.id = 'risk-pane'; pane.dataset.pane = 'risk';
    pane.className = 'app-pane container-fluid px-3 py-3 d-none';
    pane.innerHTML = [
      '<div class="d-flex flex-wrap align-items-start justify-content-between gap-2 mb-3"><div><div class="panel-title">持仓风险中心</div><div class="panel-subtitle">只读当前浏览器的持仓与页面行情；止损、账户总资产和风险预算由你手工设定。不会下单，也不修改原有鳄鱼纪律。</div></div><div id="risk-quote-note" class="panel-subtitle">等待行情数据…</div></div>',
      '<div id="risk-summary" class="row g-2 mb-3"></div>',
      '<section class="insight-card mb-3"><div class="fw-semibold mb-2">组合参数</div><div class="business-form">',
      '<div><label for="risk-account-equity" class="form-label small mb-1">账户总资产（元，手工维护）</label><input id="risk-account-equity" class="form-control form-control-sm" type="number" min="0" step="0.01" placeholder="未填写则不计算总资产仓位"></div>',
      '<div><label for="risk-budget" class="form-label small mb-1">组合风险预算（元，可选）</label><input id="risk-budget" class="form-control form-control-sm" type="number" min="0" step="0.01" placeholder="按你的纪律填写，不预设"></div>',
      '<div class="wide d-flex flex-wrap gap-2 align-items-center"><button id="risk-save-settings" type="button" class="btn btn-sm btn-primary">保存参数</button><span id="risk-save-status" class="panel-subtitle">参数仅保存在本机浏览器。</span></div></div></section>',
      '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2"><div><div class="panel-title">实际持仓风险明细</div><div class="panel-subtitle">止损价默认留空；止盈目标优先读取股票池原计划价，可在此单独覆盖。</div></div><button id="risk-refresh" class="btn btn-sm btn-outline-secondary" type="button">刷新计算</button></div>',
      '<div id="risk-positions" class="insight-grid mb-3"></div>',
      '<div class="panel-subtitle mt-2">口径说明：参考价风险敞口 = max(现价 − 风险退出参考价, 0) × 持股数量；仅在参考价低于有效现价时计算。未设参考价、行情缺失或参数无效的持仓不会被当作风险为零。鳄鱼体系强调区分正常波动与本金永久损失；这里的参考价只用于情景测算，不代表建议按价格机械止损，须结合基本面与周期逻辑。止盈收益是达到目标价时的静态情景，不是预测；未计手续费、税费、滑点、跳空和流动性影响。</div>',
      '<div class="panel-subtitle mt-2">风险预算比较只有在每只持仓都具备有效行情和有效风险退出参考价时才给出完整结论。账户总资产为手工输入，不会自动从券商同步。</div>'
    ].join('');
    nav.parentNode.insertBefore(pane, nav);
    var equityInput = pane.querySelector('#risk-account-equity'), budgetInput = pane.querySelector('#risk-budget');
    var settings = readRiskPlan();
    equityInput.value = settings.accountEquity || ''; budgetInput.value = settings.riskBudget || '';
    pane.querySelector('#risk-save-settings').addEventListener('click', function () {
      var next = readRiskPlan();
      next.accountEquity = equityInput.value.trim(); next.riskBudget = budgetInput.value.trim();
      if (saveRiskPlan(next)) {
        var status = pane.querySelector('#risk-save-status');
        if (status) status.textContent = '已保存到本机：' + new Date().toLocaleString('zh-CN', { hour12: false });
        render();
      }
    });
    pane.querySelector('#risk-refresh').addEventListener('click', render);
    pane.addEventListener('change', function (event) {
      var input = event.target;
      if (!input.matches('[data-risk-code][data-risk-field]')) return;
      var config = readRiskPlan();
      config.plans = config.plans && typeof config.plans === 'object' ? config.plans : {};
      var code = input.dataset.riskCode;
      config.plans[code] = config.plans[code] || {};
      config.plans[code][input.dataset.riskField] = input.value.trim();
      if (saveRiskPlan(config)) render();
    });
    initialized = true;
  }
  function render() {
    if (!initialized) return;
    var summaryNode = root.document.getElementById('risk-summary'), listNode = root.document.getElementById('risk-positions');
    if (!summaryNode || !listNode) return;
    var holdings = readHoldings(), settings = readRiskPlan();
    var planMap = settings.plans && typeof settings.plans === 'object' ? settings.plans : {};
    var rows = holdings.map(function (h) {
      var stock = stockForCode(h.code), quote = getQuote(h.code), plan = stock || { name: h.name || h.code };
      var custom = planMap[String(h.code || '').toLowerCase()] || planMap[String(stock && stock.code || '').toLowerCase()] || {};
      return calculateHolding(h, quote, plan, custom);
    });
    var summary = summarize(rows, settings.accountEquity, settings.riskBudget);
    var note = root.document.getElementById('risk-quote-note');
    if (note) note.textContent = '行情来自当前页面缓存；' + (rows.length && rows.every(function (r) { return r.quoteTime; }) ?
      '各持仓均有报价时间，仍请核对是否为最新。' : '部分报价时间缺失或行情不可用，风险金额可能不完整。');
    var cards = [
      ['持仓市值', summary.totalMarketValue === null ? (summary.count ? '部分行情缺失' : '—') : '¥' + money(summary.totalMarketValue), summary.completeQuotes ? '所有持仓均有有效价格' : '仅显示有效报价，不把缺失行情当作零'],
      ['浮动盈亏', summary.pnl === null ? (summary.count ? '数据不完整' : '—') : (summary.pnl > 0 ? '+' : '') + '¥' + money(summary.pnl), '按录入成本与当前页面报价计算'],
      ['占账户总资产', summary.accountExposurePct === null ? '需填写资产 / 行情完整' : pct(summary.accountExposurePct), '账户总资产为手工输入值'],
      ['参考价风险敞口', summary.riskComplete ? '¥' + money(summary.knownRisk) : '不完整：' + summary.missingRisk + ' 只待设置', summary.riskBudget === null ? '可选填写组合风险预算' : (summary.riskComplete ? '预算 ¥' + money(summary.riskBudget) + ' · ' + (summary.budgetExceeded ? '超出预算' : '未超预算') : '预算比较暂不完整')]
    ];
    summaryNode.innerHTML = cards.map(function (item) {
      return '<div class="col-6 col-xl-3"><div class="insight-card h-100"><div class="mini-label">' + esc(item[0]) + '</div><div class="fs-5 fw-bold">' + esc(item[1]) + '</div><div class="mini-label mt-1">' + esc(item[2]) + '</div></div></div>';
    }).join('');
    if (!rows.length) {
      listNode.innerHTML = '<div class="empty-state">当前浏览器尚无有效持仓。请先在「简报」页录入持仓；风险配置和持仓不会跨设备同步。</div>';
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
        + '<div class="d-flex flex-wrap justify-content-between gap-2 mt-2"><div><div class="mini-label">持仓市值</div><div class="fs-5 fw-bold">' + (r.marketValue === null ? '—' : '¥' + money(r.marketValue)) + '</div></div><div><div class="mini-label">持仓盈亏</div><div class="fw-semibold ' + (r.pnl > 0 ? 'text-up' : r.pnl < 0 ? 'text-down' : 'text-body-secondary') + '">' + (r.pnl === null ? '—' : (r.pnl > 0 ? '+' : '') + '¥' + money(r.pnl) + ' (' + pct(r.pnlPct) + ')') + '</div></div><div><div class="mini-label">股票仓位</div><div class="fw-semibold">' + pct(r.weightOfStocks) + '</div></div><div><div class="mini-label">账户仓位</div><div class="fw-semibold">' + pct(r.weightOfAssets) + '</div></div></div>'
        + '<div class="row g-2 mt-1"><div class="col-12 col-md-4"><label class="form-label small mb-1">风险退出参考价（手工设定）</label><input class="form-control form-control-sm" type="number" min="0.001" step="0.001" placeholder="未设置" value="' + esc(config.stopLoss || '') + '" data-risk-code="' + esc(configKey) + '" data-risk-field="stopLoss"></div>'
        + '<div class="col-6 col-md-4"><label class="form-label small mb-1">止盈目标 1（默认股票池计划）</label><input class="form-control form-control-sm" type="number" min="0.001" step="0.001" placeholder="' + (stock && stock.tp1 != null ? esc(stock.tp1) : '未设置') + '" value="' + esc(config.target1 || '') + '" data-risk-code="' + esc(configKey) + '" data-risk-field="target1"></div>'
        + '<div class="col-6 col-md-4"><label class="form-label small mb-1">止盈目标 2（默认股票池计划）</label><input class="form-control form-control-sm" type="number" min="0.001" step="0.001" placeholder="' + (stock && stock.tp2 != null ? esc(stock.tp2) : '未设置') + '" value="' + esc(config.target2 || '') + '" data-risk-code="' + esc(configKey) + '" data-risk-field="target2"></div></div>'
        + '<div class="mini-label mt-2">成本翻倍参考价：' + (r.doublePrice === null ? '—' : money(r.doublePrice)) + ' · ' + (r.doubleReached ? '已到成本翻倍参考价' : '未到成本翻倍参考价') + '</div>'
        + '<div class="mini-label mt-2">' + esc(stopDetail) + ' · 止盈1：' + esc(targetDetail(r.target1, r.target1Gain, r.target1Reached)) + ' · 止盈2：' + esc(targetDetail(r.target2, r.target2Gain, r.target2Reached)) + '</div></article>';
    }).join('');
  }
  function refreshInputsFromSettings() {
    var settings = readRiskPlan(), equity = root.document.getElementById('risk-account-equity'), budget = root.document.getElementById('risk-budget');
    if (equity) equity.value = settings.accountEquity || '';
    if (budget) budget.value = settings.riskBudget || '';
  }
  function initUi(stocksArg, quotesArg) {
    stocks = Array.isArray(stocksArg) ? stocksArg : []; quotes = quotesArg || {};
    ensureUi(); refreshInputsFromSettings(); render();
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
