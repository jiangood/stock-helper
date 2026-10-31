// ============================================================
// State
// ============================================================
let STOCKS = [];
const priceData = {};          // code -> { price, prevClose, change, todayChange }
let filteredStocks = [];
let sortState = { col: null, dir: 1 };
let RESEARCH = { totalMax: 32, bands: [], criteria: {} };
const researchScores = {};     // code -> { items, points, max, percent, band, metrics }
let REPORT_SCORES = {};        // code -> { score, date, source, alternates }
let REPORT_BANDS = [];
let monthlyTrends = {}; // code -> 最近 200 根复权月收盘价

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
  applyFilter();
}

/** 读取 Actions 生成的研报评分小文件；失败时静默降级为「—」 */
/** 读取首页专用月线趋势索引；缺失或异常时图表降级为横线 */
async function loadMonthlyTrends() {
  try {
    const res = await fetch(new URL('data/cache/stock-details.json', document.baseURI).href, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const payload = await res.json();
    monthlyTrends = payload && payload.monthlyTrends && typeof payload.monthlyTrends === 'object'
      ? payload.monthlyTrends : {};
  } catch (e) {
    monthlyTrends = {};
    console.warn('首页月线趋势加载失败：', e.message);
  }
}

async function loadResearchScores() {
  try {
    const res = await fetch(new URL('data/research-scores.json', document.baseURI).href, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const payload = await res.json();
    Object.keys(researchScores).forEach(key => { delete researchScores[key]; });
    Object.assign(researchScores, payload && payload.scores ? payload.scores : {});
    RESEARCH = {
      totalMax: Number(payload && payload.totalMax) || 32,
      bands: Array.isArray(payload && payload.bands) ? payload.bands : [],
      criteria: (payload && payload.criteria) || {}
    };
  } catch (e) {
    console.warn('研报评分加载失败：', e.message);
  }
}

/** 读取研报已给出的总分（静态摘录，人工维护一次即可） */
async function loadReportScores() {
  try {
    const res = await fetch(new URL('data/research-reports.json', document.baseURI).href, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const payload = await res.json();
    REPORT_SCORES = payload && payload.reports ? payload.reports : {};
    REPORT_BANDS = Array.isArray(payload && payload.bands) ? payload.bands : [];
  } catch (e) {
    console.warn('研报评分表加载失败：', e.message);
    REPORT_SCORES = {};
    REPORT_BANDS = [];
  }
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


// ============================================================
// 排序
// ============================================================
function getSortValue(stock, col) {
  const pd = priceData[stock.code];
  const price = pd ? pd.price : null;
  switch (col) {
    case 'name':     return stock.name;
    case 'price':    return price;
    case 'yearInit': return stock.yearInit;
    case 'totalCap': return pd ? pd.totalCap : null;
    case 'pe':       return pd ? pd.pe : null;
    case 'pb':       return pd ? pd.pb : null;
    case 'divYield': return pd ? pd.divYield : null;
    case 'screen':   return pd ? Croc.screen(stock, pd).passed : null;
    case 'researchMachine': {
      const score = researchScores[stock.code];
      return score && Number.isFinite(score.percent) ? score.percent : null;
    }
    case 'researchReport': {
      const report = REPORT_SCORES[stock.code];
      return report && report.score != null && Number.isFinite(report.score) ? report.score : null;
    }
    case 'researchDate': {
      const report = REPORT_SCORES[stock.code];
      return report && /^\d{4}-\d{2}-\d{2}$/.test(report.date || '') ? report.date : null;
    }
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
  ['name','price','entry','heavy','tp1','tp2','yearInit','totalCap','pe','pb','divYield','screen','researchMachine','researchReport','researchDate','group','alias'].forEach(col => {
    const th = $('th-' + col);
    if (!th) return;
    const active = sortState.col === col;
    th.classList.toggle('sort-asc', active && sortState.dir === 1);
    th.classList.toggle('sort-desc', active && sortState.dir === -1);
    th.setAttribute('aria-sort', !active ? 'none' : sortState.dir === 1 ? 'ascending' : 'descending');
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
  const tbody = $('stock-tbody');
  if (!tbody) return;
  const view = sortedView(filteredStocks);
  if (!view.length) {
    tbody.innerHTML = '';
    setEmptyState(true, '没有匹配的标的。<button type="button" class="btn btn-sm btn-outline-secondary ms-2" onclick="resetFilters()">清空筛选</button>');
  } else {
    setEmptyState(false);
    tbody.innerHTML = view.map(s => `<tr class="${rowClass(s)}">${buildRow(s)}</tr>`).join('');
  }
  updateScrollHint();
}

/** 空结果提示放在滚动区之外，避免被首列固定定位吃掉 */
function setEmptyState(show, message) {
  const wrap = document.querySelector('.table-scroll-wrap');
  if (!wrap) return;
  let box = wrap.querySelector('.stock-empty');
  if (show) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'stock-empty empty-state m-2 text-center';
      wrap.appendChild(box);
    }
    box.innerHTML = message;
    box.hidden = false;
  } else if (box) {
    box.hidden = true;
  }
}

/** 清空搜索与筛选，恢复完整列表 */
function resetFilters() {
  const search = $('search-input');
  if (search) search.value = '';
  applyFilter();
  if (search) search.focus();
}
window.resetFilters = resetFilters;

/** 表头排序按钮（原生按钮，键盘 Enter / Space 可用） */
function bindSortButtons() {
  document.querySelectorAll('.th-sort[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => sortTable(btn.dataset.sort));
  });
}

/** 表格横向滚动提示与滚动区焦点 */
function updateScrollHint() {
  const sc = document.querySelector('.table-scroll');
  const wrap = sc && sc.closest('.table-scroll-wrap');
  if (!sc || !wrap) return;
  const remaining = sc.scrollWidth - sc.clientWidth - sc.scrollLeft;
  wrap.classList.toggle('can-scroll-right', remaining > 4);
}

function bindScrollHint() {
  const sc = document.querySelector('.table-scroll');
  if (!sc) return;
  sc.addEventListener('scroll', updateScrollHint, { passive: true });
  window.addEventListener('resize', updateScrollHint);
}

/** 顶栏高度随换行变化，用于表格滚动区的动态高度 */
function syncHeaderHeight() {
  const head = document.querySelector('.sticky-top');
  if (!head) return;
  let last = -1;
  let queued = false;
  const measure = () => {
    queued = false;
    const h = Math.round(head.getBoundingClientRect().height);
    if (!h || h === last) return;
    last = h;
    document.documentElement.style.setProperty('--app-header-h', h + 'px');
  };
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  };
  measure();
  if (typeof ResizeObserver === 'function') new ResizeObserver(schedule).observe(head);
  window.addEventListener('resize', schedule);
}

/** 顶部摘要：重仓 / 破净 / 八折以内 / 风险 */
function updateSummary() {
  const el = $('board-summary');
  if (!el) return;
  const c = { heavy: 0, pb: 0, pb80: 0, risk: 0, pass: 0, score: 0 };
  STOCKS.forEach(s => {
    const e = Croc.evaluate(s, priceData[s.code]);
    if (e.zone === 'heavy') c.heavy++;
    if (e.pbUnder1) c.pb++;
    if (e.pbGolden) c.pb80++;
    if (e.st || e.loss) c.risk++;
    if (Croc.screen(s, priceData[s.code]).allPass) c.pass++;
    const report = REPORT_SCORES[s.code];
    if (report && Number.isFinite(report.score)) {
      if (report.score >= 80) c.score++;
    } else {
      const score = researchScores[s.code];
      if (score && Number.isFinite(score.percent) && score.percent >= 75) c.score++;
    }
  });
  el.innerHTML = `重仓 <b class="text-body">${c.heavy}</b> · 破净 <b class="text-body">${c.pb}</b>`
    + ` · 八折以内 <b class="text-body">${c.pb80}</b> · 纪律 <b class="text-body">${c.pass}</b>`
    + ` · 评分 <b class="text-body">${c.score}</b>`
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

function fmtCompact(value, decimals = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toFixed(decimals).replace(/\.?0+$/, '');
}

function buildRow(stock) {
  const pd = priceData[stock.code];
  const price = pd ? pd.price : null;
  const e = Croc.evaluate(stock, pd);

  let priceHtml = '<span class="text-body-tertiary">…</span>';
  let entryHtml = stock.entry != null ? fmtCompact(stock.entry) : '<span class="text-body-tertiary">—</span>';
  let heavyHtml = stock.heavy != null ? fmtCompact(stock.heavy) : '<span class="text-body-tertiary">—</span>';
  let entryDiff = '';
  let heavyDiff = '';
  let priceClass = '';

  if (price != null && price > 0) {
    const entry = stock.entry == null || stock.entry === '' ? NaN : Number(stock.entry);
    priceClass = !Number.isFinite(entry) || entry <= 0 ? '' : price > entry ? 'text-up' : price < entry ? 'text-down' : '';
    priceHtml = `<span class="price-cell ${priceClass}">${fmtCompact(price)}</span>`;

    if (stock.entry) entryDiff = diffHtml((price - stock.entry) / stock.entry * 100);
    if (stock.heavy) heavyDiff = diffHtml((price - stock.heavy) / stock.heavy * 100);
  }

  // 止盈列
  let tp1Html = stock.tp1 != null ? `<span class="text-body-secondary">${fmtCompact(stock.tp1)}</span>` : '<span class="text-body-tertiary">—</span>';
  if (price != null && stock.tp1 != null) {
    tp1Html = price >= stock.tp1
      ? `<span class="badge badge-tp text-bg-warning-subtle border border-warning-subtle text-warning-emphasis">${fmtCompact(stock.tp1)} ✓</span>`
      : `<span class="text-body-secondary">${fmtCompact(stock.tp1)}</span><span class="diff text-up">+${Math.round((stock.tp1 - price) / price * 100)}％</span>`;
  }
  let tp2Html = stock.tp2 != null ? `<span class="text-body-secondary">${fmtCompact(stock.tp2)}</span>` : '<span class="text-body-tertiary">—</span>';
  if (price != null && stock.tp2 != null) {
    tp2Html = price >= stock.tp2
      ? `<span class="badge badge-tp text-bg-primary-subtle border border-primary-subtle text-primary-emphasis">${fmtCompact(stock.tp2)} ✓</span>`
      : `<span class="text-body-secondary">${fmtCompact(stock.tp2)}</span><span class="diff text-up">+${Math.round((stock.tp2 - price) / price * 100)}％</span>`;
  }

  const monthlyTrend = monthlyTrendHtml(stock);
  const aliasHtml = stock.alias
    ? `<span class="tag tag-alias" title="${esc(stock.alias)}">${esc(stock.alias)}</span>`
    : '<span class="text-body-tertiary">—</span>';
  const nameHtml = stock.code
    ? `<a class="stock-name text-decoration-none text-body" href="stock.html?code=${encodeURIComponent(stock.code)}" title="查看 ${esc(stock.name)} 详情">${esc(stock.name)}</a>${statusHtml(e, stock, pd)}`
    : `<span class="stock-name">${esc(stock.name)}</span>${flagHtml(e, stock, pd)}`;

  return `
    <td>${nameHtml}</td>
    <td class="monthly-trend-cell">${monthlyTrend}</td>
    <td>${priceHtml}</td>
    <td class="stacked-cell">${entryHtml}${entryDiff}</td>
    <td class="stacked-cell">${heavyHtml}${heavyDiff}</td>
    <td class="stacked-cell">${tp1Html}</td>
    <td class="stacked-cell">${tp2Html}</td>
    <td>${fmtCap(pd && pd.totalCap)}</td>
    <td>${fmtRatio(pd && pd.pe)}</td>
    <td>${fmtRatio(pd && pd.pb)}</td>
    <td>${fmtPct(pd && pd.divYield)}</td>
    <td>${researchReportHtml(stock)}</td>
    <td>${researchDateHtml(stock)}</td>
    <td>${stock.group ? esc(stock.group) : '<span class="text-body-tertiary">—</span>'}</td>
    <td>${aliasHtml}</td>`;
}

/** 最近 200 根复权月收盘价迷你趋势图；不插值、不补造缺失月份 */
function monthlyTrendHtml(stock) {
  const bars = monthlyTrends[stock.code];
  if (!Array.isArray(bars) || bars.length < 2) {
    return '<span class="monthly-trend-empty" title="暂无足够的月线数据">—</span>';
  }
  const values = bars.map(item => Number(item && item.close)).filter(value => Number.isFinite(value) && value > 0);
  if (values.length < 2) return '<span class="monthly-trend-empty" title="暂无足够的月线数据">—</span>';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(max * 0.02, 0.01);
  const points = values.map((value, index) => {
    const x = 2 + index * 108 / Math.max(1, values.length - 1);
    const y = 29 - (value - min) / span * 25;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');

  // 盈亏颜色只比较当前价与计划入场价：盈利红、亏损绿；不受止盈价影响。
  const quote = priceData[stock.code];
  const currentPrice = quote && Number.isFinite(quote.price) && quote.price > 0 ? quote.price : null;
  const entry = stock.entry == null || stock.entry === '' ? NaN : Number(stock.entry);
  let tone = 'monthly-trend-neutral';
  let status = '当前价或入场价缺失，无法判断盈亏';
  if (currentPrice !== null && Number.isFinite(entry) && entry > 0) {
    if (currentPrice > entry) {
      tone = 'monthly-trend-profit';
      status = '高于入场价，当前盈利';
    } else if (currentPrice < entry) {
      tone = 'monthly-trend-loss';
      status = '低于入场价，当前亏损';
    } else {
      status = '当前价等于入场价，盈亏持平';
    }
  }

  const first = values[0];
  const last = values[values.length - 1];
  const firstTime = bars[0] && bars[0].time || '';
  const lastTime = bars[bars.length - 1] && bars[bars.length - 1].time || '';
  const quoteText = currentPrice === null ? '当前价缺失' : '当前价 ' + currentPrice.toFixed(2);
  const entryText = Number.isFinite(entry) && entry > 0 ? '入场价 ' + entry.toFixed(2) : '入场价缺失';
  const title = status + ' · ' + quoteText + ' · ' + entryText
    + ' · 复权月收盘价 ' + firstTime + ' 至 ' + lastTime + ' · ' + first.toFixed(2) + ' → ' + last.toFixed(2);
  return '<svg class="monthly-trend-svg ' + tone + '" viewBox="0 0 112 32" role="img" aria-label="' + esc(title) + '" title="' + esc(title) + '"><polyline points="' + points + '"></polyline></svg>';
}

function statusHtml(e, stock, quote) {
  // 首页名称列不展示入场/重仓价格区间状态，仅保留 ST、亏损及估值提示。
  return flagHtml(e, stock, quote);
}

function flagHtml(e, stock, quote) {
  if (e.st) return '<span class="flag flag-danger" title="ST 风险警示股：铁律不买 ST">ST</span>';
  if (e.loss) return '<span class="flag flag-warn" title="TTM 亏损：铁律不买亏损股">亏</span>';
  const eligible = Croc.buyEligibility(stock, quote).eligible;
  const cls = eligible ? 'flag-buy' : 'flag-warn';
  const caveat = eligible
    ? '仍需核对主营、行业周期与安全边际'
    : '不是买点信号：先核实盈利并满足不买ST/亏损股纪律';
  if (e.pbGolden) {
    const quoteTime = Number(quote && quote.time);
    const quoteDate = Number.isFinite(quoteTime) && quoteTime > 0 && Number.isFinite(new Date(quoteTime).getTime())
      ? new Date(quoteTime).toISOString().slice(0, 10)
      : '未知';
    const detail = `PB ${fmtCompact(e.pb, 2)} · 股价 ${fmtCompact(e.price)} · 行情日期 ${quoteDate}`;
    return `<span class="flag ${cls}" title="${esc(`${detail}；折数按 PB×10 计算；${caveat}`)}">${fmtCompact(e.pbFold, 1)}折</span>`;
  }
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

function reportBandLabel(score) {
  const band = (REPORT_BANDS || []).find(item => score >= item.min);
  return band ? band.label : '';
}

/** 首页同时展示机器评分与研报评分；研报分始终标注报告日期。 */
/** 机器评分独立展示，按 32 分制折算百分制，缺失时不伪造分数。 */
function researchMachineHtml(stock) {
  const score = researchScores[stock.code];
  const percent = score && score.percent;
  if (!score || score.points == null || percent == null || !Number.isFinite(score.points) || !Number.isFinite(percent)) return '<span class="text-body-tertiary">—</span>';
  const max = Number.isFinite(score.max) && score.max > 0 ? score.max : RESEARCH.totalMax;
  const tone = score.band === 'good' ? 'good' : score.band === 'high' ? 'high' : 'mid';
  const band = (RESEARCH.bands.find(item => item.key === score.band) || {}).label || '';
  const items = score.items || {};
  const detail = [
    `国资 ${fmtScore(items.owner)}/10`, `主营 ${fmtScore(items.focus)}/9`,
    `扣非 ${fmtScore(items.profit)}/14`, `市值 ${fmtScore(items.cap)}/8`,
    `盘整 ${fmtScore(items.consolidation)}/9`, `月线 ${fmtScore(items.bottom)}/9`,
    `放量 ${fmtScore(items.volume)}/6`
  ].join(' · ');
  const tip = `机器复算 ${percent.toFixed(1)} 分（${score.points}/${max}）${band ? ' · ' + band : ''}\n${detail}\n按 7 项可复算指标折算（覆盖 65/100 权重）；不构成投资建议`;
  return `<span class="score score-${tone}" title="${esc(tip)}">${percent.toFixed(1)}</span>`;
}

/** 研报原始总分独立展示，不回退为机器评分。 */
function researchReportHtml(stock) {
  const report = REPORT_SCORES[stock.code];
  if (!report || report.score == null || !Number.isFinite(report.score)) return '<span class="text-body-tertiary">—</span>';
  const tone = report.score >= 80 ? 'good' : report.score >= 70 ? 'mid' : 'high';
  const scoreText = Number.isInteger(report.score) ? String(report.score) : report.score.toFixed(1);
  const tip = `研报评分 ${scoreText} 分 · ${reportBandLabel(report.score)}\n来源：${report.source || '未知'}\n报告日期：${report.date || '日期未知'}`;
  return `<span class="score score-${tone}" title="${esc(tip)}">${scoreText}</span>`;
}

/** 研报日期独立展示和排序；过期标记不改变用于排序的原始日期。 */
function researchDateHtml(stock) {
  const report = REPORT_SCORES[stock.code];
  if (!report || !/^\d{4}-\d{2}-\d{2}$/.test(report.date || '')) return '';
  return `<span class="score-date">${esc(report.date)}</span>`;
}

function fmtScore(value) {
  return value != null && Number.isFinite(value) ? value.toFixed(1) : '—';
}

/** 市值：元 -> 亿 / 万亿 */
function fmtCap(cap) {
  if (cap == null || !(cap > 0)) return '<span class="text-body-tertiary">—</span>';
  const yi = cap / 1e8;
  if (yi >= 1e4) return `<span class="text-body-secondary">${fmtCompact(yi / 1e4)}<span class="unit">万亿</span></span>`;
  return `<span class="text-body-secondary">${yi >= 1e3 ? yi.toFixed(0) : yi.toFixed(1)}<span class="unit">亿</span></span>`;
}

/** 市盈率 / 市净率（负值表示亏损，弱化显示） */
function fmtRatio(v) {
  if (v == null || !isFinite(v)) return '<span class="text-body-tertiary">—</span>';
  return `<span class="${v > 0 ? 'text-body-secondary' : 'text-body-tertiary'}">${fmtCompact(v)}</span>`;
}

/** 股息率（%）：无分红 / 未取到显示 —；≥ 5% 高亮，作为收息参考 */
function fmtPct(v) {
  if (v == null || !isFinite(v) || v <= 0) return '<span class="text-body-tertiary">—</span>';
  const cls = v >= 5 ? 'text-body fw-semibold' : 'text-body-secondary';
  return `<span class="${cls}">${fmtCompact(v)}<span class="unit">%</span></span>`;
}

function diffHtml(d) {
  const cls = d > 0 ? 'text-up' : d < 0 ? 'text-down' : 'text-body-secondary';
  return `<span class="diff ${cls}">${d > 0 ? '+' : ''}${Math.round(d)}％</span>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// 行情（通过同源静态缓存获取）
// ============================================================
async function loadPrices(manual, options) {
  if (!STOCKS.length) {
    if (manual) showToast('股票清单尚未加载完成，请稍后重试。');
    return;
  }
  if (manual) spinRefresh();

  try {
    const codes = STOCKS.map(s => s.code).filter(Boolean);
    const data = await quotes.fetch(codes, { force: !!manual });

    Object.keys(priceData).forEach(k => { delete priceData[k]; });
    Object.assign(priceData, data);

    if (!(options && options.deferRender)) applyFilter();
    if (manual) showToast('已重新读取静态行情缓存', 'success');
  } catch (e) {
    console.error('获取行情失败:', e);
    if (!(options && options.deferRender)) showToast('行情获取失败：' + e.message);
    else console.warn('行情加载失败，页面将保留基础股票清单：', e.message);
  } finally {
    if (manual) finishRefresh();
  }
}

function spinRefresh() {
  const btn = $('refresh-btn');
  if (!btn) return;
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
}

function finishRefresh() {
  const btn = $('refresh-btn');
  if (!btn) return;
  btn.removeAttribute('aria-busy');
  btn.disabled = false;
}

/** 重新读取同源静态行情缓存 */
async function refreshQuotes() {
  if (window.StockBusiness && typeof window.StockBusiness.reloadSectors === 'function') {
    try {
      await window.StockBusiness.reloadSectors();
    } catch (e) {
      console.warn('板块数据刷新失败：', e);
    }
  }
  await loadPrices(true);
}
window.refreshQuotes = refreshQuotes;

/** 主题：手动选择写入 localStorage，其余页面共享同一偏好 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-bs-theme', theme);
  const btn = $('theme-btn');
  if (!btn) return;
  const dark = theme === 'dark';
  btn.setAttribute('aria-pressed', String(dark));
  const label = dark ? '切换到浅色主题' : '切换到深色主题';
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function toggleTheme() {
  const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('stock-theme', next); } catch (e) {}
  applyTheme(next);
  // 图表配色来自 CSS 变量，切换主题后需要重建。
  if (window.StockBusiness && typeof window.StockBusiness.refreshCharts === 'function') {
    window.StockBusiness.refreshCharts();
  }
}

window.toggleTheme = toggleTheme;

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
    // ResizeObserver 的循环通知是浏览器噪声，不影响页面功能。
    if (/ResizeObserver loop/.test(event.message || '')) return;
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
// 筛选
// ============================================================
/** 状态筛选：评分相关由研报分与机器分共同判断，其余交给 Croc */
function matchStatusFilter(stock, status) {
  if (status === 'score-report') return !!REPORT_SCORES[stock.code];
  if (status === 'score-report80') {
    const report = REPORT_SCORES[stock.code];
    return !!report && Number.isFinite(report.score) && report.score >= 80;
  }
  if (status === 'score-low') {
    const report = REPORT_SCORES[stock.code];
    if (report && Number.isFinite(report.score)) return report.score < 70;
  }
  const score = researchScores[stock.code];
  const percent = score && score.percent != null && Number.isFinite(score.percent) ? score.percent : null;
  if (status === 'score-good') {
    const report = REPORT_SCORES[stock.code];
    if (report && Number.isFinite(report.score)) return report.score >= 80;
    return percent !== null && percent >= 75;
  }
  if (status === 'score-low') return percent !== null && percent < 56;
  return Croc.matchStatus(stock, priceData[stock.code], status);
}

function applyFilter() {
  const searchEl = $('search-input');
  const q = ((searchEl && searchEl.value) || '').trim().toLowerCase();
  const key = q.replace(/\\s+/g, '');
  const lettersOnly = /^[a-z]+$/.test(key);

  filteredStocks = STOCKS.filter(s => {
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
  if (window.StockBusiness) window.StockBusiness.renderBrief();
}

// ============================================================
// 自动刷新调度
// ============================================================
// Theme switching removed; the dashboard uses dark mode by default.


// ============================================================
// 启动
// ============================================================

// 页面导航由 index.html / market.html 的独立 URL 负责，不再在单页内切换 tabs。

function setPageLoading(message, done) {
  const el = $('page-loading');
  if (!el) return;
  if (done) {
    el.hidden = true;
    el.removeAttribute('aria-busy');
    return;
  }
  el.hidden = false;
  el.setAttribute('aria-busy', 'true');
  const text = el.querySelector('[data-loading-text]');
  if (text) text.textContent = message;
}

(async function init() {
  const startedAt = performance.now();
  const page = document.body.dataset.page || 'stocks';
  let keepLoadingMessage = false;
  try {
    if (page === 'stocks') sortState = { col: 'entry', dir: 1 };
    syncHeaderHeight();
    bindSortButtons();
    updateSortUI();
    bindScrollHint();
    applyTheme(document.documentElement.getAttribute('data-bs-theme') || 'light');
    setPageLoading('正在加载股票清单…');
    const stocksStartedAt = performance.now();
    await loadStocks();
    const stocksLoadedAt = performance.now();
    if (!STOCKS.length) {
      setPageLoading('股票清单加载失败，请检查网络后刷新。');
      keepLoadingMessage = true;
      return;
    }
    setPageLoading('股票清单已显示，正在并行读取评分与行情…');
    // 评分和行情互不依赖：并行请求；单项失败时保留基础股票清单。
    const results = await Promise.allSettled([
      loadResearchScores(),
      loadReportScores(),
      loadPrices(false, { deferRender: true }),
      loadMonthlyTrends()
    ]);
    if (STOCKS.length) applyFilter();
    const finishedAt = performance.now();
    console.info('[StockDashboard] 初始化耗时', {
      stocksMs: Math.round(stocksLoadedAt - stocksStartedAt),
      enrichmentMs: Math.round(finishedAt - stocksLoadedAt),
      totalMs: Math.round(finishedAt - startedAt),
      enrichment: results.map((result, index) => ({
        task: ['researchScores', 'reportScores', 'quotes', 'monthlyTrends'][index],
        status: result.status
      }))
    });
    if (page === 'market' && window.StockBusiness) window.StockBusiness.init(STOCKS, priceData, quotes);
    if (page === 'market') {
      if (window.StockBusiness) window.StockBusiness.onTab('market');
      if (window.StockGlobalAssets) window.StockGlobalAssets.onTab('market');
    }
  } catch (e) {
    console.error('[StockDashboard] 页面初始化失败：', e);
    try {
      if (STOCKS.length) applyFilter();
    } catch (renderError) {
      console.error('[StockDashboard] 基础列表渲染失败：', renderError);
    }
    showErrorDialog({
      time: new Date().toISOString(),
      type: '首页初始化异常',
      message: e && e.message ? e.message : String(e),
      stack: e && e.stack || '',
      page: location.href
    });
    showToast('页面初始化遇到问题，已尝试保留股票清单。');
  } finally {
    if (!keepLoadingMessage) setPageLoading('', true);
  }
})();
