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
  let REPORTS = {};
  let DISCIPLINE_RULES = null;

  let chartTab = 'month';
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

  /** 读取研报原始总分（静态摘录） */
  async function loadReportScores() {
    try {
      const res = await fetch('data/research-reports.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const payload = await res.json();
      REPORTS = payload && payload.reports ? payload.reports : {};
    } catch (e) {
      console.warn('研报评分表加载失败:', e);
      REPORTS = {};
    }
  }

  /** 读取纪律与评分卡共用的展示规则，确保标签和分值口径统一。 */
  async function loadDisciplineRules() {
    try {
      const res = await fetch('data/discipline-rules.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const payload = await res.json();
      if (!payload || !Array.isArray(payload.scoreItems) || !Array.isArray(payload.manualItems)) {
        throw new Error('纪律规则 JSON 格式无效');
      }
      DISCIPLINE_RULES = payload;
    } catch (e) {
      console.warn('纪律规则加载失败，使用内置默认规则:', e);
      DISCIPLINE_RULES = {
        schemaVersion: 1,
        scoreItems: [{"key":"owner","label":"国资背景","max":10},{"key":"cap","label":"总市值","max":8},{"key":"focus","label":"主营集中","max":9},{"key":"profit","label":"扣非净利增长","max":14},{"key":"consolidation","label":"盘整 2-3 年","max":9},{"key":"bottom","label":"月线底部","max":9},{"key":"volume","label":"底部放量","max":6}],
        manualItems: [{"key":"moat","label":"护城河","value":"无法自动判断","note":"需要人工评估成本优势、资源禀赋、品牌/渠道与竞争格局"}]
      };
    }
    renderResearchScore();

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
      const bundle = await quotes.fetchStockBundle(CODE);
      const d = bundle.detail && Number(bundle.detail.price) > 0
        ? bundle.detail : await quotes.fetchOne(CODE);
      if (!d) throw new Error('静态数据中没有该股票的有效详情数据。');
      DETAIL = d;
      const toKline = (period, adjust, series) => series && Array.isArray(series.bars) && series.bars.length
        ? { code: CODE, period, adjust, bars: series.bars } : null;
      klineCache.day = toKline('day', 'qfq', bundle.dailyAdjusted);
      klineCache.dayRaw = toKline('day', 'none', bundle.dailyRaw);
      klineCache.week = toKline('week', 'qfq', bundle.weeklyAdjusted);
      klineCache.month = toKline('month', 'qfq', bundle.monthlyAdjusted);
      HISTORY = klineCache.month;
      historyAt = HISTORY ? Date.now() : 0;
      if (klineCache.day) apply52WeekFallback(klineCache.day.bars);
      $('state-box').classList.add('d-none');
      $('content').classList.remove('d-none');
      renderAll();
      if (HISTORY) renderHistoryRange();
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
    loadChart(chartTab, false).catch(() => {});
    if (manual) showToast('已重新读取静态行情缓存', 'success');
  }

  /* ────────────────────────── 渲染：头部 / 行情 ────────────────────────── */

  function renderAll() {
    renderHeader();
    renderQuote(DETAIL);
    renderValuation(DETAIL);
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

    let details = [];
    try {
      // 统一读取轻量估值索引，避免为同组估值下载多份完整个股历史文件。
      const peerMap = await quotes.fetchDetails(codes);
      details = Object.values(peerMap || {});
    } catch (error) {
      // 兼容缓存索引尚未发布的旧版本。
      const results = await mapLimit(codes, 4, c => quotes.fetchDetail(c).catch(() => null));
      details = results.filter(Boolean);
    }

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
      // 趋势/均线使用前复权 K；涨停幅度和涨停价必须使用未复权 K。
      const [adjusted, raw] = await Promise.allSettled([
        quotes.fetchKline(CODE, { period: 'day', count: 250, adjust: 'qfq' }),
        quotes.fetchKline(CODE, { period: 'day', count: 250, adjust: 'none' })
      ]);
      if (raw.status === 'fulfilled') klineCache.dayRaw = raw.value;
      if (adjusted.status !== 'fulfilled') throw adjusted.reason;

      klineCache.day = adjusted.value;
      apply52WeekFallback(klineCache.day.bars);

    } catch (e) {
      /* 日 K 失败不影响主流程 */
      
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

  /** 研报评分：优先展示研报原始总分并注明来源与日期，机器分作为对照 */
  function renderResearchScore() {
    const totalEl = $('research-score-total');
    const noteEl = $('research-score-note');
    const sourceEl = $('research-score-source');
    const barWrap = $('research-score-bar-wrap');
    const checksEl = $('research-score-checks');
    const bar = $('research-score-bar');
    const bandEl = $('research-score-band');
    if (!totalEl || !checksEl || !noteEl || !barWrap || !bar) return;

    const report = REPORTS[CODE] || null;
    const score = RESEARCH_SCORE;
    if (!report && (!score || !isNum(score.percent))) {
      totalEl.textContent = '';
      noteEl.textContent = '暂无评分：该股票既没有收录研报评分，也未纳入静态行情缓存。';
      if (sourceEl) sourceEl.textContent = '';
      barWrap.hidden = true;
      checksEl.innerHTML = '';
      return;
    }

    if (report) {
      const months = monthsBetween(report.date);
      const stale = months !== null && months >= 12;
      const bandText = reportBand(report.score);
      const tone = report.score >= 80 ? 'good' : report.score >= 70 ? 'mid' : 'high';
      totalEl.innerHTML = `<span class="score score-${tone}">${report.score.toFixed(1)} 分</span>`
        + `<span class="text-body-secondary">&nbsp;· ${bandText}</span>`;
      noteEl.textContent = '研报原始总分（10 项百分制），直接摘录，不做二次计算。';
      if (sourceEl) {
        const alt = (report.alternates || [])
          .map(item => `${item.date} 另有 ${item.score.toFixed(1)} 分（${item.source}）`)
          .join('；');
        sourceEl.textContent = `来源：${report.source} · 报告日期 ${report.date}`
          + (months !== null ? `（${months} 个月前${stale ? '，可能已过时' : ''}）` : '')
          + (alt ? `；${alt}` : '');
        sourceEl.classList.toggle('text-warning-emphasis', stale);
      }
      barWrap.hidden = false;
      bar.style.width = Math.max(0, Math.min(100, report.score)).toFixed(1) + '%';
      if (bandEl) bandEl.textContent = `研报分档：${bandText}`;
    } else {
      totalEl.innerHTML = `<span class="score score-${score.band === 'good' ? 'good' : score.band === 'high' ? 'high' : 'mid'}">${score.percent.toFixed(1)} 分</span>`
        + `<span class="text-body-secondary">&nbsp;· ${score.band === 'good' ? '位置优秀' : score.band === 'high' ? '位置偏高' : '位置中性'}</span>`;
      noteEl.textContent = '暂无研报总分，按 7 项可复算指标（国资背景 / 扣非增长 / 主营集中 / 市值 / 盘整 / 月线 / 放量）折算成百分制。';
      if (sourceEl) {
        sourceEl.textContent = '';
        sourceEl.classList.remove('text-warning-emphasis');
      }
      barWrap.hidden = false;
      bar.style.width = Math.max(0, Math.min(100, score.percent)).toFixed(1) + '%';
      if (bandEl) bandEl.textContent = '≥75 优秀 · 56–75 中性';
    }

    if (!score || !score.items) {
      checksEl.innerHTML = '<div class="text-body-tertiary" style="font-size:11px">该股票没有机器复算数据（未纳入静态行情缓存）。</div>';
      return;
    }

    checksEl.innerHTML = buildResearchScoreItems(score)
      .map(item => checkItem(item.tone, item.label, item.value, item.note))
      .join('');
  }

  /** 从评分 JSON 生成共用检查项，供评分卡与鳄鱼纪律复用。 */
  function buildResearchScoreItems(score) {
    if (!score || !score.items || !DISCIPLINE_RULES || !Array.isArray(DISCIPLINE_RULES.scoreItems)) return [];
    const m = score.metrics || {};
    const it = score.items;
    const toneOf = (value, full) => {
      if (!isNum(value)) return 'neutral';
      const ratio = value / full;
      return ratio >= 0.75 ? 'ok' : ratio >= 0.45 ? 'warn' : 'bad';
    };
    const ownerLabel = { central: '央企', province: '省级国资', city: '地市国资', other: '其他' }[m.ownerType] || '未知';
    const notes = {
      owner: m.owner ? `${ownerLabel} · ${m.owner}` : '实控人未取到',
      focus: isNum(m.mainRatio)
        ? `最大品类 ${(m.mainRatio * 100).toFixed(0)}%${m.mainItem ? '（' + m.mainItem + '）' : ''}`
        : '主营构成未取到',
      profit: isNum(m.profitYoy)
        ? `最近年报扣非同比 ${m.profitYoy.toFixed(1)}%${isNum(m.priorProfitYoy) ? ' · 前一年 ' + m.priorProfitYoy.toFixed(1) + '%' : ''}`
        : '扣非数据未取到',
      cap: isNum(m.capYi) ? `${Math.round(m.capYi)} 亿` : '市值缺失',
      consolidation: [
        isNum(m.boxHeight) ? `近 36 月箱体 ${(m.boxHeight * 100).toFixed(0)}%` : null,
        isNum(m.months) ? `高点距今 ${m.months} 个月` : null
      ].filter(Boolean).join(' · ') || '月 K 不足',
      bottom: [
        isNum(m.pAll) ? `全历史分位 ${m.pAll.toFixed(0)}%` : null,
        isNum(m.p52) ? `52 周位置 ${m.p52.toFixed(0)}%` : null
      ].filter(Boolean).join(' · ') || '月 K 不足',
      volume: isNum(m.volRatio) ? `近 6 月 / 前 36 月 量比 ${m.volRatio.toFixed(2)}` : '成交量不足'
    };
    return DISCIPLINE_RULES.scoreItems.map(rule => {
      const value = it[rule.key];
      return {
        key: rule.key,
        label: rule.label,
        tone: toneOf(value, rule.max),
        value: `${fmtNum(value, 1)} / ${rule.max}`,
        note: notes[rule.key] || '暂无补充说明'
      };
    });
  }

  /** 距今月数 */
  function monthsBetween(dateStr) {
    const date = new Date(`${dateStr}T00:00:00`);
    if (isNaN(date.getTime())) return null;
    const now = new Date();
    const months = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
    return months < 0 ? 0 : months;
  }

  /** 研报分档：>90 绝佳 / 80-90 稀有 / 70-80 合理 / <70 等待 */
  function reportBand(value) {
    if (value >= 90) return '绝佳买入机会';
    if (value >= 80) return '稀有买入机会';
    if (value >= 70) return '合理买入机会';
    return '等待区间';
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

    await Promise.all([loadPlan(), loadDisciplineRules()]);
    renderHeader();
    loadCalc();
    loadReportScores().then(renderResearchScore);
    loadResearchScore();

    await refreshAll(false);
  })();
})();
