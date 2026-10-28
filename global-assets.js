/* Global asset cards backed by the scheduled public quote cache. */
(function (global) {
  'use strict';
  var assets = [
    { id: 'gold', name: '黄金', symbol: 'XAUUSD=X', kind: '贵金属', unit: 'USD/盎司' },
    { id: 'bitcoin', name: '比特币', symbol: 'BTC-USD', kind: '加密资产', unit: 'USD' },
    { id: 'ethereum', name: '以太坊', symbol: 'ETH-USD', kind: '加密资产', unit: 'USD' },
    { id: 'nikkei225', name: '日经 225', symbol: '^N225', kind: '海外指数', unit: '指数点' },
    { id: 'nasdaq100', name: '纳斯达克 100', symbol: '^NDX', kind: '海外指数', unit: '指数点' },
    { id: 'sp500', name: '标普 500', symbol: '^GSPC', kind: '海外指数', unit: '指数点' },
    { id: 'vix', name: 'VIX 恐慌指数', symbol: '^VIX', kind: '波动率指标', unit: '指数点' }
  ];
  var loading = false;
  var lastLoad = 0;
  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function fmtPrice(value, id) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '—';
    var digits = id === 'bitcoin' ? 0 : id === 'vix' ? 2 : id === 'ethereum' ? 2 : id === 'gold' ? 2 : 2;
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function fmtPct(value) {
    if (!Number.isFinite(Number(value))) return '涨跌幅暂不可用';
    var n = Number(value);
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function tone(value) {
    if (!Number.isFinite(Number(value)) || Number(value) === 0) return 'text-body-secondary';
    return Number(value) > 0 ? 'text-up' : 'text-down';
  }
  function timeText(value) {
    if (!value) return '报价时间未知';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '报价时间未知';
    return '报价时间：' + date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（北京时间）';
  }
  function renderVixTrend(history) {
    var points = Array.isArray(history) ? history.filter(function (p) {
      return p && Number.isFinite(Number(p.close)) && Number(p.close) > 0;
    }).slice(-22) : [];
    if (points.length < 2) {
      return '<div class="mini-label mt-2">近一个月趋势暂不可用，等待历史行情数据</div>';
    }
    var values = points.map(function (p) { return Number(p.close); });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = max - min || 1;
    var coords = values.map(function (v, i) {
      return {
        x: 4 + i * 272 / (values.length - 1),
        y: 56 - (v - min) * 48 / span
      };
    });
    var path = coords.map(function (p, i) {
      return (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');
    var first = values[0];
    var last = values[values.length - 1];
    var trendPct = first ? (last - first) / first * 100 : null;
    var trendText = Number.isFinite(trendPct)
      ? '区间变化 ' + (trendPct > 0 ? '+' : '') + trendPct.toFixed(2) + '%'
      : '区间变化暂不可用';
    var color = last > first ? 'var(--up)' : last < first ? 'var(--down)' : 'currentColor';
    var startDate = points[0].date || '';
    var endDate = points[points.length - 1].date || '';
    return '<div class="mt-2">'
      + '<div class="d-flex justify-content-between align-items-center mini-label"><span>近一个月走势</span><span>' + esc(trendText) + '</span></div>'
      + '<svg viewBox="0 0 280 64" role="img" aria-label="VIX近一个月日收盘走势" style="width:100%;height:68px;display:block;overflow:visible;color:' + color + '">'
      + '<line x1="4" y1="60" x2="276" y2="60" stroke="currentColor" stroke-opacity=".18" stroke-width="1"/>'
      + '<path d="' + path + '" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="' + coords[coords.length - 1].x.toFixed(1) + '" cy="' + coords[coords.length - 1].y.toFixed(1) + '" r="3" fill="currentColor"/>'
      + '</svg>'
      + '<div class="d-flex justify-content-between mini-label"><span>' + esc(startDate) + '</span><span>' + esc(endDate) + '</span></div>'
      + '<div class="mini-label mt-1">VIX衡量标普 500 期权隐含的预期波动；上升通常代表避险情绪增强，不代表市场方向预测。</div>'
      + '</div>';
  }
  function render(payload) {
    var data = payload && Array.isArray(payload.assets) ? payload.assets : [];
    var byId = {};
    data.forEach(function (item) { if (item && item.id) byId[item.id] = item; });
    var node = el('global-assets-cards');
    if (!node) return;
    node.innerHTML = assets.map(function (meta) {
      var item = byId[meta.id] || {};
      var valid = Number.isFinite(Number(item.price)) && Number(item.price) > 0;
      var change = item.changePct;
      var status = item.status || (valid ? '最近有效报价' : '等待可靠报价');
      var quoteTime = item.quoteTime ? timeText(item.quoteTime) : '暂无有效报价时间';
      var source = item.sourceUrl || 'https://finance.yahoo.com/';
      return '<article class="insight-card">'
        + '<div class="d-flex justify-content-between align-items-start gap-2"><div><div class="fw-bold">' + esc(meta.name) + '</div><div class="mini-label">' + esc(meta.kind) + ' · ' + esc(item.currency || meta.unit) + '</div></div><span class="flag" style="margin:0">' + esc(status) + '</span></div>'
        + '<div class="business-price mt-2">' + (valid ? fmtPrice(item.price, meta.id) : '—') + '</div>'
        + '<div class="' + tone(change) + ' fw-semibold">' + fmtPct(change) + '</div>'
        + (meta.id === 'vix' ? renderVixTrend(item.history) : '')
        + '<div class="mini-label mt-1">' + esc(quoteTime) + '</div>'
        + '<div class="mini-label mt-1">代码：' + esc(item.sourceSymbol || meta.symbol) + ' · <a href="' + esc(source) + '" target="_blank" rel="noopener noreferrer">行情来源</a></div>'
        + '</article>';
    }).join('');
    var updated = el('global-assets-updated');
    if (updated) {
      var when = payload && payload.updatedAt ? timeText(payload.updatedAt) : '尚无抓取记录';
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
    fetch('./global-assets-data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        render(payload);
        lastLoad = Date.now();
      })
      .catch(function (error) {
        var updated = el('global-assets-updated');
        if (updated) updated.textContent = '行情缓存读取失败：' + String(error && error.message || error) + '。稍后重试。';
        var node = el('global-assets-cards');
        if (node) node.innerHTML = '<div class="empty-state">当前无法读取全球资产行情文件；请稍后重试。</div>';
      })
      .finally(function () { loading = false; });
  }
  function onTab(target) { if (target === 'assets') load(false); }
  function init() {
    var button = el('global-assets-refresh');
    if (button) button.addEventListener('click', function () { lastLoad = 0; load(true); });
  }
  init();
  global.StockGlobalAssets = { init: init, load: load, onTab: onTab };
})(window);
