/*!
 * 股票详情页 —— stock.html 的页面逻辑
 * 依赖：quotes.js（行情 SDK）、lightweight-charts（日/月 K）
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
  let historyAt = 0;
  let HISTORY = null;

  let MIN15 = null;
  let MIN15At = 0;
  let MIN15Failed = false;
  let TRENDS = null;
  let TRENDSAt = 0;
  let DAY_FAILED = false;

  /* 做T / 补仓 判定阈值（集中调参） */
  const T_RULES = {
    vwapDev: 1.0,      // 偏离 VWAP 多少 % 算低吸 / 高抛
    mfiLow: 25,        // 15 分 MFI 低吸
    mfiHigh: 75,       // 15 分 MFI 高抛
    volSurge: 1.3,     // 近 3 根 / 前 12 根 均量，放量阈值
    volShrink: 1.0,    // 低于该量比算缩量
    trendDev: 2.5,     // 偏离超过多少 % 且放量 -> 单边
    spread: 2,         // 默认 T 差价目标 %
    stall: 0.5,        // 近 3 根涨跌幅多少 % 以内算滞涨
    minuteTTL: 3 * 60 * 1000
  };

  const ADD_RULES = {
    supportDist: 3,    // 距支撑多少 % 以内算到支撑
    mfiLow: 20,        // MFI < 20 后回升上穿
    mfiRecoverBars: 10,
    maPeriod: 20,
    obvLookback: 20,
    profileLookback: 120
  };

  let chartTab = 'day';
  let chart = null;
  let chartKey = '';
  let series = {};
  const klineCache = {};

  let quoteTimer = null;
  let chartTimer = null;

  /* ────────────────────────── 格式化 ────────────────────────── */

  const isNum = v => typeof v === 'number' && isFinite(v);

  const fmtNum = (v, d = 2) => isNum(v) ? v.toFixed(d) : '—';

  const fmtPe = v => !isNum(v) ? '—' : v < 0 ? '亏损' : v.toFixed(2);

  const fmtPct = (v, d = 2) => isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(d)}%` : '—';

  const fmtPctPlain = (v, d = 2) => isNum(v) ? `${v.toFixed(d)}%` : '—';

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

  const fmtYi = v => isNum(v) ? (v / 1e8).toFixed(2) + '亿' : '—';

  const costKey = () => 'croc-cost:' + CODE;
  const calcKey = () => 'croc-valuation:' + CODE;

  function readCost() {
    try {
      const v = Number(localStorage.getItem(costKey()));
      return isFinite(v) && v > 0 ? v : null;
    } catch (e) { return null; }
  }

  function historyStats() {
    if (!HISTORY || !Array.isArray(HISTORY.bars) || !HISTORY.bars.length || !DETAIL) return null;
    const bars = HISTORY.bars;
    const closes = bars.map(b => b.close).filter(isNum);
    const lows = bars.map(b => b.low).filter(isNum);
    const highs = bars.map(b => b.high).filter(isNum);
    if (!closes.length || !lows.length || !highs.length) return null;
    const lo = Math.min.apply(null, lows);
    const hi = Math.max.apply(null, highs);
    if (!(hi > lo)) return null;
    return {
      lo, hi,
      count: bars.length,
      pos: Croc.percentile(closes, DETAIL.price)
    };
  }

  /* ────────────────────────── 初始化 ────────────────────────── */

  function initTheme() {
    if (localStorage.getItem('stock-theme') === 'dark') {
      document.documentElement.setAttribute('data-bs-theme', 'dark');
      const themeBtn = $('theme-btn');
      if (themeBtn && !themeBtn.classList.contains('q-btn')) themeBtn.textContent = '☀️';
    }
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', next);
    const themeBtn = $('theme-btn');
    if (themeBtn && !themeBtn.classList.contains('q-btn')) {
      themeBtn.textContent = next === 'dark' ? '☀️' : '🌙';
    }
    localStorage.setItem('stock-theme', next);
    if (window.__stockQuasarSetDark) window.__stockQuasarSetDark(next === 'dark');
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
      warmupHistory();
      warmupTrends();
      warmupMinute();
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
    if (manual) {
      warmupTrends(true);
      warmupMinute(true);
    }
    loadChart(chartTab, manual).catch(() => {});
    if (manual) showToast('数据已刷新', 'success');
  }

  /* ────────────────────────── 渲染：头部 / 行情 ────────────────────────── */

  function renderAll() {
    renderHeader();
    renderQuote(DETAIL);
    renderValuation(DETAIL);
    renderPlan(DETAIL);
    renderT(DETAIL);
    renderAdd(DETAIL);
    renderDiscipline(DETAIL);
    updateCalc();
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

    // 只看中期：不展示今开/最高/最低/均价/涨停/跌停/量比/振幅等日内指标
    $('stats').innerHTML = [
      ['昨收', fmtNum(d.prevClose)],
      ['成交额', fmtAmount(d.amount)],
      ['换手率', fmtPctPlain(d.turnover)]
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
    renderHistoryRange();
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

  function renderHistoryRange() {
    const st = historyStats();
    if (!st) {
      $('hist-label').textContent = HISTORY ? '历史分位数据不足' : '历史分位加载中…';
      $('hist-low').textContent = '--';
      $('hist-high').textContent = '--';
      $('hist-pin').style.left = '0%';
      $('hist-low-dist').textContent = '--';
      $('hist-high-dist').textContent = '--';
      return;
    }

    const price = DETAIL.price;
    $('hist-low').textContent = st.lo.toFixed(2);
    $('hist-high').textContent = st.hi.toFixed(2);

    // 价位条按历史低—高区间定位；同时给出收盘价分位，避免两个口径混淆
    const rangePin = Math.min(100, Math.max(0, (price - st.lo) / (st.hi - st.lo) * 100));
    $('hist-pin').style.left = rangePin + '%';

    const pos = st.pos;
    const zone = pos == null ? '—' : pos < 25 ? '低位区' : pos > 75 ? '高位区' : '中枢区';
    $('hist-label').textContent = pos == null
      ? `月K ${st.count} 根`
      : `月K分位 ${pos.toFixed(0)}% · ${zone}（区间 ${rangePin.toFixed(0)}%）`;

    $('hist-low-dist').textContent = `距历史低点 ${fmtPct((price / st.lo - 1) * 100)}`;
    $('hist-high-dist').textContent = `距历史高点 ${fmtPct((price / st.hi - 1) * 100)}`;
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
    if (klineCache.day) {
      renderDiscipline(DETAIL);
      renderAdd(DETAIL);
      return;
    }
    try {
      // 趋势/均线使用前复权 K；涨停幅度和涨停价必须使用未复权 K。
      const [adjusted, raw] = await Promise.allSettled([
        quotes.fetchKline(CODE, { period: 'day', count: 250, adjust: 'qfq' }),
        quotes.fetchKline(CODE, { period: 'day', count: 250, adjust: 'none' })
      ]);
      if (raw.status === 'fulfilled') klineCache.dayRaw = raw.value;
      if (adjusted.status !== 'fulfilled') throw adjusted.reason;

      klineCache.day = adjusted.value;
      DAY_FAILED = false;
      apply52WeekFallback(klineCache.day.bars);
      renderDiscipline(DETAIL);
      renderAdd(DETAIL);
    } catch (e) {
      /* 日 K 失败不影响主流程 */
      DAY_FAILED = true;
      renderAdd(DETAIL);
    }
  }

  /** 预取月 K，用于「历史分位」和长周期位置判断 */
  async function warmupHistory() {
    if (HISTORY && Date.now() - historyAt < 30 * 60 * 1000) return;
    try {
      const res = await quotes.fetchKline(CODE, { period: 'month', count: 240, adjust: 'qfq' });
      HISTORY = res;
      historyAt = Date.now();
      renderHistoryRange();
      renderDiscipline(DETAIL);
    } catch (e) {
      /* 月 K 失败不影响主流程 */
      HISTORY = { bars: [] };
      renderHistoryRange();
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

  /* ────────────────────────── 做T / 补仓数据 ────────────────────────── */

  function dayBars() {
    return klineCache.day && Array.isArray(klineCache.day.bars) ? klineCache.day.bars : [];
  }

  function minuteBars() {
    return MIN15 && Array.isArray(MIN15.bars) ? MIN15.bars : [];
  }

  const todayStr = () => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };

  const isStale = time => String(time || '').slice(0, 10) !== todayStr();

  /** 当日 VWAP：优先分时均价，其次分时累计成交额/量，最后详情均价 */
  function vwapOf(detail, trends) {
    const points = trends && Array.isArray(trends.points) ? trends.points : [];
    if (points.length) {
      const last = points[points.length - 1];
      if (isNum(last.avg) && last.avg > 0) {
        return { value: last.avg, source: '分时均价', time: last.time, stale: isStale(last.time) };
      }
      let amount = 0;
      let pv = 0;
      let vol = 0;
      for (const p of points) {
        const v = isNum(p.volume) ? p.volume : 0;
        if (isNum(p.amount) && p.amount > 0 && v > 0) {
          amount += p.amount;
          vol += v;
        } else if (isNum(p.price) && v > 0) {
          pv += p.price * v;
          vol += v;
        }
      }
      if (amount > 0 && vol > 0) {
        // 东财 amount 为元、volume 为手
        return { value: amount / (vol * 100), source: '分时成交额', time: last.time, stale: isStale(last.time) };
      }
      if (pv > 0 && vol > 0) {
        return { value: pv / vol, source: '分时加权', time: last.time, stale: isStale(last.time) };
      }
    }
    if (detail && isNum(detail.avg) && detail.avg > 0) {
      return { value: detail.avg, source: '当日均价', time: null, stale: false };
    }
    return null;
  }

  async function warmupTrends(force) {
    if (!CODE) return;
    if (!force && TRENDS && Date.now() - TRENDSAt < 50 * 1000) return;
    try {
      TRENDS = await quotes.fetchTrends(CODE, { days: 1, force: !!force });
      TRENDSAt = Date.now();
    } catch (e) {
      /* 分时失败时用详情均价兜底 */
    }
    renderT(DETAIL);
  }

  async function warmupMinute(force) {
    if (!CODE) return;
    if (!force && MIN15 && Date.now() - MIN15At < T_RULES.minuteTTL) return;
    try {
      MIN15 = await quotes.fetchMinuteKline(CODE, { period: '15', count: 320, force: !!force });
      MIN15At = Date.now();
      MIN15Failed = false;
    } catch (e) {
      /* 分钟 K 失败不影响主流程 */
      MIN15Failed = true;
    }
    renderT(DETAIL);
  }

  /** 近 3 根是否放量滞涨 */
  function recentStall(bars, pct) {
    if (!bars || bars.length < 5) return false;
    const last = bars[bars.length - 1];
    const ref = bars[bars.length - 4];
    if (!last || !ref || !isNum(last.close) || !isNum(ref.close) || !(ref.close > 0)) return false;
    return Math.abs((last.close / ref.close - 1) * 100) <= pct;
  }

  function badge(el, text, cls) {
    el.textContent = text;
    el.className = 'badge rounded-pill ' + cls;
  }

  function renderT(d) {
    if (!d || typeof TechInd === 'undefined') return;
    const price = d.price;
    const bars = minuteBars();
    const vw = vwapOf(d, TRENDS);
    const mfiRes = bars.length >= 16 ? TechInd.mfi(bars, 14) : null;
    const mfi = mfiRes ? mfiRes.latest : null;
    const vr = bars.length >= 15 ? TechInd.volumeRatio(bars, 3, 12) : null;
    const dev = vw && isNum(price) ? (price / vw.value - 1) * 100 : null;
    const surge = vr !== null && vr >= T_RULES.volSurge;
    const shrink = vr !== null && vr < T_RULES.volShrink;
    const single = dev !== null && Math.abs(dev) > T_RULES.trendDev && surge;
    const stall = recentStall(bars, T_RULES.stall);

    const buy = dev !== null && dev <= -T_RULES.vwapDev
      && mfi !== null && mfi < T_RULES.mfiLow && shrink;
    const sell = dev !== null && dev >= T_RULES.vwapDev
      && mfi !== null && mfi > T_RULES.mfiHigh && surge && stall;

    let text = '观望';
    let tone = 'text-bg-secondary';
    if (!bars.length && !vw) text = '加载中…';
    else if (!bars.length) text = MIN15Failed ? '分钟K 不可用' : '分钟数据不足';
    else if (single) { text = '单边 · 不逆势做T'; tone = 'text-bg-warning'; }
    else if (buy) { text = '正T 买点'; tone = 'text-bg-success'; }
    else if (sell) { text = 'T 卖点'; tone = 'text-bg-warning'; }
    else if (dev !== null && Math.abs(dev) > T_RULES.trendDev) { text = '单边，观望'; tone = 'text-bg-warning'; }
    else if (dev !== null && Math.abs(dev) < 0.5) text = '贴近均价，等偏离';
    badge($('t-badge'), text, tone);

    const checks = [];

    if (dev === null) {
      checks.push(checkItem('neutral', 'VWAP 偏离', '—', '分时 / 均价数据加载中…'));
    } else {
      const t = dev <= -T_RULES.vwapDev ? 'ok' : dev >= T_RULES.vwapDev ? 'warn' : 'neutral';
      const note = dev <= -T_RULES.vwapDev ? '现价低于均价，正T低吸区'
        : dev >= T_RULES.vwapDev ? '现价高于均价，倒T高抛区' : '围绕均价震荡';
      checks.push(checkItem(t, 'VWAP 偏离', `${fmtPct(dev)} · 均价 ${fmtNum(vw.value)}`, note));
    }

    const mfiTone = mfi === null ? 'neutral' : mfi < T_RULES.mfiLow ? 'ok' : mfi > T_RULES.mfiHigh ? 'warn' : 'neutral';
    const mfiNote = mfi === null ? '15 分 K 数据不足'
      : mfi < T_RULES.mfiLow ? `低于 ${T_RULES.mfiLow}，超卖`
        : mfi > T_RULES.mfiHigh ? `高于 ${T_RULES.mfiHigh}，超买` : '中性区间';
    checks.push(checkItem(mfiTone, '15 分 MFI', mfi === null ? '—' : mfi.toFixed(1), mfiNote));

    checks.push(checkItem(
      surge ? 'warn' : shrink ? 'ok' : 'neutral',
      '量能（3/12）',
      vr === null ? '—' : `${vr.toFixed(2)}×`,
      vr === null ? '分钟 K 数据不足' : surge ? '放量，追单需谨慎' : shrink ? '缩量，利于低吸' : '量能平稳'
    ));

    checks.push(checkItem(
      dev === null ? 'neutral' : single ? 'bad' : 'ok',
      '单边过滤',
      dev === null ? '—' : `${fmtPct(dev)} · ${surge ? '放量' : '正常量'}`,
      single ? '单边行情，不逆势做T' : '未触发单边过滤'
    ));

    $('t-checks').innerHTML = checks.join('');

    $('t-stats').innerHTML = [
      ['现价', fmtNum(price)],
      ['VWAP', vw ? fmtNum(vw.value) : '—'],
      ['偏离均价', fmtPct(dev)],
      ['15分 MFI', mfi === null ? '—' : mfi.toFixed(1)],
      ['量比 3/12', vr === null ? '—' : vr.toFixed(2) + '×'],
      ['分钟K样本', bars.length ? `${bars.length} 根` : '—']
    ].map(([k, v]) => statItem(k, v)).join('');

    if (!vw) {
      $('t-ref').innerHTML = '<span class="text-body-secondary">均价数据加载中…</span>';
    } else {
      const lowBuy = vw.value * (1 - T_RULES.vwapDev / 100);
      const highSell = vw.value * (1 + T_RULES.vwapDev / 100);
      const target = lowBuy * (1 + T_RULES.spread / 100);
      const sessionNote = !StockQuotes.isTrading()
        ? `${vw.stale ? '非交易时段 · 上一交易日' : '非交易时段 · 最近交易日'}${vw.time ? ' ' + String(vw.time).slice(0, 16) : ''}`
        : `均价来源：${vw.source}`;
      const sampleNote = bars.length
        ? `样本 ${bars.length} 根（约 20 个交易日）`
        : '分钟 K 数据不足';
      $('t-ref').innerHTML = `
        <div class="sell-line">正T：均价下 ${T_RULES.vwapDev}% 低吸 <b>${fmtNum(lowBuy)}</b>
          → 回到均价 <b>${fmtNum(vw.value)}</b> 卖出 · 差价目标 ${T_RULES.spread}%（<b>${fmtNum(target)}</b>）</div>
        <div class="sell-line">倒T：均价上 ${T_RULES.vwapDev}% 高抛 <b>${fmtNum(highSell)}</b>
          → 回落接回，不等当日新低</div>
        <div class="sell-line text-body-secondary">${esc(sessionNote)} · ${esc(sampleNote)}</div>`;
    }

    $('t-note').textContent = `15 分 K · ${bars.length || '—'} 根`
      + (vw && vw.stale ? ' · 上一交易日' : '')
      + (MIN15Failed ? ' · 获取失败' : '');
  }

  /** MFI < 20 后回升上穿 20 */
  function mfiRecovery(series) {
    const vals = Array.isArray(series) ? series : [];
    const n = vals.length;
    if (n < 3) return null;
    const latest = vals[n - 1];
    if (!isNum(latest) || latest < ADD_RULES.mfiLow) return null;

    const from = Math.max(0, n - 1 - ADD_RULES.mfiRecoverBars);
    for (let i = n - 2; i >= from; i--) {
      if (isNum(vals[i]) && vals[i] < ADD_RULES.mfiLow) {
        return { barsAgo: n - 1 - i, low: vals[i], latest };
      }
    }
    return null;
  }

  /** 距 POC / 价值区下沿 / 重仓价的最近支撑 */
  function nearestSupport(price, profile, plan) {
    if (!isNum(price) || price <= 0) return null;
    const cands = [];
    if (profile) {
      if (isNum(profile.poc)) cands.push({ label: 'POC', value: profile.poc });
      if (isNum(profile.val)) cands.push({ label: '价值区下沿', value: profile.val });
    }
    if (plan && isNum(plan.heavy) && plan.heavy > 0) {
      cands.push({ label: '重仓价', value: plan.heavy });
    }
    let best = null;
    for (const c of cands) {
      if (!(c.value > 0)) continue;
      const dist = Math.abs(price / c.value - 1) * 100;
      if (!best || dist < best.dist) best = { label: c.label, value: c.value, dist };
    }
    return best;
  }

  function renderAdd(d) {
    if (!d || typeof TechInd === 'undefined') return;
    const price = d.price;
    const bars = dayBars();
    const dayNote = DAY_FAILED ? '日K 不可用' : '日K 加载中…';
    const profile = bars.length >= 20
      ? TechInd.volumeProfile(bars, { bins: 30, lookback: ADD_RULES.profileLookback }) : null;
    const mfiRes = bars.length >= 16 ? TechInd.mfi(bars, 14) : null;
    const mfi = mfiRes ? mfiRes.latest : null;
    const div = mfiRes ? TechInd.detectDivergence(bars, mfiRes.series) : null;
    const bottomDiv = div && div.type === 'bottom' ? div : null;
    const recover = mfiRes ? mfiRecovery(mfiRes.series) : null;

    const maRes = bars.length >= ADD_RULES.maPeriod ? TechInd.ma(bars, ADD_RULES.maPeriod) : null;
    const maLatest = maRes ? maRes.latest : null;
    const aboveMa = isNum(maLatest) && isNum(price) && price > maLatest;

    let obvNewLow = null;
    if (bars.length >= ADD_RULES.obvLookback) {
      const obvRes = TechInd.obv(bars);
      const arr = obvRes.series.slice(-ADD_RULES.obvLookback).filter(isNum);
      if (arr.length >= 2) obvNewLow = arr[arr.length - 1] <= Math.min.apply(null, arr.slice(0, -1));
    }

    const trendKnown = isNum(maLatest) || obvNewLow !== null;
    const trendOk = aboveMa || obvNewLow === false;

    const support = nearestSupport(price, profile, PLAN);
    const supportOk = !!support && support.dist <= ADD_RULES.supportDist;
    const confirmOk = !!bottomDiv || !!recover;
    const confirmKnown = !!mfiRes;
    const score = [supportOk, confirmOk, trendOk].filter(Boolean).length;

    let text = DAY_FAILED ? '日K 不可用' : '加载中…';
    let tone = 'text-bg-secondary';
    if (!bars.length) {
      // 日 K 尚未返回
    } else if (score >= 3) { text = '可考虑分批补仓'; tone = 'text-bg-success'; }
    else if (score === 2) { text = '小仓试探'; tone = 'text-bg-warning'; }
    else { text = '观望'; tone = 'text-bg-secondary'; }
    badge($('add-badge'), text, tone);

    const checks = [];

    if (!support) {
      checks.push(checkItem('neutral', '① 到支撑', '—', bars.length ? '筹码 / 重仓价数据不足' : dayNote));
    } else {
      checks.push(checkItem(
        supportOk ? 'ok' : 'warn',
        '① 到支撑',
        `${fmtNum(price)} · 距${support.label} ${support.dist.toFixed(1)}%`,
        `${support.label} ${fmtNum(support.value)}（阈值 ${ADD_RULES.supportDist}%）`
      ));
    }

    if (!confirmKnown) {
      checks.push(checkItem('neutral', '② 资金确认', '—', dayNote));
    } else if (bottomDiv) {
      checks.push(checkItem('ok', '② 资金确认', `MFI ${fmtNum(mfi, 1)}`,
        `MFI 底背离：${bottomDiv.barsAgo} 根前枢轴，指标 +${bottomDiv.indDelta.toFixed(1)}`));
    } else if (recover) {
      checks.push(checkItem('ok', '② 资金确认', `MFI ${fmtNum(mfi, 1)}`,
        `MFI ${recover.low.toFixed(1)} 后回升上穿 ${ADD_RULES.mfiLow}（${recover.barsAgo} 根前）`));
    } else {
      checks.push(checkItem('warn', '② 资金确认', mfi === null ? '—' : `MFI ${mfi.toFixed(1)}`,
        '无底背离，也未上穿 20'));
    }

    if (!trendKnown) {
      checks.push(checkItem('neutral', '③ 趋势过滤', '—', dayNote));
    } else {
      const trendText = trendOk ? '趋势未破' : '趋势偏弱';
      const note = [
        isNum(maLatest) ? `MA20 ${fmtNum(maLatest)}（现价在其${aboveMa ? '上方' : '下方'}）` : 'MA20 —',
        obvNewLow === null ? 'OBV —' : obvNewLow ? 'OBV 20 日创新低' : 'OBV 未创新低'
      ].join(' · ');
      checks.push(checkItem(trendOk ? 'ok' : 'bad', '③ 趋势过滤', trendText, note));
    }

    $('add-checks').innerHTML = checks.join('');

    const hint = $('add-hint');
    let hintCls = 'alert-secondary';
    let hintText;
    if (!bars.length) {
      hintText = DAY_FAILED
        ? '日K 获取失败，补仓面板暂不可用；不影响行情与做T。'
        : '日K 数据加载中；补仓看日线是否止跌，三项缺一即降级。';
    } else if (score >= 3) {
      hintCls = 'alert-success';
      hintText = '三项齐备：价格到支撑、资金出现确认、趋势未破。可考虑分批补仓，单次不超过计划仓位的 1/3。';
    } else if (score === 2) {
      hintCls = 'alert-warning';
      hintText = '只满足 2/3，小仓试探；等缺失项补齐，不要一次打满。';
    } else {
      hintText = `仅满足 ${score}/3，观望；补仓看日线止跌，不接下跌趋势。`;
    }
    hint.className = `alert ${hintCls} mt-3 mb-0 py-2 px-3`;
    hint.textContent = hintText + ' 辅助参考，不构成投资建议。';

    $('add-stats').innerHTML = [
      ['POC', profile ? fmtNum(profile.poc) : '—'],
      ['价值区下沿', profile ? fmtNum(profile.val) : '—'],
      ['价值区上沿', profile ? fmtNum(profile.vah) : '—'],
      ['MA20', fmtNum(maLatest)],
      ['日线 MFI', mfi === null ? '—' : mfi.toFixed(1)],
      ['OBV 20日', obvNewLow === null ? '—' : obvNewLow ? '新低' : '未创新低'],
      ['距支撑', support ? `${support.label} ${support.dist.toFixed(1)}%` : '—'],
      ['筹码样本', profile ? `${profile.count} 根` : '—']
    ].map(([k, v]) => statItem(k, v)).join('');

    const lastDay = bars.length ? bars[bars.length - 1].time : '';
    $('add-note').textContent = DAY_FAILED
      ? '日 K 不可用 · 降级展示'
      : `日 K · ${profile ? profile.count : bars.length || '—'} 根 · 筹码近似`
        + (lastDay && isStale(lastDay) ? ' · 上一交易日' : '');
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
    const evalPlan = currentEval(d);
    // 与首页共用同一套硬性买入资格闸门。
    const eligibility = Croc.buyEligibility(PLAN || {}, { name: evalPlan.name, pe: evalPlan.pe });
    const buyBlock = eligibility.eligible ? null : eligibility.reason;
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
        <td class="text-end">${statusBadge(l.key, l.value, price, buyBlock)}</td>
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

  function statusBadge(key, value, price, buyBlock) {
    if ((key === 'heavy' || key === 'entry') && buyBlock) {
      const label = buyBlock === '盈利数据缺失，暂不判断买点' ? '待核实盈利' : '禁止买入';
      return '<span class="badge text-bg-danger" title="' + esc(buyBlock) + '">' + label + '</span>';
    }
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

  /* ────────────────────────── 渲染：鳄鱼纪律 ────────────────────────── */

  function currentEval(d) {
    return Croc.evaluate(PLAN || {}, Object.assign({}, d, {
      pe: isNum(d.peTtm) ? d.peTtm : d.pe
    }));
  }

  function checkItem(tone, label, value, note) {
    const icon = tone === 'ok' ? '✓' : tone === 'bad' ? '×' : tone === 'warn' ? '!' : '·';
    return `<div class="check-item ${tone}">
      <span class="check-icon">${icon}</span>
      <div class="min-w-0">
        <div class="check-label">${esc(label)}</div>
        <div class="check-value">${value}</div>
        ${note ? `<div class="check-note">${esc(note)}</div>` : ''}
      </div>
    </div>`;
  }

  function renderDiscipline(d) {
    if (!d || typeof Croc === 'undefined') return;
    const e = currentEval(d);
    const price = d.price;
    const checks = [];

    // 1. PB / 净资产八折
    const pbVal = isNum(e.pb) ? `PB ${e.pb.toFixed(2)}` : 'PB —';
    const navVal = isNum(e.navGolden) ? ` · 八折价 ${e.navGolden.toFixed(2)}` : '';
    if (e.pbGolden) {
      checks.push(checkItem('ok', 'PB / 净资产八折', pbVal + navVal, 'PB≤0.8：黄金买点'));
    } else if (e.pbUnder1) {
      checks.push(checkItem('warn', 'PB / 净资产八折', pbVal + navVal, '已破净，但未到八折'));
    } else if (e.pb !== null && e.pb > 0) {
      checks.push(checkItem('bad', 'PB / 净资产八折', pbVal + navVal, '高于八折，安全边际不足'));
    } else {
      checks.push(checkItem('neutral', 'PB / 净资产八折', pbVal, '行情源未提供 PB'));
    }

    // 2. 市值
    if (isNum(e.cap) && e.cap > 0) {
      checks.push(checkItem(e.smallCap ? 'ok' : 'bad', '市值 / 200 亿', fmtCap(e.cap),
        e.smallCap ? '≤200 亿，弹性优先' : '>200 亿，弹性偏小'));
    } else {
      checks.push(checkItem('neutral', '市值 / 200 亿', '—', '行情源未提供总市值'));
    }

    // 3. PE
    let peTone = 'neutral';
    let peNote = '行情源未提供 PE';
    if (e.loss) { peTone = 'bad'; peNote = 'TTM 亏损，PE 失效，改看 PB'; }
    else if (e.pe !== null && e.pe > 30) { peTone = 'bad'; peNote = '30 倍以上算高'; }
    else if (e.pe !== null) { peTone = 'ok'; peNote = '30 倍以内'; }
    checks.push(checkItem(peTone, 'PE(TTM) / 30 倍', fmtPe(e.pe), peNote));

    // 4. 52 周位置
    const pos52 = (isNum(d.low52) && isNum(d.high52) && d.high52 > d.low52)
      ? (price - d.low52) / (d.high52 - d.low52) * 100 : null;
    checks.push(checkItem(
      pos52 == null ? 'neutral' : pos52 <= 25 ? 'ok' : pos52 >= 75 ? 'bad' : 'neutral',
      '52 周位置',
      pos52 == null ? '—' : `分位 ${pos52.toFixed(0)}%`,
      pos52 == null ? '区间数据缺失' : pos52 <= 25 ? '低位区' : pos52 >= 75 ? '高位区' : '中枢区'
    ));

    // 5. 月 K 历史分位
    const hs = historyStats();
    checks.push(checkItem(
      !hs || hs.pos == null ? 'neutral' : hs.pos <= 25 ? 'ok' : hs.pos >= 75 ? 'bad' : 'neutral',
      '历史分位（月K）',
      hs && hs.pos != null ? `${hs.pos.toFixed(0)}%` : '—',
      hs ? `${hs.count} 根月K · 低 ${hs.lo.toFixed(2)} / 高 ${hs.hi.toFixed(2)}` : HISTORY ? '月K 数据不足' : '月K 加载中…'
    ));

    // 6. 计划区间
    if (!PLAN) {
      checks.push(checkItem('neutral', '计划区间', '未纳入股票池', '无入场 / 重仓计划'));
    } else if (!isNum(PLAN.entry) && !isNum(PLAN.heavy)) {
      checks.push(checkItem('neutral', '计划区间', '未设置买点', '入场价与重仓价都为空'));
    } else {
      const zoneText = e.zone === 'heavy' ? '重仓区' : e.zone === 'entry' ? '入场区'
        : e.zone === 'above' ? '高于入场' : '—';
      const buyBlock = e.st ? 'ST 风险股，不买'
        : e.pe === null ? '盈利数据缺失，暂不判断买点'
        : e.pe <= 0 ? '亏损股，不买' : null;
      const note = [
        isNum(PLAN.heavy) ? `重仓 ${fmtNum(PLAN.heavy)}` : null,
        isNum(PLAN.entry) ? `入场 ${fmtNum(PLAN.entry)}` : null,
        buyBlock
      ].filter(Boolean).join(' · ');
      checks.push(checkItem(
        buyBlock ? 'bad' : e.zone === 'heavy' || e.zone === 'entry' ? 'ok' : e.zone === 'above' ? 'warn' : 'neutral',
        '计划区间', buyBlock ? '禁止买入' : zoneText, note
      ));
    }

    // 7. ST
    checks.push(checkItem(e.st ? 'bad' : 'ok', 'ST / 风险警示', e.st ? '是' : '否',
      e.st ? '铁律：不买 ST' : '非 ST'));

    // 8. 连板
    const li = Croc.limitUpInfo(klineCache.dayRaw && klineCache.dayRaw.bars, CODE, e.name);
    let lTone = 'neutral';
    let lVal = '—';
    let lNote = !klineCache.dayRaw ? (klineCache.day ? '未复权日K 不可用，无法可靠识别涨停' : '日K 加载中…') : '未复权日K 数据不足';
    if (li) {
      lTone = li.count >= 3 || li.opened ? 'bad' : li.count === 2 ? 'warn' : 'ok';
      lVal = li.count ? `${li.count} 连板` : '无连板';
      lNote = li.opened ? '最近交易日涨停打开' : `涨停幅度 ${li.pct}%`;
    }
    checks.push(checkItem(lTone, '连续涨停', lVal, lNote));

    $('discipline-checks').innerHTML = checks.join('');

    const scoreEl = $('discipline-score');
    if (scoreEl && typeof Croc !== 'undefined') {
      const sc = Croc.screen(
        { name: e.name || (PLAN && PLAN.name) || '', code: CODE },
        Object.assign({}, d, { pe: isNum(d.peTtm) ? d.peTtm : d.pe })
      );
      scoreEl.innerHTML = sc.allPass
        ? '<span class="flag flag-buy" style="margin-left:0">纪律全过</span>'
        : `<span class="${sc.passed === sc.total - 1 ? 'text-warning-emphasis' : 'text-body-tertiary'}">纪律 ${sc.passed}/${sc.total}${sc.complete ? '' : '?'}</span>`;
    }

    renderLimitUpAlert(li);
    renderSellPlan(e);
  }

  function renderLimitUpAlert(li) {
    const el = $('limitup-alert');
    if (!li || (!li.opened && li.count < 2)) {
      el.classList.add('d-none');
      return;
    }

    let cls = 'alert-warning';
    let text = '';
    if (li.count >= 3) {
      cls = 'alert-danger';
      text = `连续 ${li.count} 个涨停（最近 ${li.lastDate}）。按「卖其疯狂」纪律：不再猜顶，涨停打开时清仓或分批卖出。`
        + (li.opened ? ' 最近交易日涨停已打开。' : '');
    } else if (li.opened) {
      cls = 'alert-danger';
      text = `最近交易日触及涨停后打开（${li.lastDate}），情绪可能见顶；结合 ${li.count} 连板分批卖出。`;
    } else {
      text = `已 2 连板（最近 ${li.lastDate}），接近疯狂信号，准备执行卖出纪律。`;
    }

    el.className = `alert ${cls} mt-3 mb-0 py-2 px-3`;
    el.textContent = text;
  }

  function renderSellPlan(e) {
    const el = $('sell-plan');
    const cost = readCost();
    if (!cost) {
      el.innerHTML = '<span class="text-body-secondary">设置持仓成本后，显示翻倍卖点与当前盈亏。</span>';
      return;
    }

    const price = e.price;
    const pnl = isNum(price) && price > 0 ? (price / cost - 1) * 100 : null;
    const two = cost * 2;
    const three = cost * 3;

    let hint = '';
    let tone = 'text-body-secondary';
    if (isNum(price)) {
      if (price >= three) {
        hint = '已达三倍区间：参考资料目标，结合连续涨停信号分批清仓。';
        tone = 'text-up';
      } else if (price >= two) {
        hint = '已达翻倍：按纪律卖出浮盈部分，收回本金，剩余为零成本底仓。';
        tone = 'text-up';
      } else if (price >= cost) {
        hint = `未到翻倍，距翻倍还需 ${fmtPct((two / price - 1) * 100)}；逻辑不变就拿住。`;
      } else {
        hint = `低于成本 ${fmtPct((price / cost - 1) * 100)}；先核对买入逻辑是否被破坏。`;
        tone = 'text-down';
      }
    }

    el.innerHTML = `
      <div class="sell-line">成本 <b>${cost.toFixed(2)}</b> · 现价 <b>${fmtNum(price)}</b>
        · 浮动 <span class="${toneClass(pnl)}">${fmtPct(pnl)}</span></div>
      <div class="sell-line text-body-secondary">翻倍卖利润 <b class="text-body">${two.toFixed(2)}</b>（+100%）
        · 三倍目标 <b class="text-body">${three.toFixed(2)}</b>（+200%）</div>
      <div class="sell-line ${tone}">${esc(hint)}</div>`;
  }

  function loadCost() {
    const c = readCost();
    if (c) $('cost-input').value = c.toFixed(2);
  }

  function saveCost() {
    const v = Number($('cost-input').value);
    if (!isFinite(v) || v <= 0) {
      showToast('请输入大于 0 的持仓成本');
      return;
    }
    try { localStorage.setItem(costKey(), String(v)); } catch (e) { /* ignore */ }
    $('cost-input').value = v.toFixed(2);
    if (DETAIL) renderSellPlan(currentEval(DETAIL));
    showToast('持仓成本已保存', 'success');
  }

  function clearCost() {
    try { localStorage.removeItem(costKey()); } catch (e) { /* ignore */ }
    $('cost-input').value = '';
    if (DETAIL) renderSellPlan(currentEval(DETAIL));
    showToast('持仓成本已清除', 'success');
  }

  /* ────────────────────────── 资源股估值计算 ────────────────────────── */

  function loadCalc() {
    try {
      const o = JSON.parse(localStorage.getItem(calcKey()) || '{}');
      ['p', 'c', 'q', 'discount', 'multiple'].forEach(k => {
        if (o[k] !== undefined && o[k] !== null && o[k] !== '' && $('calc-' + k)) {
          $('calc-' + k).value = o[k];
        }
      });
    } catch (e) { /* ignore */ }
  }

  function updateCalc() {
    if (!DETAIL || !$('calc-p')) return;

    const p = Number($('calc-p').value);
    const c = Number($('calc-c').value);
    const q = Number($('calc-q').value);
    const discount = Number($('calc-discount').value) || 0.65;
    const multiple = Number($('calc-multiple').value) || 20;
    const filled = $('calc-p').value !== '' && $('calc-c').value !== '' && $('calc-q').value !== '';

    try {
      localStorage.setItem(calcKey(), JSON.stringify({
        p: $('calc-p').value,
        c: $('calc-c').value,
        q: $('calc-q').value,
        discount: $('calc-discount').value,
        multiple: $('calc-multiple').value
      }));
    } catch (e) { /* ignore */ }

    const out = $('calc-out');
    if (!filled || !isFinite(p) || !isFinite(c) || !isFinite(q) || p <= 0 || c < 0 || q <= 0) {
      out.textContent = '填写 P / C / Q 后自动计算。';
      return;
    }

    const gross = (p - c) * q * 1e4;
    const net = gross * discount;
    const fair = net * multiple;
    const wild = net * 40;
    const cap = DETAIL.totalCap;
    const shares = isNum(DETAIL.totalShares) && DETAIL.totalShares > 0
      ? DETAIL.totalShares
      : (isNum(cap) && isNum(DETAIL.price) && DETAIL.price > 0 ? cap / DETAIL.price : null);
    const implied = shares ? fair / shares : null;
    const space = isNum(cap) && cap > 0 ? (fair / cap - 1) * 100 : null;

    out.innerHTML = `
      <div>年化毛利 <b>${fmtYi(gross)}</b> · 保守净利 <b>${fmtYi(net)}</b></div>
      <div>合理市值 <b>${fmtYi(fair)}</b>（${multiple}×） · 当前 <b>${fmtYi(cap)}</b>
        · 空间 <span class="${toneClass(space)}">${fmtPct(space)}</span></div>
      <div class="text-body-secondary">对应股价 <b class="text-body">${fmtNum(implied)}</b>
        · 狂热上限（40×）${fmtYi(wild)}</div>
      ${gross <= 0 ? '<div class="text-up">当前价格不高于成本，毛利为负：先确认 P / C 是否填反。</div>' : ''}`;
  }

  /* ────────────────────────── 图表 ────────────────────────── */

  function destroyChart() {
    if (chart) chart.remove();
    chart = null;
    chartKey = '';
    series = {};
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

    $('chart-hint').textContent = '前复权 · 200 根';

    if (!klineCache[tab]) {
      $('chart-empty').textContent = '图表加载中…';
      $('chart-empty').classList.remove('d-none');
    }

    try {
      if (force || !klineCache[tab]) {
        klineCache[tab] = await quotes.fetchKline(CODE, {
          period: tab,
          count: 200,
          adjust: 'qfq',
          force: !!force
        });
      }
      renderKline(klineCache[tab], tab);
      $('chart-empty').classList.add('d-none');
      if (tab === 'day' && DETAIL) {
        renderDiscipline(DETAIL);
        renderAdd(DETAIL);
      }
    } catch (e) {
      console.warn('图表加载失败:', e);
      $('chart-empty').textContent = '图表加载失败：' + (e.message || '接口不可用');
      $('chart-empty').classList.remove('d-none');
      throw e;
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
    if (klineCache[chartTab]) {
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

    const ms = 60000;
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
    if (!btn) return;
    if (btn.classList.contains('q-btn')) {
      btn.classList.add('refreshing');
      clearTimeout(btn._t);
      btn._t = setTimeout(() => btn.classList.remove('refreshing'), 900);
      return;
    }
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
  window.saveCost = saveCost;
  window.clearCost = clearCost;
  window.updateCalc = updateCalc;

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
    $('em-link').href = `https://quote.eastmoney.com/${CODE}.html`;
    showState('加载中…', `${CODE6} 行情获取中，请稍候`, 'none');

    await loadPlan();
    renderHeader();
    loadCost();
    loadCalc();

    await refreshAll(false);
    scheduleRefresh();
  })();
})();
