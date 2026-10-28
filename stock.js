/*!
 * 股票详情页 —— stock.html 的页面逻辑
 * 依赖：quotes.js（行情 SDK）、lightweight-charts（K 线 / 分时）
 * 入口：stock.html?code=sz002408
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const RAW_CODE = params.get('code') || params.get('c') || '';
  const CODE = StockQuotes.normalizeCode(RAW_CODE);
  const CODE6 = CODE ? CODE.slice(2) : '';

  const quotes = new StockQuotes.Client({
    timeout: 6000,
    retries: 0,
    cacheTTL: 1500,
    onError: err => console.warn('[StockQuotes]', err.code, err.message)
  });

  let STOCKS = [];
  let PLAN = null;
  let DETAIL = null;
  let peersAt = 0;

  let chartTab = 'trend';
  let chart = null;
  let chartKey = '';
  let series = {};
  let timeLabels = new Map();
  const klineCache = {};
  let trendCache = null;

  let quoteTimer = null;
  let chartTimer = null;

  /* ────────────────────────── 格式化 ────────────────────────── */

  const isNum = v => typeof v === 'number' && isFinite(v);

  const fmtNum = (v, d = 2) => isNum(v) ? v.toFixed(d) : '—';

  const fmtPe = v => !isNum(v) ? '—' : v < 0 ? '亏损' : v.toFixed(2);

  const fmtPct = (v, d = 2) => isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}%` : '—';

  const fmtPctPlain = (v, d = 2) => isNum(v) ? `${v.toFixed(d)}%` : '—';

  const fmtVolume = v => {
    if (!isNum(v)) return '—';
    if (v >= 1e8) return (v / 1e8).toFixed(2) + '亿手';
    if (v >= 1e4) return (v / 1e4).toFixed(2) + '万手';
    return Math.round(v) + '手';
  };

  const fmtAmount = v => {
    if (!isNum(v)) return '—';
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return v.toFixed(0);
  };

  const fmtCap = v => isNum(v) ? (v / 1e8).toFixed(2) + '亿' : '—';

  const fmtDate = v => {
    const s = String(v || '');
    return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '—';
  };

  const toneClass = v => !isNum(v) || v === 0 ? 'text-body-secondary' : v > 0 ? 'text-up' : 'text-down';

  const signed = (v, text) => `<span class="${toneClass(v)}">${text}</span>`;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const median = arr => {
    const a = arr.filter(isNum).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };

  /** 限并发执行，单个失败记为 null，不影响整体 */
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length).fill(null);
    let cursor = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try { out[i] = await fn(items[i]); } catch (e) { out[i] = null; }
      }
    });
    await Promise.all(workers);
    return out;
  }

  /* ────────────────────────── 初始化 ────────────────────────── */

  function initTheme() {
    if (localStorage.getItem('stock-theme') === 'dark') {
      document.documentElement.setAttribute('data-bs-theme', 'dark');
      $('theme-btn').textContent = '☀️';
    }
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', next);
    $('theme-btn').textContent = next === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('stock-theme', next);
    rerenderChart();
  }

  function bindUI() {
    $('chart-tabs').addEventListener('click', e => {
      const btn = e.target.closest('button[data-tab]');
      if (btn) setTab(btn.dataset.tab);
    });

    $('state-form').addEventListener('submit', e => {
      e.preventDefault();
      const v = StockQuotes.normalizeCode($('code-input').value);
      if (!v) {
        showToast('请输入 6 位代码，如 002408');
        return;
      }
      location.href = 'stock.html?code=' + v;
    });
  }

  function tickSession() {
    if (StockQuotes.isTrading() && !quoteTimer) {
      scheduleRefresh();
    } else if (!StockQuotes.isTrading() && quoteTimer) {
      stopRefresh();
      loadQuote(false);   // 收取当日最后一次行情
    }
  }

  /* ────────────────────────── 数据加载 ────────────────────────── */

  async function loadPlan() {
    try {
      const res = await fetch('stocks.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      STOCKS = await res.json();
      PLAN = STOCKS.find(s => StockQuotes.normalizeCode(s.code) === CODE) || null;
    } catch (e) {
      console.warn('基础数据加载失败:', e);
      PLAN = null;
    }
  }

  async function loadQuote(force) {
    try {
      const d = await quotes.fetchDetail(CODE, { force: !!force });
      DETAIL = d;
      $('state-box').classList.add('d-none');
      $('content').classList.remove('d-none');
      renderAll();
      loadPeers();
      warmupDaily();
      return true;
    } catch (e) {
      console.warn('获取详情失败:', e);
      if (!DETAIL) {
        $('stock-name').textContent = CODE6;
        showState('行情获取失败', `无法获取 ${esc(CODE6)} 的行情数据：${esc(e.message || '接口不可用')}`, 'retry');
      } else {
        showToast('刷新失败：' + (e.message || '接口不可用'));
      }
      return false;
    }
  }

  async function refreshAll(manual) {
    if (!CODE) return;
    if (manual) spinRefresh();
    const ok = await loadQuote(manual);
    if (!ok) return;
    loadChart(chartTab, manual).catch(() => {});
    if (manual) showToast('数据已刷新', 'success');
  }

  /* ────────────────────────── 渲染：头部 / 行情 ────────────────────────── */

  function renderAll() {
    renderHeader();
    renderQuote(DETAIL);
    renderValuation(DETAIL);
    renderPlan(DETAIL);
  }

  function renderHeader() {
    const name = (DETAIL && DETAIL.name) || (PLAN && PLAN.name) || '加载中…';
    $('stock-name').textContent = name;
    document.title = (DETAIL && DETAIL.name ? `${DETAIL.name} ${CODE6}` : CODE6) + ' - 股票详情';

    const group = (PLAN && PLAN.group) || '';
    $('group-tag').textContent = group;
    $('group-tag').classList.toggle('d-none', !group);

    const alias = (PLAN && PLAN.alias) || '';
    $('alias-line').textContent = alias;
    $('alias-line').classList.toggle('d-none', !alias);
  }

  function renderQuote(d) {
    const tone = toneClass(d.todayChange);

    $('price').textContent = fmtNum(d.price);
    $('price').className = 'price-big ' + (d.todayChange ? tone : '');

    $('change-amount').textContent = isNum(d.change) ? `${d.change > 0 ? '+' : ''}${d.change.toFixed(2)}` : '—';
    $('change-amount').className = 'fw-semibold ' + tone;

    const badge = $('change-pct');
    badge.textContent = fmtPct(d.todayChange);
    badge.className = 'badge rounded-pill '
      + (d.todayChange > 0 ? 'text-bg-danger' : d.todayChange < 0 ? 'text-bg-success' : 'text-bg-secondary');

    // 不再显示「收盘」等常识性提示，行情时间即可
    const t = d.time ? new Date(d.time) : null;
    $('quote-time').textContent = t
      ? `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} `
        + `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
      : '--';

    $('stats').innerHTML = [
      ['今开', fmtNum(d.open)],
      ['最高', fmtNum(d.high)],
      ['最低', fmtNum(d.low)],
      ['昨收', fmtNum(d.prevClose)],
      ['均价', fmtNum(d.avg)],
      ['涨停', fmtNum(d.limitUp)],
      ['跌停', fmtNum(d.limitDown)],
      ['成交量', fmtVolume(d.volume)],
      ['成交额', fmtAmount(d.amount)],
      ['换手率', fmtPctPlain(d.turnover)],
      ['量比', fmtNum(d.volumeRatio)],
      ['振幅', fmtPctPlain(d.amplitude)]
    ].map(([k, v]) => statItem(k, v)).join('');
  }

  function statItem(label, value, extraClass) {
    return `<div class="stat-item">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${extraClass || ''}">${value}</div>
    </div>`;
  }

  /* ────────────────────────── 渲染：估值与周期位置 ────────────────────────── */

  function renderValuation(d) {
    const items = [
      ['市盈率(动)', fmtPe(d.pe)],
      ['市盈率(TTM)', fmtPe(d.peTtm)],
      ['市盈率(静)', fmtPe(d.peStatic)],
      ['市净率', fmtNum(d.pb)],
      ['每股净资产', fmtNum(d.navPerShare)],
      ['ROE', fmtPctPlain(d.roe)],
      ['毛利率', fmtPctPlain(d.grossMargin)],
      ['净利率', fmtPctPlain(d.netMargin)],
      ['营收同比', signed(d.revenueYoY, fmtPct(d.revenueYoY))],
      ['净利同比', signed(d.profitYoY, fmtPct(d.profitYoY))],
      ['营业收入', fmtAmount(d.revenue)],
      ['净利润', fmtAmount(d.profit)],
      ['总市值', fmtCap(d.totalCap)],
      ['上市日期', fmtDate(d.listedAt)]
    ];

    $('valuation-stats').innerHTML = items
      .map(([k, v]) => statItem(k, v))
      .join('');

    renderRange(d);
    renderInsightTags(d);
  }

  function renderRange(d) {
    const lo = isNum(d.low52) ? d.low52 : null;
    const hi = isNum(d.high52) ? d.high52 : null;
    const price = d.price;

    $('low52').textContent = lo == null ? '--' : lo.toFixed(2);
    $('high52').textContent = hi == null ? '--' : hi.toFixed(2);

    if (lo == null || hi == null || hi <= lo) {
      $('range-pin').style.left = '0%';
      $('range-label').textContent = '52 周区间数据缺失';
      $('range-low-dist').textContent = '--';
      $('range-high-dist').textContent = '--';
      return;
    }

    const pos = Math.min(100, Math.max(0, (price - lo) / (hi - lo) * 100));
    $('range-pin').style.left = pos + '%';

    const zone = pos < 25 ? '低位区' : pos > 75 ? '高位区' : '中枢区';
    $('range-label').textContent = `分位 ${pos.toFixed(0)}% · ${zone}`;

    const toLow = (price / lo - 1) * 100;
    const toHigh = (price / hi - 1) * 100;
    $('range-low-dist').textContent = `距低点 ${fmtPct(toLow)}`;
    $('range-high-dist').textContent = `距高点 ${fmtPct(toHigh)}`;
  }

  function renderInsightTags(d) {
    const tags = [];
    const pos = (isNum(d.low52) && isNum(d.high52) && d.high52 > d.low52)
      ? (d.price - d.low52) / (d.high52 - d.low52) * 100
      : null;

    if (isNum(d.pb) && d.pb < 1) tags.push(['破净', 'calm']);
    if (isNum(d.peTtm) && d.peTtm < 0) tags.push(['TTM 亏损', 'warn']);
    if (pos != null) {
      if (pos <= 25) tags.push(['52 周低位', 'calm']);
      else if (pos >= 75) tags.push(['52 周高位', 'warn']);
    }

    if (PLAN) {
      if (isNum(PLAN.tp2) && d.price >= PLAN.tp2) tags.push(['已达止盈2', 'warn']);
      else if (isNum(PLAN.tp1) && d.price >= PLAN.tp1) tags.push(['已达止盈1', 'warn']);

      if (isNum(PLAN.heavy) && d.price <= PLAN.heavy) tags.push(['低于重仓价', 'calm']);
      else if (isNum(PLAN.entry) && d.price <= PLAN.entry) tags.push(['低于入场价', 'calm']);
    }

    $('insight-tags').innerHTML = tags.length
      ? tags.slice(0, 5).map(([text, tone]) => `<span class="insight-tag ${tone}">${esc(text)}</span>`).join('')
      : '<span class="text-body-secondary" style="font-size:11px">暂无明显关注点</span>';
  }

  async function loadPeers() {
    if (Date.now() - peersAt < 5 * 60 * 1000) return;
    if (!PLAN || !PLAN.group) {
      $('peer-summary').textContent = '该股票未分组，暂无同组数据';
      return;
    }
    peersAt = Date.now();
    $('peer-summary').textContent = '统计中…';

    const codes = STOCKS
      .filter(s => s.group === PLAN.group && StockQuotes.normalizeCode(s.code) !== CODE)
      .map(s => s.code)
      .filter(Boolean);

    if (!codes.length) {
      $('peer-summary').textContent = '同组暂无其他标的';
      return;
    }

    // 限并发，避免同组十几只一次性打满接口
    const results = await mapLimit(codes, 4, c => quotes.fetchDetail(c));
    const details = results.filter(Boolean);

    if (!details.length) {
      $('peer-summary').textContent = '同组行情暂不可用';
      return;
    }

    const peList = details.map(x => x.peTtm).filter(v => isNum(v) && v > 0);
    const pbList = details.map(x => x.pb).filter(v => isNum(v) && v > 0);
    const peMed = median(peList);
    const pbMed = median(pbList);

    const parts = [`组内 ${details.length + 1} 只`];

    const cmp = (own, med, label, unit) => {
      if (med == null) return `${label} 中位数 —`;
      const base = `${label} 中位数 ${med.toFixed(2)}${unit}`;
      if (!isNum(own) || own <= 0) return `${base}（本股不参与）`;
      const diff = (own - med) / med * 100;
      const word = diff > 0 ? '溢价' : '折价';
      return `${base}（本股 ${own.toFixed(2)}${unit}，${word} ${Math.abs(diff).toFixed(0)}%）`;
    };

    parts.push(cmp(DETAIL.peTtm, peMed, 'PE(TTM)', ''));
    parts.push(cmp(DETAIL.pb, pbMed, 'PB', ''));

    $('peer-summary').innerHTML = parts.map(p => `<span class="me-2">${esc(p)}</span>`).join('');
  }

  /** 预取日 K，并在详情源缺少 52 周高低时用日 K 补算（同时加速「日K」标签切换） */
  async function warmupDaily() {
    if (klineCache.day) return;
    try {
      klineCache.day = await quotes.fetchKline(CODE, { period: 'day', count: 250, adjust: 'qfq' });
      apply52WeekFallback(klineCache.day.bars);
    } catch (e) {
      /* 日 K 失败不影响主流程 */
    }
  }

  function apply52WeekFallback(bars) {
    if (!DETAIL || !bars || !bars.length) return;
    if (isNum(DETAIL.high52) && isNum(DETAIL.low52)) return;

    let hi = -Infinity;
    let lo = Infinity;
    bars.slice(-250).forEach(b => {
      if (isNum(b.high)) hi = Math.max(hi, b.high);
      if (isNum(b.low)) lo = Math.min(lo, b.low);
    });
    if (!isFinite(hi) || !isFinite(lo) || hi <= lo) return;

    DETAIL.high52 = hi;
    DETAIL.low52 = lo;
    renderRange(DETAIL);
    renderInsightTags(DETAIL);
  }

  /* ────────────────────────── 渲染：跟踪计划 ────────────────────────── */

  function levelColor(key) {
    return {
      heavy: 'var(--down)',
      entry: 'var(--bs-primary)',
      tp1: '#f59e0b',
      tp2: '#8b5cf6'
    }[key] || 'var(--bs-secondary-color)';
  }

  function renderPlan(d) {
    if (!PLAN) {
      $('plan-note').classList.remove('d-none');
      $('plan-body').classList.add('d-none');
      return;
    }
    $('plan-note').classList.add('d-none');
    $('plan-body').classList.remove('d-none');

    const price = d.price;
    const levels = [
      { key: 'heavy', label: '重仓', value: PLAN.heavy },
      { key: 'entry', label: '入场', value: PLAN.entry },
      { key: 'tp1', label: '止盈1', value: PLAN.tp1 },
      { key: 'tp2', label: '止盈2', value: PLAN.tp2 }
    ];
    const valid = levels.filter(l => isNum(l.value) && l.value > 0);

    // 刻度条
    const vals = valid.map(l => l.value).concat(price);
    const lo = Math.min.apply(null, vals);
    const hi = Math.max.apply(null, vals);
    const span = hi - lo || Math.max(hi * 0.02, 0.01);
    const posOf = v => ((v - lo) / span) * 100;

    let zoneHtml = '';
    if (isNum(PLAN.heavy) && isNum(PLAN.entry)) {
      const a = posOf(Math.min(PLAN.heavy, PLAN.entry));
      const b = posOf(Math.max(PLAN.heavy, PLAN.entry));
      zoneHtml = `<div class="ruler-zone" style="left:${a}%;width:${b - a}%"></div>`;
    }

    const ticks = valid.map(l =>
      `<span class="ruler-tick" style="left:${posOf(l.value)}%;background:${levelColor(l.key)}" `
      + `title="${l.label} ${l.value}"></span>`
    ).join('');

    $('ruler-track').innerHTML = zoneHtml + ticks
      + `<span class="ruler-tick is-current" style="left:${posOf(price)}%" title="现价 ${fmtNum(price)}"></span>`;

    $('ruler-legend').innerHTML = valid.map(l =>
      `<span><span class="pip" style="background:${levelColor(l.key)}"></span>${l.label} `
      + `<span class="text-body">${fmtNum(l.value)}</span></span>`
    ).join('')
      + `<span><span class="pip" style="background:${price >= (PLAN.entry || price) ? 'var(--up)' : 'var(--down)'}"></span>现价 `
      + `<span class="text-body">${fmtNum(price)}</span></span>`;

    // 明细表
    $('plan-rows').innerHTML = levels.map(l => {
      if (!isNum(l.value) || l.value <= 0) {
        return `<tr>
          <td class="text-body-secondary">${l.label}</td>
          <td class="text-end text-body-tertiary">未设置</td>
          <td class="text-end text-body-tertiary">—</td>
          <td class="text-end text-body-tertiary">—</td>
        </tr>`;
      }

      const diff = (l.value - price) / price * 100;
      const dir = diff > 0 ? '上方' : diff < 0 ? '下方' : '持平';
      const diffHtml = diff === 0
        ? '<span class="text-body-secondary">持平</span>'
        : `<span class="text-body-secondary">${dir} ${Math.abs(diff).toFixed(2)}%</span>`;

      return `<tr>
        <td class="text-body-secondary">${l.label}</td>
        <td class="text-end fw-semibold">${fmtNum(l.value)}</td>
        <td class="text-end">${diffHtml}</td>
        <td class="text-end">${statusBadge(l.key, l.value, price)}</td>
      </tr>`;
    }).join('');

    // 计划附加信息
    const ytd = isNum(PLAN.yearInit) && PLAN.yearInit > 0 ? (price / PLAN.yearInit - 1) * 100 : null;
    $('plan-meta').innerHTML = [
      ['年初价', fmtNum(PLAN.yearInit)],
      ['年初至今', signed(ytd, fmtPct(ytd))],
      ['昨日涨幅', signed(PLAN.prevChg, fmtPct(PLAN.prevChg))],
      ['分组', esc(PLAN.group || '—')],
      ['更新日期', esc(PLAN.updDate || '—')],
      ['别名', esc(PLAN.alias || '—')]
    ].map(([k, v]) => statItem(k, v)).join('');
  }

  function statusBadge(key, value, price) {
    if (key === 'heavy') {
      return price <= value
        ? '<span class="badge text-bg-success">已到重仓区</span>'
        : '<span class="badge text-bg-secondary">未到</span>';
    }
    if (key === 'entry') {
      return price <= value
        ? '<span class="badge text-bg-success">低于入场</span>'
        : '<span class="badge text-bg-secondary">高于入场</span>';
    }
    return price >= value
      ? `<span class="badge ${key === 'tp1' ? 'text-bg-warning' : 'text-bg-primary'}">已达成</span>`
      : '<span class="text-body-secondary">未达成</span>';
  }

  /* ────────────────────────── 图表 ────────────────────────── */

  function destroyChart() {
    if (chart) chart.remove();
    chart = null;
    chartKey = '';
    series = {};
    timeLabels = new Map();
  }

  function createChart(extra) {
    destroyChart();
    const text = cssVar('--bs-body-color') || '#212529';
    const border = cssVar('--bs-border-color') || '#dee2e6';

    chart = LightweightCharts.createChart($('chart'), Object.assign({
      autoSize: true,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: text,
        fontSize: 11,
        fontFamily: 'inherit'
      },
      grid: {
        vertLines: { color: border },
        horzLines: { color: border }
      },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border, rightOffset: 2, barSpacing: 5 },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { labelBackgroundColor: '#1d4ed8' },
        horzLine: { labelBackgroundColor: '#1d4ed8' }
      },
      localization: { priceFormatter: v => Number(v).toFixed(2) }
    }, extra || {}));
    return chart;
  }

  function setTab(tab) {
    if (chartTab === tab) return;
    chartTab = tab;
    Array.from($('chart-tabs').children).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    loadChart(tab, false).catch(() => {});
    scheduleChartRefresh();
  }

  async function loadChart(tab, force) {
    if (!CODE) return;

    $('chart-hint').textContent = tab === 'trend' ? '分时 · 含均价线' : '前复权 · 200 根';

    const cached = tab === 'trend' ? trendCache : klineCache[tab];
    if (!cached) {
      $('chart-empty').textContent = '图表加载中…';
      $('chart-empty').classList.remove('d-none');
    }

    try {
      if (tab === 'trend') {
        if (force || !trendCache) {
          trendCache = await quotes.fetchTrends(CODE, { force: !!force });
        }
        renderTrend(trendCache);
      } else {
        if (force || !klineCache[tab]) {
          klineCache[tab] = await quotes.fetchKline(CODE, {
            period: tab,
            count: 200,
            adjust: 'qfq',
            force: !!force
          });
        }
        renderKline(klineCache[tab], tab);
      }
      $('chart-empty').classList.add('d-none');
    } catch (e) {
      console.warn('图表加载失败:', e);
      $('chart-empty').textContent = '图表加载失败：' + (e.message || '接口不可用');
      $('chart-empty').classList.remove('d-none');
      throw e;
    }
  }

  function renderTrend(data) {
    const points = (data.points || []).filter(p => isNum(p.price) && p.price > 0);
    if (!points.length) throw new Error('暂无分时数据');

    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(points[0].time || '');
    const base = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 : Math.floor(Date.now() / 1000);
    const key = 'trend:' + base;

    const labels = new Map();
    const priceData = [];
    const avgData = [];

    points.forEach((p, i) => {
      const t = base + i * 60;
      const clock = p.time && p.time.length >= 16 ? p.time.slice(11, 16) : '';
      labels.set(t, clock);
      priceData.push({ time: t, value: p.price });
      if (isNum(p.avg) && p.avg > 0) avgData.push({ time: t, value: p.avg });
    });

    const isNew = !chart || chartKey !== key;
    if (isNew) {
      const border = cssVar('--bs-border-color') || '#dee2e6';
      const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
      createChart({
        timeScale: {
          borderColor: border,
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 2,
          barSpacing: 4,
          tickMarkFormatter: t => timeLabels.get(t) || ''
        },
        localization: {
          priceFormatter: v => Number(v).toFixed(2),
          timeFormatter: t => timeLabels.get(t) || ''
        }
      });
      chartKey = key;
      // createChart 内部会重置 timeLabels，必须在建图之后再赋值
      timeLabels = labels;
      series.main = chart.addAreaSeries({
        lineColor: dark ? '#60a5fa' : '#2563eb',
        topColor: dark ? 'rgba(96,165,250,.25)' : 'rgba(37,99,235,.22)',
        bottomColor: 'rgba(37,99,235,0)',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerRadius: 3
      });
      series.avg = chart.addLineSeries({
        color: '#f59e0b',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      });
    } else {
      timeLabels = labels;
    }

    series.main.setData(priceData);
    series.avg.setData(avgData);

    if (series.preCloseLine) {
      series.main.removePriceLine(series.preCloseLine);
      series.preCloseLine = null;
    }
    if (isNum(data.preClose)) {
      series.preCloseLine = series.main.createPriceLine({
        price: data.preClose,
        color: cssVar('--bs-secondary-color') || '#6c757d',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '昨收'
      });
    }

    if (isNew) {
      chart.timeScale().fitContent();
      // 左侧留白，避免首个时间标签被裁掉（如 09:30 显示成 -30）
      chart.timeScale().setVisibleLogicalRange({ from: -12, to: priceData.length + 2 });
    }
  }

  function renderKline(result, period) {
    const bars = (result.bars || []).filter(b =>
      isNum(b.open) && isNum(b.close) && isNum(b.high) && isNum(b.low));
    if (!bars.length) throw new Error('暂无 K 线数据');

    const key = 'kline:' + period;
    const up = cssVar('--up') || '#dc2626';
    const down = cssVar('--down') || '#16a34a';
    const isNew = !chart || chartKey !== key;

    if (isNew) {
      createChart({
        timeScale: {
          borderColor: cssVar('--bs-border-color') || '#dee2e6',
          timeVisible: false,
          rightOffset: 3,
          barSpacing: 6
        }
      });
      chartKey = key;
      series.candles = chart.addCandlestickSeries({
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
        priceLineVisible: true,
        lastValueVisible: true
      });
      series.vol = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
        priceLineVisible: false,
        lastValueVisible: false
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0.02 } });
    }

    series.candles.setData(bars.map(b => ({
      time: b.time,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close
    })));
    series.vol.setData(bars.map(b => ({
      time: b.time,
      value: b.volume || 0,
      color: b.close >= b.open ? rgba(up, .35) : rgba(down, .35)
    })));

    if (isNew) {
      chart.timeScale().fitContent();
      chart.timeScale().setVisibleLogicalRange({ from: -8, to: bars.length + 2 });
    }
  }

  function rgba(hex, alpha) {
    const s = String(hex).replace('#', '');
    const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function rerenderChart() {
    destroyChart();
    if (chartTab === 'trend' && trendCache) {
      try { renderTrend(trendCache); } catch (e) { /* ignore */ }
    } else if (klineCache[chartTab]) {
      try { renderKline(klineCache[chartTab], chartTab); } catch (e) { /* ignore */ }
    } else {
      loadChart(chartTab, false).catch(() => {});
    }
  }

  /* ────────────────────────── 刷新调度 ────────────────────────── */

  function scheduleRefresh() {
    stopRefresh();
    if (!StockQuotes.isTrading()) return;

    quoteTimer = setInterval(() => {
      if (!StockQuotes.isTrading()) return;
      loadQuote(true);
    }, StockQuotes.REFRESH_INTERVAL);

    scheduleChartRefresh();
  }

  function scheduleChartRefresh() {
    clearInterval(chartTimer);
    chartTimer = null;
    if (!StockQuotes.isTrading()) return;

    const ms = chartTab === 'trend' ? 30000 : 60000;
    chartTimer = setInterval(() => {
      if (!StockQuotes.isTrading()) return;
      loadChart(chartTab, true).catch(() => {});
    }, ms);
  }

  function stopRefresh() {
    clearInterval(quoteTimer);
    clearInterval(chartTimer);
    quoteTimer = null;
    chartTimer = null;
  }

  /* ────────────────────────── 状态 / 提示 ────────────────────────── */

  function showState(title, desc, mode) {
    $('state-box').classList.remove('d-none');
    $('content').classList.add('d-none');
    $('state-title').textContent = title;
    $('state-desc').innerHTML = desc;

    const form = $('state-form');
    form.classList.toggle('d-none', mode !== 'form');
    form.classList.toggle('d-flex', mode === 'form');

    const actions = $('state-actions');
    actions.classList.toggle('d-none', mode !== 'retry');
    actions.classList.toggle('d-flex', mode === 'retry');
  }

  function showToast(msg, type) {
    const t = $('toast');
    t.className = 'alert position-fixed bottom-0 start-50 translate-middle-x mb-3 py-2 px-3 small shadow '
      + (type === 'success' ? 'alert-success' : 'alert-danger') + ' d-block';
    t.textContent = msg;
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.add('d-none'), 2400);
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

  /* ────────────────────────── 启动 ────────────────────────── */

  window.refreshAll = refreshAll;
  window.toggleTheme = toggleTheme;

  (async function init() {
    initTheme();
    bindUI();

    setInterval(tickSession, 10000);

    if (!CODE) {
      $('stock-name').textContent = '股票详情';
      $('stock-code').classList.add('d-none');
      document.title = '股票详情';
      if (RAW_CODE) {
        showState('股票代码无效',
          `「${esc(RAW_CODE)}」不是有效的 A 股代码，请输入 6 位数字，如 <code>002408</code>。`, 'form');
      } else {
        showState('未指定股票代码',
          '在网址后加上 <code>?code=sz002408</code>，或在下方输入代码。', 'form');
      }
      return;
    }

    $('stock-code').textContent = CODE6;
    document.title = `${CODE6} - 股票详情`;
    showState('加载中…', `${CODE6} 行情获取中，请稍候`, 'none');

    await loadPlan();
    renderHeader();

    await refreshAll(false);
    scheduleRefresh();
  })();
})();
