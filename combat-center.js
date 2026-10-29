/* Home trading combat center: manual decision support only, never submits orders. */
(function (root) {
  'use strict';
  var state = { stocks: [], prices: {}, client: null, holdings: [], rows: [], initialized: false, loading: false, lastRun: 0, filter: 'all', error: '' };
  var $ = function (id) { return root.document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function money(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'; }
  function pct(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? (Number(v) > 0 ? '+' : '') + Number(v).toFixed(2) + '%' : '—'; }
  function codeOf(code) { return String(code || '').trim().toLowerCase(); }
  function quoteFor(code) { return state.prices[code] || state.prices[codeOf(code)] || null; }
  function statusClass(kind) { return ({ 't-buy':'combat-good','t-sell':'combat-warn','add-ready':'combat-good','add-watch':'combat-warn','risk':'combat-risk','data':'combat-data','watch':'combat-neutral' })[kind] || 'combat-neutral'; }
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
    var rows = state.rows, counts = { ready: 0, watch: 0, risk: 0, data: 0, t: 0, add: 0 };
    rows.forEach(function (r) {
      if (r.primary.kind === 'risk') counts.risk++;
      else if (r.primary.kind === 'data') counts.data++;
      else if (r.primary.kind === 'watch' || r.primary.kind === 'add-watch') counts.watch++;
      else counts.ready++;
      if (r.t && (r.t.kind === 't-buy' || r.t.kind === 't-sell')) counts.t++;
      if (r.add && (r.add.kind === 'add-ready' || r.add.kind === 'add-watch')) counts.add++;
    });
    summary.innerHTML = [
      ['条件满足', counts.ready, '可进一步核对'],
      ['等待观察', counts.watch, '尚未触发条件'],
      ['风险拦截', counts.risk, '硬性纪律优先'],
      ['数据不足', counts.data, '不生成确定信号']
    ].map(function (x) { return '<div class="col-6 col-xl-3"><div class="insight-card h-100"><div class="mini-label">' + x[0] + '</div><div class="combat-metric">' + x[1] + '</div><div class="mini-label">' + x[2] + '</div></div></div>'; }).join('');
    meta.textContent = (state.error ? '读取失败：' + state.error + ' · ' : '') + '覆盖 ' + rows.length + ' 只（持仓 + 股票池去重） · 做T条件 ' + counts.t + ' · 补仓观察 ' + counts.add + ' · ' + (state.lastRun ? '计算于 ' + new Date(state.lastRun).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '等待计算');
    var filtered = rows.filter(function (r) {
      if (state.filter === 't') return r.t && (r.t.kind === 't-buy' || r.t.kind === 't-sell');
      if (state.filter === 'add') return r.add && (r.add.kind === 'add-ready' || r.add.kind === 'add-watch');
      if (state.filter === 'watch') return r.primary.kind === 'watch';
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
      var badges = '<span class="combat-badge ' + statusClass(r.primary.kind) + '">' + esc(r.primary.status) + '</span>';
      if (r.t && (r.t.kind === 't-buy' || r.t.kind === 't-sell')) badges += '<span class="combat-badge ' + statusClass(r.t.kind) + '">' + esc(r.t.status) + '</span>';
      if (r.add && (r.add.kind === 'add-ready' || r.add.kind === 'add-watch')) badges += '<span class="combat-badge ' + statusClass(r.add.kind) + '">' + esc(r.add.status) + ' ' + r.add.score + '/3</span>';
      var reasons = (r.primary.reasons || []).concat(r.t && Array.isArray(r.t.reasons) ? r.t.reasons.slice(0, 2).map(function (x) { return '做T：' + x; }) : [], r.add && Array.isArray(r.add.reasons) ? r.add.reasons.slice(0, 2).map(function (x) { return '补仓：' + x; }) : []);
      if (!reasons.length) reasons = ['价格未到计划区，暂不触发操作条件'];
      var plan = [s.heavy ? '重仓 ' + money(s.heavy) : null, s.entry ? '入场 ' + money(s.entry) : null, s.tp1 ? '止盈1 ' + money(s.tp1) : null].filter(Boolean).join(' · ');
      var pnl = held && p !== null ? (p - Number(h.cost)) * qty : null;
      return '<article class="insight-card combat-card"><div class="d-flex justify-content-between align-items-start gap-2"><div class="min-w-0"><a class="combat-name" href="stock.html?code=' + encodeURIComponent(s.code) + '">' + esc(s.name || s.code) + '</a><div class="mini-label">' + esc(s.code) + ' · ' + (held ? '持仓 ' + qty.toLocaleString('zh-CN') + ' 股' : '股票池 / 自选') + '</div></div><div class="text-end flex-shrink-0"><div class="combat-price">' + (p === null ? '—' : money(p)) + '</div><div class="mini-label ' + (r.quote && Number(r.quote.todayChange) > 0 ? 'text-up' : r.quote && Number(r.quote.todayChange) < 0 ? 'text-down' : '') + '">' + (r.quote ? pct(r.quote.todayChange) : '行情缺失') + '</div></div></div><div class="d-flex flex-wrap gap-1 mt-2">' + badges + '</div><div class="combat-reasons mt-2">' + reasons.slice(0, 4).map(function (x) { return '<div>• ' + esc(x) + '</div>'; }).join('') + '</div><div class="combat-plan mt-2">' + esc(plan || '未配置计划价') + (held ? ' · 成本 ' + money(h.cost) + ' · 浮盈亏 ' + (pnl === null ? '—' : (pnl > 0 ? '+' : '') + Math.round(pnl).toLocaleString('zh-CN') + ' 元') : '') + '</div><div class="d-flex justify-content-between align-items-center gap-2 mt-3"><span class="mini-label">' + esc(r.dataNote || '辅助参考，不构成投资建议') + '</span><a class="btn btn-sm btn-outline-primary" href="stock.html?code=' + encodeURIComponent(s.code) + '">查看详情</a></div></article>';
    }).join('');
  }
  async function calculateOne(stock) {
    var code = codeOf(stock.code), quote = quoteFor(code), holding = holdingFor(code), price = quote && Number(quote.price) > 0 ? Number(quote.price) : null;
    var eligible = gate(stock, quote), t = null, add = null, dataNote = '';
    if (price === null) {
      var missing = { status: '数据不足', kind: 'data', reasons: ['当前行情无有效价格，不使用过期空值推断'], dataReady: false };
      return { stock: stock, quote: quote, holding: holding, primary: missing, t: null, add: null, dataNote: '行情缺失' };
    }
    var nearPlan = [stock.entry, stock.heavy].some(function (v) { return Number(v) > 0 && Math.abs(price / Number(v) - 1) <= 0.05; });
    var inBuyZone = [stock.entry, stock.heavy].some(function (v) { return Number(v) > 0 && price <= Number(v); });
    var poolWatch = stock.inPool || stock.pool !== false;
    var primary = { status: '观望', kind: 'watch', reasons: [inBuyZone ? '现价进入计划价区，但触价不等于买入信号' : nearPlan ? '接近计划价区，等待技术条件确认' : '现价未到计划价区，暂不追价'] };
    if ((holding || nearPlan || inBuyZone) && root.StockTradeSignals) {
      var minute = null, trends = null, day = null;
      if (holding) {
        try { minute = await state.client.fetchMinuteKline(code, { period: '15', count: 320 }); } catch (_) {}
        try { trends = await state.client.fetchTrends(code, { days: 1 }); } catch (_) {}
        t = root.StockTradeSignals.evaluateT(price, quote, trends, minute && minute.bars || [], holding.quantity);
      } else {
        t = { status: '观望', kind: 'watch', reasons: ['非持仓标的：不提供做T卖出条件'], dataReady: true };
      }
      // Only calculate/show add signals after price reaches the configured entry/heavy plan level.
      // Holdings can still receive T signals above the buy zone, but must not be recommended for adding.
      if (inBuyZone) {
        try { day = await state.client.fetchKline(code, { period: 'day', count: 120, adjust: 'qfq' }); } catch (_) {}
        add = root.StockTradeSignals.evaluateAdd(price, stock, day && day.bars || []);
      }
      if (!eligible.eligible && (inBuyZone || (add && add.kind === 'add-ready'))) {
        primary = { status: '风险拦截', kind: 'risk', reasons: [eligible.reason || '未通过买入纪律门槛', '价格到计划区不代表允许补仓'] };
      } else if (t && (t.kind === 't-buy' || t.kind === 't-sell')) {
        primary = { status: t.status, kind: t.kind, reasons: t.reasons };
      } else if (add && (add.kind === 'add-ready' || add.kind === 'add-watch')) {
        primary = { status: add.status, kind: add.kind, reasons: add.reasons.slice(0, 3) };
      } else if (add && add.kind === 'data') {
        primary = { status: '数据不足', kind: 'data', reasons: add.reasons };
      }
      dataNote = '日K ' + (day && day.bars ? day.bars.length + ' 根' : '不可用') + ' · 分钟K ' + (minute && minute.bars ? minute.bars.length + ' 根' : (holding ? '不可用' : '不适用'));
    } else if (inBuyZone && !eligible.eligible) {
      primary = { status: '风险拦截', kind: 'risk', reasons: [eligible.reason || '未通过买入纪律门槛', '价格到计划区不代表允许补仓'] };
    }
    return { stock: stock, quote: quote, holding: holding, primary: primary, t: t, add: add, dataNote: dataNote || '行情来自当前页面报价缓存；操作由用户决定' };
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
      state.rows = universe.map(function (stock) { return { stock: stock, quote: quoteFor(stock.code), holding: holdingFor(stock.code), primary: { status: '计算中', kind: 'data', reasons: [] }, t: null, add: null }; });
      render();
      var results = [];
      await limitedMap(universe, 4, async function (stock) { results.push(await calculateOne(stock)); });
      var order = new Map(results.map(function (r, i) { return [codeOf(r.stock.code), i]; }));
      state.rows = results.sort(function (a, b) {
        // Put genuinely actionable signals first; risk blocks and missing data must never outrank them.
        var rank = function (r) {
          if (r.primary.kind === 't-buy' || r.primary.kind === 't-sell' || r.primary.kind === 'add-ready') return 0;
          if (r.primary.kind === 'add-watch') return 1;
          if (r.primary.kind === 'watch') return 2;
          if (r.primary.kind === 'risk') return 3;
          if (r.primary.kind === 'data') return 4;
          return 2;
        };
        var diff = rank(a) - rank(b);
        if (diff) return diff;
        // Within actionable items, prioritize a higher-confidence add/T signal and keep holdings ahead of pool-only names.
        var signalScore = function (r) {
          var score = 0;
          if (r.primary.kind === 't-buy' || r.primary.kind === 't-sell') score += 30;
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
  function ensureUi() {
    ['combat-filter-all','combat-filter-t','combat-filter-add','combat-filter-watch','combat-filter-risk','combat-filter-data'].forEach(function (id) {
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
    state.stocks = Array.isArray(stocks) ? stocks : [];
    state.prices = prices || {};
    state.client = client || null;
    state.initialized = true;
    ensureUi();
  }
  function onTab(target) {
    if (target === 'combat' && state.initialized && (!state.lastRun || Date.now() - state.lastRun > 180000)) run(false);
  }
  root.StockCombat = { init: init, onTab: onTab, refresh: function () { return run(true); } };
  if (root.document) root.document.addEventListener('DOMContentLoaded', ensureUi);
})(typeof window !== 'undefined' ? window : globalThis);
