/* Global asset dashboard: rankings, normalized trend comparison and quote cards. */
(function (global) {
  'use strict';
  var assets = [
    { id: 'gold', name: '黄金', symbol: 'XAUUSD=X', kind: '贵金属', unit: 'USD/盎司' },
    { id: 'bitcoin', name: '比特币', symbol: 'BTC-USD', kind: '加密资产', unit: 'USD' },
    { id: 'ethereum', name: '以太坊', symbol: 'ETH-USD', kind: '加密资产', unit: 'USD' },
    { id: 'nikkei225', name: '日经 225', symbol: '^N225', kind: '海外指数', unit: '指数点' },
    { id: 'nasdaq100', name: '纳斯达克 100', symbol: '^NDX', kind: '海外指数', unit: '指数点' },
    { id: 'sp500', name: '标普 500', symbol: '^GSPC', kind: '海外指数', unit: '指数点' },
    { id: 'vix', name: 'VIX 恐慌指数', symbol: '^VIX', kind: '波动率指标', unit: '指数点' },
    { id: 'usdcny', name: '美元兑人民币', symbol: 'CNY=X', kind: '外汇', unit: 'CNY/USD' }
  ];
  var loading = false;
  var lastLoad = 0;
  var compareRange = '1m';
  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function numeric(value) {
    var n = Number(value);
    return value !== null && value !== '' && Number.isFinite(n) ? n : null;
  }
  function fmtPrice(value, id) {
    var n = numeric(value);
    if (n === null || n <= 0) return '—';
    var digits = id === 'bitcoin' ? 0 : id === 'usdcny' ? 4 : 2;
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtPct(value) {
    var n = numeric(value);
    if (n === null) return '涨跌幅暂不可用';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function tone(value) {
    var n = numeric(value);
    if (n === null || n === 0) return 'text-body-secondary';
    return n > 0 ? 'text-up' : 'text-down';
  }
  function formatQuoteDate(value) {
    if (!value) return '报价日期未知';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '报价日期未知';
    return '报价日期：' + date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  function formatFetchTime(value) {
    if (!value) return '数据抓取时间未知';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '数据抓取时间未知';
    return '数据抓取：' + date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）';
  }
  function historyOf(item, range) {
    var history = Array.isArray(item && item.history) ? item.history.filter(function (p) {
      return p && numeric(p.close) > 0 && p.date;
    }) : [];
    if (range === '1w') return history.slice(-5);
    return history.slice(-22);
  }
  function sparkline(history, id) {
    var points = Array.isArray(history) ? history.filter(function (p) { return numeric(p.close) > 0; }) : [];
    if (points.length < 2) return '<div class="ga-spark-empty">历史趋势数据积累中</div>';
    var vals = points.map(function (p) { return Number(p.close); });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = max - min || 1;
    var coords = vals.map(function (v, i) {
      return { x: 3 + i * 194 / (vals.length - 1), y: 34 - (v - min) * 28 / span };
    });
    var path = coords.map(function (p, i) { return (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var first = vals[0], last = vals[vals.length - 1];
    var color = last > first ? 'var(--up)' : last < first ? 'var(--down)' : 'var(--bs-secondary-color)';
    return '<svg viewBox="0 0 200 40" role="img" aria-label="' + esc(id) + '历史走势" class="ga-spark" style="color:' + color + '">'
      + '<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="' + coords[coords.length - 1].x.toFixed(1) + '" cy="' + coords[coords.length - 1].y.toFixed(1) + '" r="2.5" fill="currentColor"/>'
      + '</svg>';
  }
  function rangeChange(item, range) {
    var history = historyOf(item, range);
    if (history.length >= 2) {
      var first = Number(history[0].close), last = Number(history[history.length - 1].close);
      return first > 0 ? (last - first) / first * 100 : null;
    }
    return numeric(item && item.changePct);
  }
  function ensureDashboard() {
    var pane = el('assets-pane'), cards = el('global-assets-cards');
    if (!pane || !cards || el('global-assets-overview')) return;
    var overview = document.createElement('div');
    overview.id = 'global-assets-overview';
    overview.innerHTML = '<div class="ga-section-head"><div><div class="panel-title">今日涨跌排行</div><div class="panel-subtitle">按最近报价的日涨跌幅排序；不同市场交易时段并不一致。</div></div></div>'
      + '<div id="global-assets-ranking" class="ga-ranking insight-grid mb-3"></div>'
      + '<div class="insight-card ga-comparison mb-3"><div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2"><div><div class="panel-title">趋势对比</div><div class="panel-subtitle">将各资产区间起点归一为 100，比较相对涨跌，不比较绝对价格。</div></div><div class="btn-group btn-group-sm" role="group" aria-label="趋势区间"><button type="button" class="btn btn-outline-secondary ga-range" data-range="1w">近 1 周</button><button type="button" class="btn btn-outline-secondary ga-range active" data-range="1m">近 1 月</button></div></div><div id="global-assets-comparison"></div><div class="panel-subtitle mt-2">仅对同时有有效历史点的资产绘图；缺失数据不补值。VIX 是波动率指标，方向含义与风险资产不同。</div></div>';
    pane.insertBefore(overview, cards);
    var style = document.createElement('style');
    style.id = 'global-assets-style';
    style.textContent = '#global-assets-overview .ga-section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem}#global-assets-overview .ga-ranking{grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:8px}#global-assets-overview .ga-rank-card{border:1px solid var(--bs-border-color);border-radius:11px;background:var(--bs-body-bg);padding:10px 12px;min-width:0}#global-assets-overview .ga-rank-top{display:flex;justify-content:space-between;gap:8px;align-items:center}#global-assets-overview .ga-rank-number{font-size:10px;color:var(--bs-secondary-color);font-variant-numeric:tabular-nums}#global-assets-overview .ga-rank-name{font-weight:700;font-size:12px}#global-assets-overview .ga-rank-change{font-weight:750;font-size:18px;font-variant-numeric:tabular-nums}#global-assets-overview .ga-spark{width:100%;height:42px;display:block;margin-top:3px}#global-assets-overview .ga-spark-empty{height:42px;display:flex;align-items:center;font-size:10px;color:var(--bs-secondary-color)}#global-assets-overview .ga-comparison{overflow:hidden}#global-assets-overview .ga-chart{width:100%;height:auto;display:block;min-height:180px}#global-assets-overview .ga-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:8px}#global-assets-overview .ga-legend-item{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--bs-secondary-color)}#global-assets-overview .ga-legend-line{width:15px;height:3px;border-radius:2px;display:inline-block}#global-assets-overview .ga-range.active{background:var(--bs-primary);border-color:var(--bs-primary);color:#fff}#global-assets-cards .insight-card{transition:transform .16s ease,border-color .16s ease}#global-assets-cards .insight-card:hover{transform:translateY(-2px);border-color:var(--bs-primary)}@media(max-width:575.98px){#global-assets-overview .ga-ranking{grid-template-columns:repeat(2,minmax(0,1fr))}#global-assets-overview .ga-rank-card{padding:9px}#global-assets-overview .ga-rank-change{font-size:16px}}';
    document.head.appendChild(style);
    overview.querySelectorAll('.ga-range').forEach(function (button) {
      button.addEventListener('click', function () {
        compareRange = button.getAttribute('data-range') || '1m';
        overview.querySelectorAll('.ga-range').forEach(function (b) { b.classList.toggle('active', b === button); });
        renderComparison(lastPayload);
      });
    });
  }
  var lastPayload = null;
  function renderRanking(data, byId) {
    var node = el('global-assets-ranking');
    if (!node) return;
    var ranked = data.map(function (item) {
      var meta = assets.find(function (a) { return a.id === item.id; }) || {};
      return { item: item, meta: meta, change: numeric(item.changePct) };
    }).filter(function (entry) { return entry.change !== null; })
      .sort(function (a, b) { return b.change - a.change; });
    if (!ranked.length) {
      node.innerHTML = '<div class="empty-state">暂无有效涨跌幅，等待可靠行情。</div>';
      return;
    }
    node.innerHTML = ranked.map(function (entry, index) {
      var item = entry.item, meta = entry.meta;
      return '<article class="ga-rank-card"><div class="ga-rank-top"><span class="ga-rank-number">NO.' + (index + 1) + '</span><span class="ga-rank-name">' + esc(meta.name || item.name) + '</span><span class="' + tone(entry.change) + ' fw-semibold">' + fmtPct(entry.change) + '</span></div>'
        + '<div class="ga-rank-change ' + tone(entry.change) + '">' + (entry.change > 0 ? '▲' : entry.change < 0 ? '▼' : '—') + ' ' + Math.abs(entry.change).toFixed(2) + '%</div>'
        + sparkline(historyOf(item, '1m'), meta.name || item.id)
        + '<div class="mini-label">' + esc(item.status || '行情状态未知') + '</div></article>';
    }).join('');
  }
  function renderComparison(payload) {
    var node = el('global-assets-comparison');
    if (!node) return;
    var data = payload && Array.isArray(payload.assets) ? payload.assets : [];
    var series = data.map(function (item) {
      var meta = assets.find(function (a) { return a.id === item.id; });
      var points = historyOf(item, compareRange);
      if (!meta || points.length < 2) return null;
      var base = Number(points[0].close);
      if (!(base > 0)) return null;
      return { id: item.id, name: meta.name, points: points.map(function (p) {
        return { date: p.date, value: Number(p.close) / base * 100 };
      }) };
    }).filter(Boolean);
    if (!series.length) {
      node.innerHTML = '<div class="empty-state">趋势对比数据正在积累，请等待各资产历史行情更新。</div>';
      return;
    }
    var width = 680, height = 225, left = 42, right = 12, top = 12, bottom = 30;
    var values = [];
    series.forEach(function (s) { s.points.forEach(function (p) { values.push(p.value); }); });
    var min = Math.floor((Math.min.apply(null, values) - 1) / 2) * 2;
    var max = Math.ceil((Math.max.apply(null, values) + 1) / 2) * 2;
    if (max - min < 4) { min -= 2; max += 2; }
    var allDates = {};
    series.forEach(function (s) { s.points.forEach(function (p) { allDates[p.date] = true; }); });
    var dates = Object.keys(allDates).sort();
    function xFor(date) { var i = dates.indexOf(date); return left + (dates.length <= 1 ? 0 : i * (width - left - right) / (dates.length - 1)); }
    function yFor(value) { return top + (max - value) * (height - top - bottom) / (max - min); }
    var colors = ['#2563eb', '#7c3aed', '#0891b2', '#d97706', '#db2777', '#16a34a', '#64748b'];
    var grid = [];
    for (var i = 0; i <= 4; i++) {
      var v = min + (max - min) * i / 4, y = yFor(v);
      grid.push('<line x1="' + left + '" y1="' + y.toFixed(1) + '" x2="' + (width-right) + '" y2="' + y.toFixed(1) + '" stroke="currentColor" stroke-opacity=".12"/>'
        + '<text x="' + (left-7) + '" y="' + (y+4).toFixed(1) + '" text-anchor="end" fill="currentColor" opacity=".65" font-size="10">' + v.toFixed(0) + '</text>');
    }
    var paths = series.map(function (s, idx) {
      var path = s.points.map(function (p, i) { return (i ? 'L' : 'M') + xFor(p.date).toFixed(1) + ',' + yFor(p.value).toFixed(1); }).join(' ');
      return '<path d="' + path + '" fill="none" stroke="' + colors[idx % colors.length] + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>';
    }).join('');
    var dateLabels = dates.length ? '<text x="' + left + '" y="' + (height-8) + '" fill="currentColor" opacity=".65" font-size="10">' + esc(dates[0]) + '</text><text x="' + (width-right) + '" y="' + (height-8) + '" text-anchor="end" fill="currentColor" opacity=".65" font-size="10">' + esc(dates[dates.length-1]) + '</text>' : '';
    node.innerHTML = '<svg class="ga-chart" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="全球资产归一化趋势比较图">'
      + grid.join('') + '<line x1="' + left + '" y1="' + yFor(100).toFixed(1) + '" x2="' + (width-right) + '" y2="' + yFor(100).toFixed(1) + '" stroke="currentColor" stroke-dasharray="4 4" stroke-opacity=".5"/>'
      + paths + dateLabels + '</svg><div class="ga-legend">' + series.map(function (s, idx) {
        var last = s.points[s.points.length-1];
        return '<span class="ga-legend-item"><span class="ga-legend-line" style="background:' + colors[idx % colors.length] + '"></span>' + esc(s.name) + ' <b class="' + tone(last.value - 100) + '">' + (last.value >= 100 ? '+' : '') + (last.value - 100).toFixed(2) + '%</b></span>';
      }).join('') + '</div>';
  }
  function render(payload) {
    lastPayload = payload || {};
    var data = payload && Array.isArray(payload.assets) ? payload.assets : [];
    var byId = {};
    data.forEach(function (item) { if (item && item.id) byId[item.id] = item; });
    ensureDashboard();
    renderRanking(data, byId);
    renderComparison(payload);
    var node = el('global-assets-cards');
    if (!node) return;
    node.innerHTML = assets.map(function (meta) {
      var item = byId[meta.id] || {};
      var valid = numeric(item.price) !== null && Number(item.price) > 0;
      var change = item.changePct;
      var status = item.status || (valid ? '最近有效报价' : '等待可靠报价');
      var quoteTime = item.quoteTime ? timeText(item.quoteTime) : '暂无有效报价时间';
      var source = item.sourceUrl || 'https://finance.yahoo.com/';
      return '<article class="insight-card">'
        + '<div class="d-flex justify-content-between align-items-start gap-2"><div><div class="fw-bold">' + esc(meta.name) + '</div><div class="mini-label">' + esc(meta.kind) + ' · ' + esc(item.currency || meta.unit) + '</div></div><span class="flag" style="margin:0">' + esc(status) + '</span></div>'
        + '<div class="business-price mt-2">' + (valid ? fmtPrice(item.price, meta.id) : '—') + '</div>'
        + '<div class="' + tone(change) + ' fw-semibold">' + fmtPct(change) + '</div>'
        + '<div class="ga-card-trend">' + sparkline(historyOf(item, '1m'), meta.name) + '</div>'
        + (meta.id === 'vix' ? '<div class="mini-label">VIX 衡量标普 500 期权隐含的预期波动；上升通常代表市场担忧增强，不是方向预测。</div>' : '')
        + (meta.id === 'usdcny' ? '<div class="mini-label">报价含义：1 美元可兑换多少人民币。数值上升代表美元走强、人民币相对走弱。</div>' : '')
        + '<div class="mini-label mt-1">' + esc(item.quoteTime ? formatQuoteDate(item.quoteTime) : '报价日期未知') + '</div>'
        + '<div class="mini-label mt-1">代码：' + esc(item.sourceSymbol || meta.symbol) + ' · <a href="' + esc(source) + '" target="_blank" rel="noopener noreferrer">行情来源</a></div>'
        + '</article>';
    }).join('');
    var updated = el('global-assets-updated');
    if (updated) {
      var when = payload && payload.updatedAt ? formatFetchTime(payload.updatedAt) : '尚无抓取记录';
      updated.textContent = when + (payload && payload.source ? ' · 来源：' + payload.source : '');
      if (payload && payload.error) updated.textContent += ' · 最近抓取有品种失败，卡片保留状态标记';
    }
  }
  function load(force) {
    if (loading) return;
    if (!force && Date.now() - lastLoad < 60000) return;
    loading = true;
    var status = el('global-assets-updated');
    if (status) status.textContent = '正在读取全球资产行情缓存…';
    fetch('./data/global-assets-data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) { render(payload); lastLoad = Date.now(); })
      .catch(function (error) {
        var updated = el('global-assets-updated');
        if (updated) updated.textContent = '行情缓存读取失败：' + String(error && error.message || error) + '。稍后重试。';
        var node = el('global-assets-cards');
        if (node) node.innerHTML = '<div class="empty-state">当前无法读取全球资产行情文件；请稍后重试。</div>';
      })
      .finally(function () { loading = false; });
  }
  function onTab(target) { if (target === 'market') load(false); }
  function init() {
    ensureDashboard();
  }
  init();
  global.StockGlobalAssets = { init: init, load: load, onTab: onTab };
})(window);
