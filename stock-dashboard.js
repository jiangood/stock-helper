// ============================================================
// State
// ============================================================
let STOCKS = [];
const priceData = {};          // code -> { price, prevClose, change, todayChange }
let filteredStocks = [];
let sortState = { col: null, dir: 1 };

const $ = id => document.getElementById(id);

// 行情从 static-quotes.js 读取同源静态缓存，不在浏览器访问外部行情源
const quotes = new StockQuotes.Client({
  timeout: 8000,
  retries: 1,
  cacheTTL: 1000,
  onError: err => console.warn('[StockQuotes]', err.code, err.message)
});

// ============================================================
// 数据加载
// ============================================================
async function loadStocks() {
  const dataUrl = new URL('data/stocks.json', document.baseURI).href;
  try {
    const res = await fetch(dataUrl, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      const detail = {
        time: new Date().toISOString(),
        type: '股票数据请求失败',
        url: res.url || dataUrl,
        status: res.status,
        statusText: res.statusText,
        page: location.href
      };
      throw Object.assign(new Error('HTTP ' + res.status + ' ' + res.statusText), { diagnostic: detail });
    }
    try {
      STOCKS = await res.json();
      if (!Array.isArray(STOCKS)) throw new Error('JSON 顶层不是数组');
    } catch (parseError) {
      throw Object.assign(parseError, { diagnostic: {
        time: new Date().toISOString(),
        type: '股票 JSON 解析失败',
        url: res.url || dataUrl,
        status: res.status,
        page: location.href,
        message: parseError.message
      }});
    }
  } catch (e) {
    const detail = e.diagnostic || {
      time: new Date().toISOString(),
      type: '股票数据加载失败',
      url: dataUrl,
      page: location.href,
      message: e.message,
      name: e.name,
      stack: e.stack || ''
    };
    console.error('加载股票数据失败:', e, detail);
    showErrorDialog(detail);
    STOCKS = [];
    showToast('股票数据加载失败：' + e.message);
  }
  buildSearchKeys();
  buildGroupOptions();
  applyFilter();
}

/** 预计算拼音检索键（名称 + 别名），只算一次 */
function buildSearchKeys() {
  if (typeof Pinyin === 'undefined') return;
  STOCKS.forEach(s => {
    const text = (s.name || '') + (s.alias || '');
    s._py = Pinyin.initials(text).replace(/\s+/g, '');
    s._pyf = Pinyin.full(text).replace(/\s+/g, '');
    s._pyu = s._pyf.replace(/v/g, 'u');   // 绿 lv / lu 都能搜到
  });
}

function buildGroupOptions() {
  const sel = $('group-filter');
  const groups = Array.from(new Set(STOCKS.map(s => s.group).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'zh'));
  const current = sel.value;
  sel.innerHTML = '<option value="">全部分组</option>'
    + groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
  sel.value = groups.includes(current) ? current : '';
}

// ============================================================
// 排序
// ============================================================
function getSortValue(stock, col) {
  const pd = priceData[stock.code];
  const price = pd ? pd.price : null;
  switch (col) {
    case 'name':     return stock.name;
    case 'price':    return price;
    case 'prevChg':  return stock.prevChg;
    case 'yearInit': return stock.yearInit;
    case 'totalCap': return pd ? pd.totalCap : null;
    case 'pe':       return pd ? pd.pe : null;
    case 'pb':       return pd ? pd.pb : null;
    case 'divYield': return pd ? pd.divYield : null;
    case 'screen':   return pd ? Croc.screen(stock, pd).passed : null;
    case 'entry':    return (price != null && stock.entry) ? (price - stock.entry) / stock.entry : null;
    case 'heavy':    return (price != null && stock.heavy) ? (price - stock.heavy) / stock.heavy : null;
    case 'tp1':      return stock.tp1;
    case 'tp2':      return stock.tp2;
    case 'group':    return stock.group || '';
    case 'alias':    return stock.alias || '';
    default:         return null;
  }
}

function sortedView(list) {
  if (!sortState.col) return list;
  return [...list].sort((a, b) => {
    const av = getSortValue(a, sortState.col);
    const bv = getSortValue(b, sortState.col);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv, 'zh') * sortState.dir;
    return (av - bv) * sortState.dir;
  });
}

function updateSortUI() {
  ['name','price','entry','heavy','prevChg','tp1','tp2','yearInit','totalCap','pe','pb','divYield','screen','group','alias'].forEach(col => {
    const th = $('th-' + col);
    if (!th) return;
    th.classList.remove('sort-asc', 'sort-desc');
    if (sortState.col === col) th.classList.add(sortState.dir === 1 ? 'sort-asc' : 'sort-desc');
  });
}

function sortTable(col) {
  if (sortState.col === col) {
    if (sortState.dir === 1)       sortState.dir = -1;
    else if (sortState.dir === -1) { sortState.dir = 0; sortState.col = null; }
    else                           { sortState.dir = 1; sortState.col = col; }
  } else {
    sortState.col = col;
    sortState.dir = 1;
  }
  buildTable();
  updateSortUI();
}

// ============================================================
// 渲染
// ============================================================
function buildTable() {
  const view = sortedView(filteredStocks);
  $('stock-tbody').innerHTML = view.map(s => `<tr class="${rowClass(s)}">${buildRow(s)}</tr>`).join('');
  $('stock-count').textContent = view.length === STOCKS.length ? view.length : `${view.length}/${STOCKS.length}`;
  updateSummary();
}

/** 顶部摘要：重仓 / 破净 / 八折 / 风险 */
function updateSummary() {
  const el = $('board-summary');
  if (!el) return;
  const c = { heavy: 0, pb: 0, pb80: 0, risk: 0, pass: 0 };
  STOCKS.forEach(s => {
    const e = Croc.evaluate(s, priceData[s.code]);
    if (e.zone === 'heavy') c.heavy++;
    if (e.pbUnder1) c.pb++;
    if (e.pbGolden) c.pb80++;
    if (e.st || e.loss) c.risk++;
    if (Croc.screen(s, priceData[s.code]).allPass) c.pass++;
  });
  el.innerHTML = `重仓 <b class="text-body">${c.heavy}</b> · 破净 <b class="text-body">${c.pb}</b>`
    + ` · 八折 <b class="text-body">${c.pb80}</b> · 纪律 <b class="text-body">${c.pass}</b>`
    + ` · 风险 <b class="${c.risk ? 'text-up' : 'text-body'}">${c.risk}</b>`;
}

function rowClass(stock) {
  const pd = priceData[stock.code];
  if (!pd || stock.entry == null) return '';
  const zone = Croc.zoneOf(stock, pd.price);
  // 价格进入计划区不等于可以买；ST、亏损或盈利数据缺失时不显示绿色买入底色。
  if ((zone === 'heavy' || zone === 'entry') && !Croc.buyEligibility(stock, pd).eligible) return '';
  if (zone === 'heavy') return 'row-buy';
  if (zone === 'entry') return 'row-below';
  if (zone === 'above') return 'row-above';
  return '';
}

function buildRow(stock) {
  const pd = priceData[stock.code];
  const price = pd ? pd.price : null;
  const e = Croc.evaluate(stock, pd);

  let priceHtml = '<span class="text-body-tertiary">…</span>';
  let entryHtml = stock.entry != null ? Number(stock.entry).toFixed(2) : '<span class="text-body-tertiary">—</span>';
  let heavyHtml = stock.heavy != null ? Number(stock.heavy).toFixed(2) : '<span class="text-body-tertiary">—</span>';
  let entryDiff = '';
  let heavyDiff = '';
  let priceClass = '';

  if (price != null && price > 0) {
    const prev = pd.prevClose;
    priceClass = prev == null ? '' : price > prev ? 'text-up' : price < prev ? 'text-down' : '';
    priceHtml = `<span class="price-cell ${priceClass}">${price.toFixed(2)}</span>`;

    if (stock.entry) entryDiff = diffHtml((price - stock.entry) / stock.entry * 100);
    if (stock.heavy) heavyDiff = diffHtml((price - stock.heavy) / stock.heavy * 100);
  }

  // 止盈列
  let tp1Html = stock.tp1 != null ? `<span class="text-body-secondary">${stock.tp1}</span>` : '<span class="text-body-tertiary">—</span>';
  if (price != null && stock.tp1 != null) {
    tp1Html = price >= stock.tp1
      ? `<span class="badge badge-tp text-bg-warning-subtle border border-warning-subtle text-warning-emphasis">${stock.tp1} ✓</span>`
      : `<span class="text-body-secondary">${stock.tp1}<span class="diff text-down">+${((stock.tp1 - price) / price * 100).toFixed(1)}%</span></span>`;
  }
  let tp2Html = stock.tp2 != null ? `<span class="text-body-secondary">${stock.tp2}</span>` : '<span class="text-body-tertiary">—</span>';
  if (price != null && stock.tp2 != null && price >= stock.tp2) {
    tp2Html = `<span class="badge badge-tp text-bg-primary-subtle border border-primary-subtle text-primary-emphasis">${stock.tp2} ✓</span>`;
  }

  const prevChgHtml = stock.prevChg != null
    ? `<span class="${stock.prevChg > 0 ? 'text-up' : stock.prevChg < 0 ? 'text-down' : 'text-body-secondary'}">${stock.prevChg > 0 ? '+' : ''}${Number(stock.prevChg).toFixed(2)}%</span>`
    : '<span class="text-body-tertiary">—</span>';

  const aliasHtml = stock.alias
    ? `<span class="tag tag-alias" title="${esc(stock.alias)}">${esc(stock.alias)}</span>`
    : '<span class="text-body-tertiary">—</span>';
  const nameHtml = stock.code
    ? `<a class="stock-name text-decoration-none text-body" href="stock.html?code=${encodeURIComponent(stock.code)}" title="查看 ${esc(stock.name)} 详情">${esc(stock.name)}</a>${flagHtml(e, stock, pd)}`
    : `<span class="stock-name">${esc(stock.name)}</span>${flagHtml(e, stock, pd)}`;

  return `
    <td>${nameHtml}</td>
    <td>${priceHtml}</td>
    <td>${heavyHtml}${heavyDiff}</td>
    <td>${entryHtml}${entryDiff}</td>
    <td>${prevChgHtml}</td>
    <td>${tp1Html}</td>
    <td>${tp2Html}</td>
    <td class="text-body-secondary">${stock.yearInit != null ? Number(stock.yearInit).toFixed(2) : '<span class="text-body-tertiary">—</span>'}</td>
    <td>${fmtCap(pd && pd.totalCap)}</td>
    <td>${fmtRatio(pd && pd.pe)}</td>
    <td>${fmtRatio(pd && pd.pb)}</td>
    <td>${fmtPct(pd && pd.divYield)}</td>
    <td>${screenHtml(stock, pd, e)}</td>
    <td>${stock.group ? `<span class="tag">${esc(stock.group)}</span>` : '<span class="text-body-tertiary">—</span>'}</td>
    <td>${aliasHtml}</td>`;
}

function flagHtml(e, stock, quote) {
  if (e.st) return '<span class="flag flag-danger" title="ST 风险警示股：铁律不买 ST">ST</span>';
  if (e.loss) return '<span class="flag flag-warn" title="TTM 亏损：铁律不买亏损股">亏</span>';
  const eligible = Croc.buyEligibility(stock, quote).eligible;
  const cls = eligible ? 'flag-buy' : 'flag-warn';
  const caveat = eligible
    ? '仍需核对主营、行业周期与安全边际'
    : '不是买点信号：先核实盈利并满足不买ST/亏损股纪律';
  if (e.pbGolden) return `<span class="flag ${cls}" title="PB≤0.8：净资产八折估值参考；${caveat}">八折</span>`;
  if (e.pbUnder1) return `<span class="flag ${cls}" title="PB<1：破净估值参考；${caveat}">破净</span>`;
  return '';
}

/** 首页纪律列：5 项可量化选股条件的通过情况 */
function screenHtml(stock, pd, e) {
  if (!pd || !e || e.price === null) return '<span class="text-body-tertiary">—</span>';
  const sc = Croc.screen(stock, pd);
  const tip = '选股纪律：非ST · 非亏损 · PE≤30 · 市值≤200亿 · PB<1'
    + (sc.failed.length ? `；未过 ${sc.failed.map(f => f.label).join('、')}` : '')
    + (sc.pending.length ? `；未取到 ${sc.pending.map(f => f.label).join('、')}` : '');
  if (sc.allPass) {
    return `<span class="flag flag-buy" style="margin-left:0" title="${esc(tip)}">全过</span>`;
  }
  if (sc.complete && sc.passed === sc.total - 1) {
    return `<span class="flag flag-warn" style="margin-left:0" title="${esc(tip)}">${sc.passed}/${sc.total}</span>`;
  }
  return `<span class="text-body-tertiary" style="font-size:11px" title="${esc(tip)}">${sc.passed}/${sc.total}${sc.complete ? '' : '?'}</span>`;
}

/** 市值：元 -> 亿 / 万亿 */
function fmtCap(cap) {
  if (cap == null || !(cap > 0)) return '<span class="text-body-tertiary">—</span>';
  const yi = cap / 1e8;
  if (yi >= 1e4) return `<span class="text-body-secondary">${(yi / 1e4).toFixed(2)}<span class="unit">万亿</span></span>`;
  return `<span class="text-body-secondary">${yi >= 1e3 ? yi.toFixed(0) : yi.toFixed(1)}<span class="unit">亿</span></span>`;
}

/** 市盈率 / 市净率（负值表示亏损，弱化显示） */
function fmtRatio(v) {
  if (v == null || !isFinite(v)) return '<span class="text-body-tertiary">—</span>';
  return `<span class="${v > 0 ? 'text-body-secondary' : 'text-body-tertiary'}">${v.toFixed(2)}</span>`;
}

/** 股息率（%）：无分红 / 未取到显示 —；≥ 5% 高亮，作为收息参考 */
function fmtPct(v) {
  if (v == null || !isFinite(v) || v <= 0) return '<span class="text-body-tertiary">—</span>';
  const cls = v >= 5 ? 'text-body fw-semibold' : 'text-body-secondary';
  return `<span class="${cls}">${v.toFixed(2)}<span class="unit">%</span></span>`;
}

function diffHtml(d) {
  const cls = d > 0 ? 'text-up' : d < 0 ? 'text-down' : 'text-body-secondary';
  return `<span class="diff ${cls}">${d > 0 ? '+' : ''}${d.toFixed(2)}%</span>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// 行情（通过同源静态缓存获取）
// ============================================================
async function loadPrices(manual) {
  if (!STOCKS.length) return;
  if (manual) spinRefresh();

  try {
    const codes = STOCKS.map(s => s.code).filter(Boolean);
    const data = await quotes.fetch(codes, { force: !!manual });

    Object.keys(priceData).forEach(k => { delete priceData[k]; });
    Object.assign(priceData, data);

    applyFilter();
    if (manual) showToast('已重新读取静态行情缓存', 'success');
  } catch (e) {
    console.error('获取行情失败:', e);
    showToast('行情获取失败：' + e.message);
  }
}

function spinRefresh() {
  const btn = $('refresh-btn');
  btn.classList.add('disabled');
  btn.textContent = '◌';
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.classList.remove('disabled');
    btn.textContent = '⟳';
  }, 900);
}

// ============================================================
// 可复制错误诊断弹窗：请求失败、脚本异常、未处理 Promise 和资源加载错误
// ============================================================
function showErrorDialog(detail) {
  const previous = document.getElementById('diagnostic-error-dialog');
  const details = previous ? previous.querySelector('textarea') : null;
  const line = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
  if (details) {
    details.value += '\n\n--- 后续错误 ---\n' + line;
    return;
  }

  const dialog = document.createElement('dialog');
  dialog.id = 'diagnostic-error-dialog';
  dialog.style.cssText = 'width:min(760px,94vw);max-height:88vh;border:1px solid var(--bs-border-color,#ccc);border-radius:12px;padding:18px;background:var(--bs-body-bg,#fff);color:var(--bs-body-color,#222);box-shadow:0 12px 48px #0005;z-index:10000';
  dialog.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
      <strong style="font-size:17px">页面错误详情（可复制）</strong>
      <button type="button" data-close style="font-size:22px;border:0;background:transparent;color:inherit;cursor:pointer" aria-label="关闭">×</button>
    </div>
    <p style="font-size:13px;margin:0 0 8px;color:var(--bs-secondary-color,#666)">请点击“复制错误信息”，然后把内容发给我。也可以手动选中文本复制。</p>
    <textarea aria-label="错误详情" readonly spellcheck="false" style="box-sizing:border-box;width:100%;height:min(48vh,360px);resize:vertical;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;padding:10px;border:1px solid var(--bs-border-color,#ccc);border-radius:6px;background:var(--bs-tertiary-bg,#f8f8f8);color:inherit"></textarea>
    <div style="display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-top:12px">
      <button type="button" data-copy style="padding:8px 14px;border:0;border-radius:6px;background:#0d6efd;color:white;cursor:pointer">复制错误信息</button>
      <button type="button" data-close style="padding:8px 14px;border:1px solid var(--bs-border-color,#ccc);border-radius:6px;background:transparent;color:inherit;cursor:pointer">关闭</button>
    </div>`;
  document.body.appendChild(dialog);
  dialog.querySelector('textarea').value = line;
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
    if (typeof dialog.close === 'function') dialog.close();
    dialog.remove();
  }));
  dialog.querySelector('[data-copy]').addEventListener('click', async () => {
    const area = dialog.querySelector('textarea');
    try {
      await navigator.clipboard.writeText(area.value);
      dialog.querySelector('[data-copy]').textContent = '已复制';
    } catch (_) {
      area.focus();
      area.select();
      const copied = document.execCommand('copy');
      dialog.querySelector('[data-copy]').textContent = copied ? '已复制' : '请手动复制';
    }
  });
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

(function bindRuntimeDiagnostics() {
  window.addEventListener('error', event => {
    // 捕获资源加载失败（例如脚本、样式、图片返回 404）。
    if (event.target && event.target !== window) {
      const target = event.target;
      const url = target.src || target.href || '';
      if (!url) return;
      showErrorDialog({
        time: new Date().toISOString(),
        type: '资源加载失败（请检查 URL / Network 状态码）',
        resourceType: target.tagName || 'unknown',
        url,
        page: location.href,
        note: '浏览器资源错误事件通常不暴露 HTTP 状态码；请将此 URL 发回以进一步定位。'
      });
      return;
    }
    showErrorDialog({
      time: new Date().toISOString(),
      type: 'JavaScript 运行错误',
      message: event.message || '未知脚本错误',
      file: event.filename || '',
      line: event.lineno || '',
      column: event.colno || '',
      stack: event.error && event.error.stack || '',
      page: location.href
    });
  }, true);
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    showErrorDialog({
      time: new Date().toISOString(),
      type: '未处理的 Promise 异常',
      message: reason && reason.message ? reason.message : String(reason),
      stack: reason && reason.stack || '',
      page: location.href
    });
  });
})();

function showToast(msg, type) {
  const t = $('toast');
  t.className = 'alert position-fixed bottom-0 start-50 translate-middle-x mb-3 py-2 px-3 small shadow '
              + (type === 'success' ? 'alert-success' : 'alert-danger');
  t.textContent = msg;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('d-none'), 2400);
}

// ============================================================
// 股票池体检
// ============================================================
function openHealth() {
  const h = Croc.health(STOCKS, priceData);
  const order = { error: 0, warn: 1, risk: 2 };
  const issues = h.issues.slice().sort((a, b) => order[a.level] - order[b.level]);

  const label = { error: ['错误', 'flag-danger'], warn: ['提示', 'flag-warn'], risk: ['风险', 'flag-danger'] };

  const head = `<div class="d-flex flex-wrap gap-2 align-items-center mb-2" style="font-size:12px">
    <span class="text-body-secondary">${STOCKS.length} 只标的</span>
    <span class="flag flag-danger" style="margin-left:0">错误 ${h.errors}</span>
    <span class="flag flag-warn" style="margin-left:0">提示 ${h.warnings}</span>
    <span class="flag flag-danger" style="margin-left:0">风险 ${h.risks}</span>
  </div>`;

  const body = issues.length
    ? `<div class="health-list">${issues.map(i => {
        const [text, cls] = label[i.level] || label.warn;
        const name = i.code
          ? `<a class="text-body text-decoration-none" href="stock.html?code=${encodeURIComponent(i.code)}">${esc(i.name)}</a>`
          : esc(i.name);
        return `<div class="health-item">
          <span class="flag ${cls}">${text}</span>
          <div class="min-w-0">
            <div class="fw-semibold" style="font-size:12px">${name}
              ${i.code ? `<span class="text-body-tertiary fw-normal font-monospace">${esc(i.code)}</span>` : ''}
            </div>
            <div class="text-body-secondary" style="font-size:11px">${esc(i.text)}</div>
          </div>
        </div>`;
      }).join('')}</div>`
    : '<div class="alert alert-success py-2 px-3 small mb-2">未发现结构化问题。</div>';

  $('health-body').innerHTML = head + body
    + '<div class="text-body-secondary mt-2" style="font-size:10.5px">'
    + '自动检查：代码/重复、买点区间、止盈顺序、ST、TTM 亏损。国资背景、主营集中、护城河需人工核对。'
    + '</div>';

  const dlg = $('health-dialog');
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}

function closeHealth() {
  const dlg = $('health-dialog');
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
}

// ============================================================
// 筛选
// ============================================================
function applyFilter() {
  const q = ($('search-input').value || '').trim().toLowerCase();
  const key = q.replace(/\s+/g, '');
  const lettersOnly = /^[a-z]+$/.test(key);
  const group = $('group-filter').value;
  const status = $('status-filter').value;

  filteredStocks = STOCKS.filter(s => {
    if (group && s.group !== group) return false;
    if (status && !Croc.matchStatus(s, priceData[s.code], status)) return false;
    if (!q) return true;
    return s.name.toLowerCase().includes(q)
        || (s.code && s.code.toLowerCase().includes(q))
        || (s.alias && s.alias.toLowerCase().includes(q))
        || (s.group && s.group.toLowerCase().includes(q))
        || (lettersOnly && (
             (s._py && s._py.includes(key))
          || (s._pyf && s._pyf.includes(key))
          || (s._pyu && s._pyu.includes(key))
        ));
  });
  buildTable();
  if (window.StockBusiness) window.StockBusiness.renderOpportunity();
}

// ============================================================
// 自动刷新调度
// ============================================================
// Theme switching removed; the dashboard uses dark mode by default.


// ============================================================
// 启动
// ============================================================
(function bindHealthDialog() {
  const dlg = $('health-dialog');
  if (!dlg) return;
  dlg.addEventListener('click', e => {
    if (e.target === dlg) closeHealth();
  });
})();

(function bindBottomTabs() {
  document.querySelectorAll('.bottom-tab').forEach(function (button) {
    button.addEventListener('click', function () {
      const target = button.dataset.target;
      document.querySelectorAll('[data-pane]').forEach(function (pane) {
        pane.classList.toggle('d-none', pane.dataset.pane !== target);
      });
      document.querySelectorAll('.bottom-tab').forEach(function (tab) {
        const active = tab.dataset.target === target;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-current', active ? 'page' : 'false');
      });
      $('stock-toolbar').classList.toggle('d-none', target !== 'stocks');
      if (window.StockCombat) window.StockCombat.onTab(target);
      if (window.StockBusiness) window.StockBusiness.onTab(target);
      if (window.StockGlobalAssets) window.StockGlobalAssets.onTab(target);
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  });
})();

(async function init() {
  await loadStocks();
  if (window.StockBusiness) window.StockBusiness.init(STOCKS, priceData, quotes);
  await loadPrices(false);
  if (window.StockCombat) window.StockCombat.init(STOCKS, priceData, quotes);
})();
