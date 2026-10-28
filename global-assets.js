/* Global asset cards backed by the scheduled public quote cache. */
(function (global) {
  'use strict';
  var assets = [
    { id: 'gold', name: '黄金', symbol: 'XAUUSD=X', kind: '贵金属', unit: 'USD/盎司' },
    { id: 'bitcoin', name: '比特币', symbol: 'BTC-USD', kind: '加密资产', unit: 'USD' },
    { id: 'ethereum', name: '以太坊', symbol: 'ETH-USD', kind: '加密资产', unit: 'USD' },
    { id: 'nikkei225', name: '日经 225', symbol: '^N225', kind: '海外指数', unit: '指数点' },
    { id: 'nasdaq100', name: '纳斯达克 100', symbol: '^NDX', kind: '海外指数', unit: '指数点' },
    { id: 'sp500', name: '标普 500', symbol: '^GSPC', kind: '海外指数', unit: '指数点' }
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
    var digits = id === 'bitcoin' ? 0 : id === 'ethereum' ? 2 : id === 'gold' ? 2 : 2;
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
