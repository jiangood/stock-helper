/* Home trading combat center: manual decision support only, never submits orders. */
(function (root) {
  'use strict';
  var state = { stocks: [], prices: {}, client: null, holdings: [], rows: [], reviews: {}, riskSettings: {}, riskPlans: {}, initialized: false, loading: false, lastRun: 0, filter: 'all', error: '' };
  var $ = function (id) { return root.document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function money(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'; }
  function pct(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? (Number(v) > 0 ? '+' : '') + Number(v).toFixed(2) + '%' : '—'; }
  function quoteTime(quote) {
    var raw = quote && quote.time, n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) return '时间未提供';
    var d = new Date(n < 1000000000000 ? n * 1000 : n);
    if (Number.isNaN(d.getTime())) return '时间格式异常';
    var label = '报价 ' + d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    var age = Date.now() - d.getTime();
    if (age > 5 * 86400000) label += ' · 超过5天未更新';
    else if (age < -5 * 60000) label += ' · 时间在未来，请核对';
    return label;
  }
  function planReviewLabel(stock) {
    var value = String(stock && stock.updDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '计划复核日期未设置';
    var parts = value.split('-').map(Number), date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) return '计划复核日期无效';
    var age = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (age < 0) return '计划复核日期在未来，请核对';
    return '计划复核 ' + value + (age > 180 ? ' · 已 ' + age + ' 天未复核，建议检查' : ' · ' + age + ' 天前');
  }
  function loadRiskSettings() {
    try {
      var raw = root.localStorage && root.localStorage.getItem('stock-helper-combat-risk-settings-v1');
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }
  function loadRiskPlans() {
    try {
      var raw = root.localStorage && root.localStorage.getItem('stock-helper-combat-risk-plans-v1');
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }
  function saveRiskSettings(settings) {
    try {
      if (!root.localStorage) return false;
      state.riskSettings = settings;
      root.localStorage.setItem('stock-helper-combat-risk-settings-v1', JSON.stringify(settings));
      return true;
    } catch (_) { return false; }
  }
  function saveRiskPlan(code, plan) {
    try {
      if (!root.localStorage) return false;
      state.riskPlans[codeOf(code)] = plan;
      root.localStorage.setItem('stock-helper-combat-risk-plans-v1', JSON.stringify(state.riskPlans));
      return true;
    } catch (_) { return false; }
  }
  function inputNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    var n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function settingNumber(name) { return inputNumber(state.riskSettings[name]); }
  function currentHoldingExposure() {
    var heldRows = state.rows.filter(function (r) { return !!r.holding; });
    if (!heldRows.length) return { complete: true, total: 0, byCode: {} };
    var total = 0, byCode = {}, complete = true;
    heldRows.forEach(function (r) {
      var q = r.quote, price = q && inputNumber(q.price), quantity = inputNumber(r.holding.quantity);
      var raw = q && Number(q.time), ts = raw > 0 ? new Date(raw < 1000000000000 ? raw * 1000 : raw).getTime() : NaN;
      var fresh = Number.isFinite(ts) && Date.now() - ts <= 5 * 86400000 && Date.now() - ts >= -5 * 60000;
      if (price === null || price <= 0 || quantity === null || quantity <= 0 || !fresh) { complete = false; return; }
      var value = price * quantity;
      total += value;
      byCode[codeOf(r.stock.code)] = value;
    });
    return { complete: complete, total: complete ? total : null, byCode: byCode };
  }
  function renderRiskBudgetSummary() {
    var node = $('combat-risk-budget-summary');
    if (!node) return;
    var equity = settingNumber('equity'), cash = settingNumber('cash'), tradePct = settingNumber('tradePct');
    var portfolioPct = settingNumber('portfolioPct'), singlePct = settingNumber('singlePct');
    var exposure = currentHoldingExposure(), cards = [];
    if (exposure.complete) {
      cards.push(['当前持仓市值', '¥' + money(exposure.total), '基于持仓数量及不超过5天的行情缓存']);
      if (equity !== null && equity > 0) {
        cards.push(['持仓占总资产', pct(exposure.total / equity * 100), '按你输入的账户总资产计算']);
        if (portfolioPct !== null && portfolioPct > 0 && portfolioPct <= 100) {
          var remaining = Math.max(0, equity * portfolioPct / 100 - exposure.total);
          cards.push(['组合剩余仓位额度', '¥' + money(remaining), '已按持仓上限扣除现有持仓']);
        }
      }
    } else cards.push(['当前持仓市值', '暂不可算', '至少一只持仓缺少有效或较新的行情']);
    if (equity !== null && equity > 0 && tradePct !== null && tradePct > 0 && tradePct <= 100) {
      cards.push(['单笔风险金额上限', '¥' + money(equity * tradePct / 100), '仍需填写入场价和低于入场价的止损价']);
    } else cards.push(['单笔风险金额上限', '待设置', '填写账户总资产与单笔风险预算比例']);
    if (cash !== null && cash >= 0) cards.push(['可用现金', '¥' + money(cash), '按手工输入值计算，不连接券商']);
    node.innerHTML = cards.map(function (x) {
      return '<div class="col-6 col-lg-3"><div class="insight-card h-100"><div class="mini-label">' + esc(x[0]) + '</div><div class="fs-6 fw-bold">' + esc(x[1]) + '</div><div class="mini-label mt-1">' + esc(x[2]) + '</div></div></div>';
    }).join('');
  }
  function riskPlanFor(code, stock) {
    var saved = state.riskPlans[codeOf(code)] || {};
    var entry = inputNumber(saved.entry);
    if (entry === null) entry = inputNumber(stock && stock.entry);
    return { entry: entry, stop: inputNumber(saved.stop) };
  }
  function calculateRiskBudget(params) {
    params = params || {};
    var equity = inputNumber(params.equity), cash = inputNumber(params.cash), tradePct = inputNumber(params.tradePct);
    var portfolioPct = inputNumber(params.portfolioPct), singlePct = inputNumber(params.singlePct);
    var entry = inputNumber(params.entry), stop = inputNumber(params.stop);
    var exposure = inputNumber(params.totalExposure), positionValue = inputNumber(params.positionValue);
    if (equity === null || equity <= 0 || cash === null || cash < 0 ||
        tradePct === null || tradePct <= 0 || tradePct > 100 ||
        portfolioPct === null || portfolioPct <= 0 || portfolioPct > 100 ||
        singlePct === null || singlePct <= 0 || singlePct > 100 ||
        entry === null || entry <= 0 || stop === null || stop <= 0 || stop >= entry ||
        exposure === null || exposure < 0 || positionValue === null || positionValue < 0) {
      return { ready: false, message: '风险参数不完整或无效；止损价必须低于入场价。' };
    }
    var riskAmount = equity * tradePct / 100, riskPerShare = entry - stop;
    var caps = [
      { shares: Math.floor(riskAmount / riskPerShare / 100) * 100, label: '单笔风险预算' },
      { shares: Math.floor(cash / entry / 100) * 100, label: '可用现金' },
      { shares: Math.floor(Math.max(0, equity * portfolioPct / 100 - exposure) / entry / 100) * 100, label: '组合持仓上限' },
      { shares: Math.floor(Math.max(0, equity * singlePct / 100 - positionValue) / entry / 100) * 100, label: '单股持仓上限' }
    ];
    caps.sort(function (a, b) { return a.shares - b.shares; });
    var limiting = caps[0], shares = Math.max(0, limiting.shares);
    return {
      ready: true, shares: shares, cost: shares * entry, lossAtStop: shares * riskPerShare,
      riskAmount: riskAmount, cap: limiting.label, entry: entry, stop: stop,
      message: shares > 0 ? '最大参考股数 ' + shares.toLocaleString('zh-CN') + ' 股 · 参考金额 ¥' + money(shares * entry) + ' · 止损价情景损失 ¥' + money(shares * riskPerShare) + ' · 约束：' + limiting.label : '当前参数下可计算股数为 0；不要为凑出买入额度而放宽纪律。'
    };
  }
  function riskCalculation(stock, row, plan) {
    var equity = settingNumber('equity'), cash = settingNumber('cash'), tradePct = settingNumber('tradePct');
    var portfolioPct = settingNumber('portfolioPct'), singlePct = settingNumber('singlePct');
    var entry = inputNumber(plan.entry), stop = inputNumber(plan.stop), exposure = currentHoldingExposure();
    var missing = [];
    if (equity === null || equity <= 0) missing.push('账户总资产');
    if (cash === null || cash < 0) missing.push('可用现金');
    if (tradePct === null || tradePct <= 0 || tradePct > 100) missing.push('单笔风险比例');
    if (portfolioPct === null || portfolioPct <= 0 || portfolioPct > 100) missing.push('组合持仓上限');
    if (singlePct === null || singlePct <= 0 || singlePct > 100) missing.push('单股持仓上限');
    if (entry === null || entry <= 0) missing.push('有效入场价');
    if (stop === null || stop <= 0 || entry !== null && stop >= entry) missing.push('低于入场价的止损价');
    if (!exposure.complete) missing.push('完整且较新的持仓行情');
    if (missing.length) return { ready: false, message: '暂不计算：请补齐' + missing.join('、') };
    return calculateRiskBudget({
      equity: equity, cash: cash, tradePct: tradePct, portfolioPct: portfolioPct, singlePct: singlePct,
      entry: entry, stop: stop, totalExposure: exposure.total,
      positionValue: exposure.byCode[codeOf(stock.code)] || 0
    });
  }
  function loadReviews() {
    try {
      var raw = root.localStorage && root.localStorage.getItem('stock-helper-combat-reviews-v1');
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) { return {}; }
  }
  function reviewFor(code) { return state.reviews[codeOf(code)] || {}; }
  function saveReview(code, review) {
    try {
      if (!root.localStorage) return false;
      state.reviews[codeOf(code)] = review;
      root.localStorage.setItem('stock-helper-combat-reviews-v1', JSON.stringify(state.reviews));
      return true;
    } catch (_) { return false; }
  }
  function summarizeReviews(reviews) {
    var records = Object.keys(reviews || {}).map(function (code) {
      var r = reviews[code] || {};
      return { code: code, review: r, action: String(r.action || '未交易'), pnl: inputNumber(r.actualPnl) };
    }).filter(function (x) { return !!x.review.savedAt; });
    var trades = records.filter(function (x) { return x.action !== '未交易'; });
    var pnlRecords = trades.filter(function (x) { return x.pnl !== null; });
    var pnlTotal = pnlRecords.reduce(function (sum, x) { return sum + x.pnl; }, 0);
    var adherence = trades.filter(function (x) { return x.review.stopAdherence === '遵守' || x.review.stopAdherence === '未遵守'; });
    var adhered = adherence.filter(function (x) { return x.review.stopAdherence === '遵守'; }).length;
    return { records: records.length, trades: trades.length, pnlCount: pnlRecords.length, pnlTotal: pnlTotal,
      pnlAverage: pnlRecords.length ? pnlTotal / pnlRecords.length : null, adherenceCount: adherence.length,
      adherenceRate: adherence.length ? adhered / adherence.length * 100 : null };
  }
  function renderReviewMetrics() {
    var node = $('combat-review-metrics');
    if (!node) return;
    var s = summarizeReviews(state.reviews);
    var cards = [
      ['已保存复盘', s.records + ' 条', '按标的汇总，保存在当前浏览器'],
      ['已记录交易', s.trades + ' 笔', '操作不为“未交易”的记录'],
      ['实际盈亏合计', s.pnlCount ? (s.pnlTotal > 0 ? '+' : '') + money(s.pnlTotal) + ' 元' : '待填写', s.pnlCount ? '已填写盈亏 ' + s.pnlCount + ' 笔' : '只统计手工填写的实际盈亏'],
      ['平均单笔盈亏', s.pnlCount ? (s.pnlAverage > 0 ? '+' : '') + money(s.pnlAverage) + ' 元' : '待填写', '仅按有实际盈亏数据的交易计算'],
      ['止损纪律执行率', s.adherenceRate === null ? '待记录' : s.adherenceRate.toFixed(1) + '%', s.adherenceCount ? '已记录是否遵守止损 ' + s.adherenceCount + ' 笔' : '不适用/未填写不纳入分母']
    ];
    node.innerHTML = cards.map(function (x) {
      return '<div class="col-6 col-xl"><div class="insight-card h-100"><div class="mini-label">' + esc(x[0]) + '</div><div class="fs-6 fw-bold">' + esc(x[1]) + '</div><div class="mini-label mt-1">' + esc(x[2]) + '</div></div></div>';
    }).join('');
  }
  function summarizeReviews(reviews) {
    var records = Object.keys(reviews || {}).map(function (code) {
      var r = reviews[code] || {};
      return { review: r, action: String(r.action || '未交易'), pnl: inputNumber(r.actualPnl) };
    }).filter(function (x) { return !!x.review.savedAt; });
    var trades = records.filter(function (x) { return x.action !== '未交易'; });
    var pnlRecords = trades.filter(function (x) { return x.pnl !== null; });
    var pnlTotal = pnlRecords.reduce(function (sum, x) { return sum + x.pnl; }, 0);
    var adherence = trades.filter(function (x) { return x.review.stopAdherence === '遵守' || x.review.stopAdherence === '未遵守'; });
    var adhered = adherence.filter(function (x) { return x.review.stopAdherence === '遵守'; }).length;
    return { records: records.length, trades: trades.length, pnlCount: pnlRecords.length, pnlTotal: pnlTotal,
      pnlAverage: pnlRecords.length ? pnlTotal / pnlRecords.length : null, adherenceCount: adherence.length,
      adherenceRate: adherence.length ? adhered / adherence.length * 100 : null };
  }
  function renderReviewMetrics() {
    var node = $('combat-review-metrics');
    if (!node) return;
    var s = summarizeReviews(state.reviews);
    var cards = [
      ['已保存复盘', s.records + ' 条', '按标的汇总，保存在当前浏览器'],
      ['已记录交易', s.trades + ' 笔', '操作不为“未交易”的记录'],
      ['实际盈亏合计', s.pnlCount ? (s.pnlTotal > 0 ? '+' : '') + money(s.pnlTotal) + ' 元' : '待填写', s.pnlCount ? '已填写盈亏 ' + s.pnlCount + ' 笔' : '只统计手工填写的实际盈亏'],
      ['平均单笔盈亏', s.pnlCount ? (s.pnlAverage > 0 ? '+' : '') + money(s.pnlAverage) + ' 元' : '待填写', '仅按有实际盈亏数据的交易计算'],
      ['止损纪律执行率', s.adherenceRate === null ? '待记录' : s.adherenceRate.toFixed(1) + '%', s.adherenceCount ? '已记录是否遵守止损 ' + s.adherenceCount + ' 笔' : '不适用/未填写不纳入分母']
    ];
    node.innerHTML = cards.map(function (x) {
      return '<div class="col-6 col-xl"><div class="insight-card h-100"><div class="mini-label">' + esc(x[0]) + '</div><div class="fs-6 fw-bold">' + esc(x[1]) + '</div><div class="mini-label mt-1">' + esc(x[2]) + '</div></div></div>';
    }).join('');
  }
  function planChecks(stock, quote, primary, eligible) {
    var checks = [], raw = quote && Number(quote.time), ts = raw > 0 ? new Date(raw < 1000000000000 ? raw * 1000 : raw).getTime() : NaN;
    var quoteFresh = Number.isFinite(ts) && Date.now() - ts <= 5 * 86400000 && Date.now() - ts >= -5 * 60000;
    checks.push((quoteFresh ? '✓' : '！') + ' 行情时间' + (quoteFresh ? '有效' : '待核对'));
    var date = String(stock && stock.updDate || '');
    var age = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Math.floor((Date.now() - new Date(date + 'T00:00:00Z').getTime()) / 86400000) : null;
    var planFresh = age !== null && age >= 0 && age <= 180;
    checks.push((planFresh ? '✓' : '！') + ' 计划复核' + (planFresh ? '未过期' : '需复核'));
    var disciplineOk = !!(eligible && eligible.eligible === true) && primary && primary.kind !== 'risk' && primary.kind !== 'data';
    checks.push((disciplineOk ? '✓' : '！') + ' 纪律门槛' + (disciplineOk ? '未拦截' : '未通过/数据不足'));
    checks.push('! 未配置明确止损价；不得将重仓价直接视为止损线');
    checks.push('! 下单前人工确认：商品周期、公司逻辑与仓位风险');
    return checks;
  }
  function codeOf(code) { return String(code || '').trim().toLowerCase(); }
  function quoteFor(code) { return state.prices[code] || state.prices[codeOf(code)] || null; }
  function statusClass(kind) { return ({ 'add-ready':'combat-good','add-watch':'combat-warn','risk':'combat-risk','data':'combat-data','watch':'combat-neutral' })[kind] || 'combat-neutral'; }
  function isHolding(code) { return state.holdings.some(function (h) { return codeOf(h.code) === codeOf(code); }); }
  function holdingFor(code) { return state.holdings.find(function (h) { return codeOf(h.code) === codeOf(code); }) || null; }
  function mergeUniverse() {
    var map = new Map();
    state.stocks.filter(function (s) { return s && s.pool !== false && s.code; }).forEach(function (s) { map.set(codeOf(s.code), Object.assign({}, s, { inPool: true })); });
    state.holdings.forEach(function (h) {
      var code = codeOf(h.code), old = map.get(code);
      if (old) old.inHolding = true;
      else map.set(code, { code: code, name: code, pool: false, inPool: false, inHolding: true });
    });
    map.forEach(function (s, code) { s.inHolding = s.inHolding || isHolding(code); });
    return Array.from(map.values());
  }
  function gate(stock, quote) {
    if (!root.Croc || typeof root.Croc.buyEligibility !== 'function') return { eligible: false, reason: '纪律模块不可用' };
    return root.Croc.buyEligibility(stock, quote || {});
  }
  async function limitedMap(items, limit, worker) {
    var next = 0;
    var workers = Array.from({ length: Math.min(limit, items.length) }, async function () {
      while (next < items.length) { var i = next++; try { await worker(items[i]); } catch (_) {} }
    });
    await Promise.all(workers);
  }
  function render() {
    var summary = $('combat-summary'), list = $('combat-list'), meta = $('combat-meta');
    if (!summary || !list || !meta) return;
    var rows = state.rows, counts = { ready: 0, watch: 0, risk: 0, data: 0, add: 0 };
    rows.forEach(function (r) {
      if (r.primary.kind === 'risk') counts.risk++;
      else if (r.primary.kind === 'data') counts.data++;
      else if (r.primary.kind === 'add-ready') counts.ready++;
      else counts.watch++;
      // Only count candidates that survived the final discipline gate.
      if (r.primary.kind === 'add-ready' || r.primary.kind === 'add-watch') counts.add++;
    });
    renderRiskBudgetSummary();
    renderReviewMetrics();
    summary.innerHTML = [
      ['条件较齐备', counts.ready, '仍需人工复核'],
      ['等待确认', counts.watch, '条件未齐或未触发'],
      ['风险拦截', counts.risk, '硬性纪律优先'],
      ['数据不足', counts.data, '不生成确定信号']
    ].map(function (x) { return '<div class="col-6 col-xl-3"><div class="insight-card h-100"><div class="mini-label">' + x[0] + '</div><div class="combat-metric">' + x[1] + '</div><div class="mini-label">' + x[2] + '</div></div></div>'; }).join('');
    meta.textContent = (state.error ? '读取失败：' + state.error + ' · ' : '') + '覆盖 ' + rows.length + ' 只（持仓 + 股票池去重） · 买入观察 ' + counts.add + ' · ' + (state.lastRun ? '计算于 ' + new Date(state.lastRun).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '等待计算');
    var filtered = rows.filter(function (r) {
      if (state.filter === 'add') return r.primary.kind === 'add-ready' || r.primary.kind === 'add-watch';
      if (state.filter === 'watch') return r.primary.kind === 'watch' || r.primary.kind === 'add-watch';
      if (state.filter === 'risk') return r.primary.kind === 'risk';
      if (state.filter === 'data') return r.primary.kind === 'data';
      return true;
    });
    if (!filtered.length) {
      list.innerHTML = '<div class="empty-state">' + (state.loading ? '正在分析…' : state.error ? '作战数据读取失败：' + esc(state.error) : '当前筛选下没有标的。可切换筛选或刷新。') + '</div>';
      return;
    }
    list.innerHTML = filtered.map(function (r) {
      var s = r.stock, p = r.quote && Number(r.quote.price) > 0 ? Number(r.quote.price) : null;
      var h = r.holding, held = !!h, qty = h ? Number(h.quantity) : 0;
      var actionName = '买入';
      var badges = '<span class="combat-badge ' + statusClass(r.primary.kind) + '">' + esc(r.primary.status) + '</span>';
      if (r.add && (r.add.kind === 'add-ready' || r.add.kind === 'add-watch')) badges += '<span class="combat-badge ' + statusClass(r.add.kind) + '">' + esc(r.add.status) + ' ' + r.add.score + '/' + (r.add.scoreMax || 3) + '</span>';
      var reasons = (r.primary.reasons || []).concat(r.add && Array.isArray(r.add.reasons) ? r.add.reasons.slice(0, 2).map(function (x) { return actionName + '：' + x; }) : []);
      if (!reasons.length) reasons = ['价格未到计划区，暂不触发操作条件'];
      var plan = [Number(s.entry) > 0 ? '入场 ' + money(s.entry) : null, Number(s.heavy) > 0 ? '重仓 ' + money(s.heavy) : null, Number(s.tp1) > 0 ? '止盈1 ' + money(s.tp1) : null, Number(s.tp2) > 0 ? '止盈2 ' + money(s.tp2) : null].filter(Boolean).join(' · ');
      var pnl = held && p !== null ? (p - Number(h.cost)) * qty : null;
      var ind = r.indicators || {};
      var macd = ind.macd;
      var indicatorPanel = '<details class="combat-indicator-details"><summary class="combat-section-title">技术指标详情（点击展开）</summary><div class="combat-indicator-grid mt-2">' +
        '<div class="combat-indicator"><div class="mini-label">RSI(14) · 相对强弱</div><strong>' + (ind.rsi == null ? '—' : Number(ind.rsi).toFixed(1)) + '</strong><span>' + esc(ind.rsiState || '数据不足') + ' · ' + esc(ind.rsiTrend || '—') + '</span><small>比较近期平均涨幅与平均跌幅，常用 30/70 观察超卖/超买；极端行情中可能钝化。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">MACD(12,26,9) · 趋势动能</div><strong>' + (macd ? 'DIF ' + Number(macd.dif).toFixed(3) : '—') + '</strong><span>' + esc(ind.macdState || '数据不足') + ' · ' + esc(ind.macdCross || '—') + '</span><small>比较快慢指数均线差（DIF）与信号线（DEA）；金叉/柱体改善可提示动能变化，但信号有滞后。</small><small>' + (macd ? 'DEA ' + Number(macd.dea).toFixed(3) + ' · 柱 ' + Number(macd.histogram).toFixed(3) : '历史K线不足，无法计算') + '</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">MFI(14) · 资金流量</div><strong>' + (ind.mfi == null ? '—' : Number(ind.mfi).toFixed(1)) + '</strong><span>' + (ind.mfi == null ? '数据不足' : ind.mfi < 20 ? '低位' : ind.mfi > 80 ? '高位' : '中间区间') + '</span><small>结合价格与成交量估算资金流入流出，不能直接等同真实资金净流。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">MA20 · 20日均线</div><strong>' + (ind.ma20 == null ? '—' : money(ind.ma20)) + '</strong><span>' + (ind.ma20 == null || p === null ? '数据不足' : p > ind.ma20 ? '现价在均线上方' : '现价在均线下方') + '</span><small>过去20根日K收盘价平均值，用于观察中期价格趋势，不是支撑保证。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">OBV · 能量潮</div><strong>' + (ind.obv == null ? '—' : Math.round(ind.obv).toLocaleString('zh-CN')) + '</strong><span>' + (ind.obv == null ? '数据不足' : '累计量价方向指标') + '</span><small>上涨日加量、下跌日减量，观察量价配合；绝对值不适合跨股票比较。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">数据口径</div><strong>' + (ind.bars || 0) + ' 根日K</strong><span>' + (ind.bars >= 35 ? '可计算 RSI / MACD' : '历史长度可能不足') + '</span><small>RSI使用14期 Wilder平滑；MACD使用12/26/9；使用当前可获取的复权日K，结果会随新行情变化。</small></div>' +
        '</div><div class="mini-label mt-2">读法：RSI 与 MACD 仅作为辅助确认，仍需结合计划价、支撑、资金流量、趋势及硬性纪律；单个指标不能构成买入理由。</div></details>';
      var buyConditions = '<section class="combat-buy-conditions"><div class="combat-section-title">买入前检查</div><div class="combat-reasons mt-2">' + reasons.map(function (x) { return '<span class="combat-reason-chip">' + esc(x) + '</span>'; }).join('') + '</div><div class="combat-reasons mt-2">' + planChecks(s, r.quote, r.primary, r.eligible).map(function (x) { return '<span class="combat-reason-chip">' + esc(x) + '</span>'; }).join('') + '</div><div class="combat-invalidation mt-2"><div class="combat-section-title">计划失效 / 退出复核</div><ul class="mb-0 mt-1 ps-3"><li>行情过期、计划长期未复核或纪律拦截时，暂停新增操作并先核验数据。</li><li>商品供需/周期转向、公司经营假设被证伪时，重新评估持有逻辑与估值。</li><li>达到既定止盈目标或触发项目卖出纪律时，按原计划复核退出，不因单一技术指标机械操作。</li><li>当前股票池未配置明确止损价；重仓价不是止损价，退出阈值需由投资者单独制定。</li></ul></div></section>';
      var riskPlan = riskPlanFor(s.code, s);
      var riskResult = riskCalculation(s, r, riskPlan);
      var riskPanel = '<details class="combat-risk-card mt-2"><summary class="combat-section-title">仓位测算（需要你填写止损价）</summary><div class="row g-2 mt-1">' +
        '<div class="col-6"><label class="form-label mini-label">计划入场价（元）</label><input class="form-control form-control-sm" type="number" min="0.01" step="0.01" inputmode="decimal" data-risk-plan="entry" data-risk-code="' + esc(codeOf(s.code)) + '" value="' + (riskPlan.entry === null ? '' : esc(riskPlan.entry)) + '" placeholder="输入入场价"></div>' +
        '<div class="col-6"><label class="form-label mini-label">止损价（元）</label><input class="form-control form-control-sm" type="number" min="0.01" step="0.01" inputmode="decimal" data-risk-plan="stop" data-risk-code="' + esc(codeOf(s.code)) + '" value="' + (riskPlan.stop === null ? '' : esc(riskPlan.stop)) + '" placeholder="必须低于入场价"></div></div>' +
        '<div class="mini-label mt-2">' + esc(riskResult.message) + '</div><div class="mini-label mt-1">按 A 股普通 100 股整数手估算；未纳入手续费、滑点、跳空、涨跌停、特殊板块交易规则及持仓相关性。</div></details>';
      var review = reviewFor(s.code);
      var reviewPanel = '<details class="combat-review-details" data-review-code="' + esc(codeOf(s.code)) + '"><summary class="combat-section-title">交易后复盘记录（仅本机保存）</summary><div class="mt-2">' +
        '<label class="form-label mini-label mb-1" for="review-action-' + esc(codeOf(s.code)) + '">操作</label><select class="form-select form-select-sm mb-2" id="review-action-' + esc(codeOf(s.code)) + '" data-review-field="action"><option value="未交易"' + (review.action === '未交易' || !review.action ? ' selected' : '') + '>未交易 / 观察</option><option value="买入/补仓"' + (review.action === '买入/补仓' ? ' selected' : '') + '>买入 / 补仓</option><option value="减仓"' + (review.action === '减仓' ? ' selected' : '') + '>减仓</option><option value="卖出"' + (review.action === '卖出' ? ' selected' : '') + '>卖出</option></select>' +
        '<label class="form-label mini-label mb-1" for="review-date-' + esc(codeOf(s.code)) + '">交易日期</label><input class="form-control form-control-sm mb-2" type="date" id="review-date-' + esc(codeOf(s.code)) + '" data-review-field="date" value="' + esc(review.date || '') + '">' +
        '<label class="form-label mini-label mb-1">交易理由 / 当时假设</label><textarea class="form-control form-control-sm mb-2" rows="2" maxlength="1200" data-review-field="thesis" placeholder="为什么操作？周期、估值、安全边际和买入条件是什么？">' + esc(review.thesis || '') + '</textarea>' +
        '<label class="form-label mini-label mb-1">执行与风险控制</label><textarea class="form-control form-control-sm mb-2" rows="2" maxlength="1200" data-review-field="execution" placeholder="是否按计划执行？仓位、价格、纪律是否偏离？">' + esc(review.execution || '') + '</textarea>' +
        '<label class="form-label mini-label mb-1">计划风险快照（保存时自动记录）</label><div class="mini-label mb-2">' + (review.plannedRiskAmount !== undefined && review.plannedRiskAmount !== null ? '计划风险 ¥' + money(review.plannedRiskAmount) + ' · 参考股数 ' + Number(review.plannedShares || 0).toLocaleString('zh-CN') + ' 股 · 入场 ' + money(review.plannedEntry) + ' · 止损 ' + money(review.plannedStop) : '保存复盘时尝试记录当前仓位测算；参数不完整则标记为未计算') + '</div>' +
        '<label class="form-label mini-label mb-1">实际盈亏（元，可填已实现盈亏）</label><input class="form-control form-control-sm mb-2" type="number" step="0.01" data-review-field="actualPnl" value="' + (review.actualPnl === undefined || review.actualPnl === null ? '' : esc(review.actualPnl)) + '" placeholder="未平仓或未知可留空">' +
        '<label class="form-label mini-label mb-1">止损纪律</label><select class="form-select form-select-sm mb-2" data-review-field="stopAdherence"><option value=""' + (!review.stopAdherence ? ' selected' : '') + '>未记录</option><option value="遵守"' + (review.stopAdherence === '遵守' ? ' selected' : '') + '>遵守止损纪律</option><option value="未遵守"' + (review.stopAdherence === '未遵守' ? ' selected' : '') + '>未遵守止损纪律</option><option value="不适用"' + (review.stopAdherence === '不适用' ? ' selected' : '') + '>未触发 / 不适用</option></select>' +
        '<label class="form-label mini-label mb-1">偏离计划原因</label><textarea class="form-control form-control-sm mb-2" rows="2" maxlength="1200" data-review-field="deviationReason" placeholder="如追价、提前卖出、未按止损执行；无偏离可留空">' + esc(review.deviationReason || '') + '</textarea>' +
        '<label class="form-label mini-label mb-1">结果与经验</label><textarea class="form-control form-control-sm mb-2" rows="2" maxlength="1200" data-review-field="lesson" placeholder="结果如何？哪些判断被验证，哪些需要修正？">' + esc(review.lesson || '') + '</textarea>' +
        '<div class="d-flex align-items-center gap-2"><button type="button" class="btn btn-sm btn-outline-primary" data-review-save="' + esc(codeOf(s.code)) + '">保存复盘</button><span class="mini-label" data-review-status>' + (review.savedAt ? '已保存 ' + esc(new Date(review.savedAt).toLocaleString('zh-CN')) : '尚未保存') + '</span></div>' +
        '<div class="mini-label mt-2">记录仅存当前浏览器 localStorage，不会上传到 GitHub；清除浏览器网站数据可能导致记录丢失。</div></div></details>';
      var cost = held && h.cost !== null && h.cost !== undefined && h.cost !== '' && Number.isFinite(Number(h.cost)) ? Number(h.cost) : null;
      var validQty = held && Number.isFinite(qty) && qty > 0;
      var pnlText = validQty && cost !== null && p !== null ? ((p - cost) * qty > 0 ? '+' : '') + Math.round((p - cost) * qty).toLocaleString('zh-CN') + ' 元' : '—';
      var quoteLabel = quoteTime(r.quote);
      var reviewed = planReviewLabel(s);
      return '<article class="insight-card combat-card"><div class="d-flex justify-content-between align-items-start gap-2"><div class="min-w-0"><a class="combat-name" href="stock.html?code=' + encodeURIComponent(s.code) + '">' + esc(s.name || s.code) + '</a><div class="mini-label">' + esc(s.code) + ' · ' + (held ? '持仓 ' + (validQty ? qty.toLocaleString('zh-CN') : '数量待核对') + ' 股' : '股票池 / 自选') + '</div><div class="mini-label">' + esc(quoteLabel) + '</div></div><div class="text-end flex-shrink-0"><div class="combat-price">' + (p === null ? '—' : money(p)) + '</div><div class="mini-label ' + (r.quote && Number(r.quote.todayChange) > 0 ? 'text-up' : r.quote && Number(r.quote.todayChange) < 0 ? 'text-down' : '') + '">' + (r.quote ? pct(r.quote.todayChange) : '行情缺失') + '</div></div></div><div class="d-flex flex-wrap gap-1 mt-2">' + badges + '</div><div class="combat-plan mt-2">' + esc(plan || '未配置计划价') + (held ? ' · 成本 ' + money(cost) + ' · 浮盈亏 ' + pnlText : '') + '<div class="mini-label mt-1">' + esc(reviewed) + ' · 计划价需结合最新基本面与周期复核</div></div>' + buyConditions + indicatorPanel + riskPanel + reviewPanel + '<div class="d-flex justify-content-between align-items-center gap-2 mt-3"><span class="mini-label">' + esc(r.dataNote || '辅助参考，不构成投资建议') + '</span><a class="btn btn-sm btn-outline-primary" href="stock.html?code=' + encodeURIComponent(s.code) + '">查看详情</a></div></article>';
    }).join('');
  }
  async function calculateOne(stock) {
    var code = codeOf(stock.code), quote = quoteFor(code), holding = holdingFor(code), price = quote && Number(quote.price) > 0 ? Number(quote.price) : null;
    var eligible = gate(stock, quote), add = null, dataNote = '', day = null, indicators = null;
    if (price === null) {
      var missing = { status: '数据不足', kind: 'data', reasons: ['当前行情无有效价格，不使用过期空值推断'], dataReady: false };
      return { stock: stock, quote: quote, holding: holding, primary: missing, add: null, eligible: eligible, dataNote: '行情缺失' };
    }
    try { day = await state.client.fetchKline(code, { period: 'day', count: 120, adjust: 'qfq' }); } catch (_) {}
    var bars = day && Array.isArray(day.bars) ? day.bars : [];
    if (root.TechInd && bars.length) {
      var rsiRes = root.TechInd.rsi ? root.TechInd.rsi(bars, 14) : null;
      var macdRes = root.TechInd.macd ? root.TechInd.macd(bars, 12, 26, 9) : null;
      var mfiRes = root.TechInd.mfi ? root.TechInd.mfi(bars, 14) : null;
      var maRes = root.TechInd.ma ? root.TechInd.ma(bars, 20) : null;
      var obvRes = root.TechInd.obv ? root.TechInd.obv(bars) : null;
      var rsiValue = rsiRes ? rsiRes.latest : null;
      var rsiPrev = rsiRes && rsiRes.series.length > 1 ? rsiRes.series[rsiRes.series.length - 2] : null;
      var macdValue = macdRes ? macdRes.latest : null;
      var macdPrev = macdRes && macdRes.histogram.length > 1 ? macdRes.histogram[macdRes.histogram.length - 2] : null;
      indicators = {
        bars: bars.length,
        rsi: rsiValue,
        rsiTrend: rsiValue === null || rsiPrev === null ? '数据不足' : rsiValue > rsiPrev ? '回升' : rsiValue < rsiPrev ? '回落' : '持平',
        rsiState: rsiValue === null ? '数据不足' : rsiValue < 30 ? '超卖区' : rsiValue < 45 ? '偏弱' : rsiValue <= 55 ? '中性' : rsiValue < 70 ? '偏强' : '超买区',
        macd: macdValue,
        macdState: macdValue === null ? '数据不足' : macdValue.dif > macdValue.dea ? (macdValue.histogram >= 0 ? '多头动能' : '偏多改善') : (macdPrev !== null && macdValue.histogram > macdPrev ? '空头动能减弱' : '偏空'),
        macdCross: macdValue && macdRes.dif.length > 1 && macdRes.dea.length > 1 && macdRes.dif[macdRes.dif.length - 2] !== null && macdRes.dea[macdRes.dea.length - 2] !== null ? (macdValue.dif > macdValue.dea && macdRes.dif[macdRes.dif.length - 2] <= macdRes.dea[macdRes.dea.length - 2] ? '金叉' : macdValue.dif < macdValue.dea && macdRes.dif[macdRes.dif.length - 2] >= macdRes.dea[macdRes.dea.length - 2] ? '死叉' : '未新交叉') : '数据不足',
        mfi: mfiRes ? mfiRes.latest : null,
        ma20: maRes ? maRes.latest : null,
        obv: obvRes ? obvRes.latest : null
      };
    }
    var nearPlan = [stock.entry, stock.heavy].some(function (v) { return Number(v) > 0 && Math.abs(price / Number(v) - 1) <= 0.05; });
    var inBuyZone = [stock.entry, stock.heavy].some(function (v) { return Number(v) > 0 && price <= Number(v); });
    var poolWatch = stock.inPool || stock.pool !== false;
    var primary = { status: '观望', kind: 'watch', reasons: [inBuyZone ? '现价进入计划价区，但触价不等于买入信号' : nearPlan ? '接近计划价区，等待技术条件确认' : '现价未到计划价区，暂不追价'] };
    if ((holding || nearPlan || inBuyZone) && root.StockTradeSignals) {
      // Only calculate/show add signals after price reaches the configured entry/heavy plan level.
      if (inBuyZone) {
        // Same five-factor scoring for all candidates.
        add = root.StockTradeSignals.evaluateAdd(price, Object.assign({}, stock, { inHolding: !!holding }), bars);
      }
      if (!eligible.eligible && (inBuyZone || (add && add.kind === 'add-ready'))) {
        primary = { status: '风险拦截', kind: 'risk', reasons: [eligible.reason || '未通过买入纪律门槛', '价格到计划区不代表允许买入'] };
      } else if (add && (add.kind === 'add-ready' || add.kind === 'add-watch')) {
        primary = { status: add.status, kind: add.kind, reasons: add.reasons.slice(0, 3) };
      } else if (add && add.kind === 'data') {
        primary = { status: '数据不足', kind: 'data', reasons: add.reasons };
      }
      dataNote = '日K ' + (bars.length ? bars.length + ' 根' : '不可用');
    } else if (inBuyZone && !eligible.eligible) {
      primary = { status: '风险拦截', kind: 'risk', reasons: [eligible.reason || '未通过买入纪律门槛', '价格到计划区不代表允许补仓'] };
    }
    return { stock: stock, quote: quote, holding: holding, primary: primary, add: add, eligible: eligible, indicators: indicators, dataNote: dataNote || '行情来自当前页面报价缓存；操作由用户决定' };
  }
  async function run(force) {
    if (state.loading) return;
    if (!state.client || !Array.isArray(state.stocks)) return;
    state.loading = true; state.error = ''; render();
    try {
      if (root.StockHoldings) {
        var data = await root.StockHoldings.load(!!force);
        state.holdings = data.holdings || [];
      }
      var universe = mergeUniverse();
      state.rows = universe.map(function (stock) { return { stock: stock, quote: quoteFor(stock.code), holding: holdingFor(stock.code), primary: { status: '计算中', kind: 'data', reasons: [] }, add: null }; });
      render();
      var results = [];
      await limitedMap(universe, 4, async function (stock) {
        try {
          results.push(await calculateOne(stock));
        } catch (e) {
          // Preserve coverage when one symbol fails; never silently drop it from the combat universe.
          results.push({ stock: stock, quote: quoteFor(stock.code), holding: holdingFor(stock.code), primary: { status: '数据不足', kind: 'data', reasons: ['单股计算失败：' + (e && e.message || '未知错误'), '本次不生成交易信号，请刷新复核'] }, add: null, dataNote: '计算异常，未生成交易信号' });
        }
      });
      var order = new Map(results.map(function (r, i) { return [codeOf(r.stock.code), i]; }));
      state.rows = results.sort(function (a, b) {
        // Put genuinely actionable signals first; risk blocks and missing data must never outrank them.
        var rank = function (r) {
          if (r.primary.kind === 'add-ready') return 0;
          if (r.primary.kind === 'add-watch') return 1;
          if (r.primary.kind === 'watch') return 2;
          if (r.primary.kind === 'risk') return 3;
          if (r.primary.kind === 'data') return 4;
          return 2;
        };
        var diff = rank(a) - rank(b);
        if (diff) return diff;
        // Within actionable items, prioritize higher-confidence buy signals and keep holdings ahead of pool-only names.
        var signalScore = function (r) {
          var score = 0;
          if (r.primary.kind === 'add-ready') score += 25 + (Number(r.add && r.add.score) || 0);
          if (r.primary.kind === 'add-watch') score += 10 + (Number(r.add && r.add.score) || 0);
          if (r.holding) score += 2;
          return score;
        };
        return signalScore(b) - signalScore(a) || String(a.stock.name || '').localeCompare(String(b.stock.name || ''), 'zh');
      });
      state.lastRun = Date.now();
    } catch (e) { state.error = e && e.message || '读取作战数据失败'; }
    state.loading = false;
    render();
  }
  function bindRiskBudgetActions() {
    var panel = $('combat-risk-budget');
    if (panel) Object.keys(state.riskSettings).forEach(function (key) {
      var field = panel.querySelector('[data-risk-setting="' + key + '"]');
      if (field && state.riskSettings[key] !== undefined && state.riskSettings[key] !== null && root.document.activeElement !== field) field.value = state.riskSettings[key];
    });
    if (panel && !panel.dataset.riskBound) {
      panel.dataset.riskBound = '1';
      panel.addEventListener('change', function (event) {
        var field = event.target;
        if (!field || !field.getAttribute) return;
        var key = field.getAttribute('data-risk-setting');
        if (!key) return;
        var value = String(field.value || '').trim();
        if (value !== '') {
          var n = Number(value);
          if (!Number.isFinite(n) || n < 0 || (key !== 'cash' && key !== 'equity' && n > 100)) { field.setCustomValidity('请输入有效数值；比例范围为 0–100。'); field.reportValidity(); return; }
        }
        field.setCustomValidity('');
        var settings = Object.assign({}, state.riskSettings);
        if (value === '') delete settings[key]; else settings[key] = Number(value);
        if (!saveRiskSettings(settings)) { field.setCustomValidity('本机存储不可用，参数未保存。'); field.reportValidity(); return; }
        render();
      });
    }
    var list = $('combat-list');
    if (list && !list.dataset.riskBound) {
      list.dataset.riskBound = '1';
      list.addEventListener('change', function (event) {
        var field = event.target;
        if (!field || !field.getAttribute) return;
        var key = field.getAttribute('data-risk-plan'), code = field.getAttribute('data-risk-code');
        if (!key || !code) return;
        var value = String(field.value || '').trim();
        if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) <= 0)) { field.setCustomValidity('请输入大于 0 的价格。'); field.reportValidity(); return; }
        field.setCustomValidity('');
        var plan = Object.assign({}, state.riskPlans[codeOf(code)] || {});
        if (value === '') delete plan[key]; else plan[key] = Number(value);
        if (!saveRiskPlan(code, plan)) { field.setCustomValidity('本机存储不可用，价格未保存。'); field.reportValidity(); return; }
        render();
      });
    }
  }
  function bindReviewActions() {
    var list = $('combat-list');
    if (!list || list.dataset.reviewBound) return;
    list.dataset.reviewBound = '1';
    list.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-review-save]') : null;
      if (!button) return;
      var code = codeOf(button.getAttribute('data-review-save'));
      var panel = button.closest('[data-review-code]');
      if (!panel || !code) return;
      var values = {};
      panel.querySelectorAll('[data-review-field]').forEach(function (field) { values[field.getAttribute('data-review-field')] = String(field.value || '').trim(); });
      var row = state.rows.find(function (r) { return codeOf(r.stock.code) === code; });
      var planned = row ? riskCalculation(row.stock, row, riskPlanFor(code, row.stock)) : { ready: false };
      values.plannedRiskAmount = planned.ready ? planned.riskAmount : null;
      values.plannedShares = planned.ready ? planned.shares : null;
      values.plannedEntry = planned.ready ? planned.entry : null;
      values.plannedStop = planned.ready ? planned.stop : null;
      values.actualPnl = values.actualPnl === '' ? null : inputNumber(values.actualPnl);
      values.savedAt = new Date().toISOString();
      var status = panel.querySelector('[data-review-status]');
      if (saveReview(code, values)) {
        renderReviewMetrics();
        if (status) status.textContent = '已保存 ' + new Date(values.savedAt).toLocaleString('zh-CN');
      } else if (status) status.textContent = '保存失败：浏览器存储不可用';
    });
  }
  function ensureUi() {
    bindReviewActions();
    bindRiskBudgetActions();
    ['combat-filter-all','combat-filter-add','combat-filter-watch','combat-filter-risk','combat-filter-data'].forEach(function (id) {
      var el = $(id); if (!el || el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('click', function () {
        state.filter = id === 'combat-filter-all' ? 'all' : id.replace('combat-filter-', '');
        root.document.querySelectorAll('[data-combat-filter]').forEach(function (b) { b.classList.toggle('active', b.id === id); });
        render();
      });
    });
    var refresh = $('combat-refresh');
    if (refresh && !refresh.dataset.bound) { refresh.dataset.bound = '1'; refresh.addEventListener('click', function () { run(true); }); }
  }
  function init(stocks, prices, client) {
    state.reviews = loadReviews();
    state.riskSettings = loadRiskSettings();
    state.riskPlans = loadRiskPlans();
    state.stocks = Array.isArray(stocks) ? stocks : [];
    state.prices = prices || {};
    state.client = client || null;
    state.initialized = true;
    ensureUi();
  }
  function onTab(target) {
    if (target === 'combat' && state.initialized && (!state.lastRun || Date.now() - state.lastRun > 180000)) run(false);
  }
  root.StockCombat = { init: init, onTab: onTab, refresh: function () { return run(true); }, calculateRiskBudget: calculateRiskBudget, summarizeReviews: summarizeReviews };
  if (root.document) root.document.addEventListener('DOMContentLoaded', ensureUi);
})(typeof window !== 'undefined' ? window : globalThis);
