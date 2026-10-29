/*!
 * 股票详情页 —— stock.html 的页面逻辑
 * 依赖：static-quotes.js（同源静态行情缓存）、ECharts（日/月 K，Apache-2.0，无署名要求）
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
  let RESEARCH_SCORE = null;

  let DAY_FAILED = false;

  /* 补仓（日线）判定阈值（集中调参） */
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
  const klineCache = {};


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

  const calcKey = () => 'croc-valuation:' + CODE;

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

  function initTheme() {
    // 与列表页一致：用户手动选择优先，其次跟随系统。
    const saved = localStorage.getItem('stock-theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
  }

  function toggleTheme() {
    const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
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

  /* ────────────────────────── 数据加载 ────────────────────────── */

  async function loadPlan() {
    try {
      const res = await fetch('data/stocks.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      STOCKS = await res.json();
      PLAN = STOCKS.find(s => StockQuotes.normalizeCode(s.code) === CODE) || null;
    } catch (e) {
      console.warn('基础数据加载失败:', e);
      PLAN = null;
    }
  }

  /** 读取 Actions 预计算的 32 分制评分；缺失时卡片显示「暂无」 */
  async function loadResearchScore() {
    try {
      const res = await fetch('data/research-scores.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const payload = await res.json();
      const scores = payload && payload.scores ? payload.scores : {};
      RESEARCH_SCORE = scores[CODE] || null;
      RESEARCH_SCORE = RESEARCH_SCORE ? Object.assign({ totalMax: payload.totalMax || 32 }, RESEARCH_SCORE) : null;
    } catch (e) {
      console.warn('研报评分加载失败:', e);
      RESEARCH_SCORE = null;
    }
    renderResearchScore();
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
    }
    loadChart(chartTab, manual).catch(() => {});
    if (manual) showToast('已重新读取静态行情缓存', 'success');
  }

  /* ────────────────────────── 渲染：头部 / 行情 ────────────────────────── */

  function renderAll() {
    renderHeader();
    renderQuote(DETAIL);
    renderValuation(DETAIL);
    renderPlan(DETAIL);
    renderAdd(DETAIL);
    renderDiscipline(DETAIL);
    renderResearchScore();
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

  /* ────────────────────────── 补仓数据 ────────────────────────── */

  function dayBars() {
    return klineCache.day && Array.isArray(klineCache.day.bars) ? klineCache.day.bars : [];
  }

  function badge(el, text, cls) {
    if (!el) return;
    el.textContent = text;
    el.className = 'badge rounded-pill ' + cls;
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
        ? '日K 获取失败，补仓面板暂不可用；不影响行情展示。'
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
  }

  /** 研报评分：只展示研报 10 项里可复算的 4 项（32 分制） */
  function renderResearchScore() {
    const totalEl = $('research-score-total');
    const noteEl = $('research-score-note');
    const barWrap = $('research-score-bar-wrap');
    const checksEl = $('research-score-checks');
    const bar = $('research-score-bar');
    if (!totalEl || !checksEl || !noteEl || !barWrap || !bar) return;

    const score = RESEARCH_SCORE;
    if (!score || !isNum(score.points)) {
      totalEl.textContent = '';
      noteEl.textContent = '暂无评分：该股票未纳入静态行情缓存，或评分文件尚未生成。';
      barWrap.hidden = true;
      checksEl.innerHTML = '';
      return;
    }

    const max = isNum(score.max) && score.max > 0 ? score.max : (score.totalMax || 32);
    const band = score.band === 'good' ? '位置优秀' : score.band === 'high' ? '位置偏高' : '位置中性';
    const tone = score.band === 'good' ? 'good' : score.band === 'high' ? 'high' : 'mid';
    totalEl.innerHTML = `<span class="score score-${tone}">${score.points.toFixed(1)}</span>`
      + `<span class="text-body-secondary">/${max} · ${band}</span>`;
    noteEl.textContent = '研报 10 项评分卡中可自动复算的 4 项（8 + 9 + 9 + 6 = 32 分），只看位置，不含基本面。';

    barWrap.hidden = false;
    bar.style.width = Math.max(0, Math.min(100, score.points / max * 100)).toFixed(1) + '%';

    const m = score.metrics || {};
    const it = score.items || {};
    const toneOf = (value, full) => {
      if (!isNum(value)) return 'neutral';
      const ratio = value / full;
      return ratio >= 0.75 ? 'ok' : ratio >= 0.45 ? 'warn' : 'bad';
    };
    const capNote = isNum(m.capYi) ? `${Math.round(m.capYi)} 亿` : '市值缺失';
    const consNote = [
      isNum(m.boxHeight) ? `近 36 月箱体 ${(m.boxHeight * 100).toFixed(0)}%` : null,
      isNum(m.months) ? `高点距今 ${m.months} 个月` : null
    ].filter(Boolean).join(' · ') || '月 K 不足';
    const bottomNote = [
      isNum(m.pAll) ? `全历史分位 ${m.pAll.toFixed(0)}%` : null,
      isNum(m.p52) ? `52 周位置 ${m.p52.toFixed(0)}%` : null
    ].filter(Boolean).join(' · ') || '月 K 不足';
    const volNote = isNum(m.volRatio) ? `近 6 月 / 前 36 月 量比 ${m.volRatio.toFixed(2)}` : '成交量不足';

    checksEl.innerHTML = [
      checkItem(toneOf(it.cap, 8), '总市值', `${fmtNum(it.cap, 1)} / 8`, capNote),
      checkItem(toneOf(it.consolidation, 9), '盘整 2-3 年', `${fmtNum(it.consolidation, 1)} / 9`, consNote),
      checkItem(toneOf(it.bottom, 9), '月线底部', `${fmtNum(it.bottom, 1)} / 9`, bottomNote),
      checkItem(toneOf(it.volume, 6), '底部放量', `${fmtNum(it.volume, 1)} / 6`, volNote)
    ].join('');
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
    if (chart && typeof chart.dispose === 'function') chart.dispose();
    chart = null;
    chartKey = '';
  }

  /** 图表配色取自当前主题的 CSS 变量，切换主题后重建。 */
  function chartTokens() {
    return {
      text: cssVar('--bs-body-color') || '#212529',
      bg: cssVar('--bs-body-bg') || '#ffffff',
      border: cssVar('--bs-border-color') || '#dee2e6',
      up: cssVar('--up') || '#dc2626',
      down: cssVar('--down') || '#15803d',
      primary: cssVar('--bs-primary') || '#0d6efd'
    };
  }

  function createChart() {
    destroyChart();
    if (!window.echarts || typeof window.echarts.init !== 'function') {
      throw new Error('图表组件未加载');
    }
    chart = window.echarts.init($('chart'), null, { renderer: 'canvas' });
    bindChartResize();
    return chart;
  }

  let chartResizeBound = false;
  function bindChartResize() {
    if (chartResizeBound) return;
    chartResizeBound = true;
    const fit = () => { if (chart) chart.resize(); };
    window.addEventListener('resize', fit);
    if (typeof ResizeObserver === 'function') {
      const wrap = $('chart') && $('chart').parentElement;
      if (wrap) new ResizeObserver(fit).observe(wrap);
    }
  }

  function axisLabelOf(time, period) {
    const s = String(time || '');
    return period === 'month' ? s.slice(0, 7) : s.slice(5);
  }

  function buildChartOption(bars, period) {
    const t = chartTokens();
    const dates = bars.map(b => b.time);
    const candle = bars.map(b => [b.open, b.close, b.low, b.high]);
    const volume = bars.map(b => ({
      value: b.volume || 0,
      itemStyle: { color: rgba(b.close >= b.open ? t.up : t.down, 0.35) }
    }));

    return {
      animation: false,
      backgroundColor: 'transparent',
      textStyle: { color: t.text, fontSize: 11, fontFamily: 'inherit' },
      grid: [
        { left: 24, right: 54, top: 10, height: '62%' },
        { left: 24, right: 54, top: '74%', bottom: 24 }
      ],
      axisPointer: {
        link: [{ xAxisIndex: 'all' }],
        label: { backgroundColor: t.primary, fontSize: 10 }
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: t.border } },
        backgroundColor: t.bg,
        borderColor: t.border,
        borderWidth: 1,
        padding: [6, 8],
        textStyle: { color: t.text, fontSize: 11 },
        formatter: params => {
          const list = Array.isArray(params) ? params : [params];
          const hit = list.find(p => p.seriesType === 'candlestick');
          if (!hit) return '';
          const bar = bars[hit.dataIndex];
          const prev = hit.dataIndex > 0 ? bars[hit.dataIndex - 1].close : null;
          const chg = prev ? (bar.close / prev - 1) * 100 : null;
          const tone = bar.close >= bar.open ? t.up : t.down;
          return `<div style="font-weight:600;margin-bottom:3px">${esc(bar.time)}</div>`
            + `<div>开 ${fmtNum(bar.open)} · 高 ${fmtNum(bar.high)}</div>`
            + `<div>低 ${fmtNum(bar.low)} · 收 <b style="color:${tone}">${fmtNum(bar.close)}</b></div>`
            + (chg == null ? '' : `<div>较前收 <span style="color:${chg >= 0 ? t.up : t.down}">${fmtPct(chg)}</span></div>`)
            + `<div>量 ${fmtAmount(bar.volume)}</div>`;
        }
      },
      xAxis: [
        {
          type: 'category',
          data: dates,
          boundaryGap: true,
          axisLine: { lineStyle: { color: t.border } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            color: t.text, fontSize: 10, hideOverlap: true,
            formatter: v => axisLabelOf(v, period)
          }
        },
        {
          type: 'category',
          gridIndex: 1,
          data: dates,
          boundaryGap: true,
          axisLine: { lineStyle: { color: t.border } },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false }
        }
      ],
      yAxis: [
        {
          scale: true,
          position: 'right',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: t.border, opacity: 0.55 } },
          axisLabel: { color: t.text, fontSize: 10, formatter: v => Number(v).toFixed(2) }
        },
        {
          gridIndex: 1,
          scale: true,
          splitNumber: 2,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false }
        }
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: [0, 1],
          // 滚轮留给页面滚动，Ctrl/⌘ + 滚轮缩放；拖拽平移、双指缩放照常。
          zoomOnMouseWheel: 'ctrl',
          moveOnMouseMove: true,
          moveOnMouseWheel: false,
          minValueSpan: 20
        }
      ],
      series: [
        {
          type: 'candlestick',
          data: candle,
          barMaxWidth: 12,
          itemStyle: {
            color: t.up,
            color0: t.down,
            borderColor: t.up,
            borderColor0: t.down
          }
        },
        {
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: volume,
          barMaxWidth: 10
        }
      ]
    };
  }

  function setTab(tab) {
    if (chartTab === tab) return;
    chartTab = tab;
    Array.from($('chart-tabs').children).forEach(b => {
      const active = b.dataset.tab === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    loadChart(tab, false).catch(() => {});
  }

  async function loadChart(tab, force) {
    if (!CODE) return;

    $('chart-hint').textContent = '前复权 · 200 根 · 拖拽平移 / Ctrl 滚轮缩放';

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
    if (!chart || chartKey !== key) {
      createChart();
      chartKey = key;
    }
    chart.setOption(buildChartOption(bars, period), true);
    chart.resize();
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
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }, 700);
  }

  /* ────────────────────────── 启动 ────────────────────────── */

  window.refreshAll = refreshAll;
  window.toggleTheme = toggleTheme;
  window.updateCalc = updateCalc;

  (async function init() {
    initTheme();
    bindUI();

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
    loadCalc();
    loadResearchScore();

    await refreshAll(false);
  })();
})();
