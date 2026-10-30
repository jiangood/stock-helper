/* Home trading combat center: manual decision support only, never submits orders. */
(function (root) {
  'use strict';
  var state = { stocks: [], prices: {}, client: null, rows: [], initialized: false, loading: false, lastRun: 0, error: '', expanded: {}, sort: { col: null, dir: 1 }, progressDone: 0, progressTotal: 0, progressStartedAt: 0, progressTimer: null };
  var COLUMN_COUNT = 9;
  var $ = function (id) { return root.document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]; }); }
  function money(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v).toFixed(2) : '—'; }
  function pct(v) { return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) ? (Number(v) > 0 ? '+' : '') + Number(v).toFixed(2) + '%' : '—'; }
  function quoteTime(quote) {
    var raw = quote && quote.time, n = Number(raw);
    if (!raw || !Number.isFinite(n) || n <= 0) return '时间未提供';
    var d = new Date(n < 1000000000000 ? n * 1000 : n);
    if (Number.isNaN(d.getTime())) return '时间格式异常';
    var label = '报价 ' + d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    var age = Date.now() - d.getTime();
    if (age > 5 * 86400000) label += ' · 超过5天未更新';
    else if (age < -5 * 60000) label += ' · 时间在未来，请核对';
    return label;
  }
  function planReviewLabel(stock) {
    var value = String(stock && stock.updDate || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '计划复核日期未设置';
    var parts = value.split('-').map(Number), date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) return '计划复核日期无效';
    var age = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (age < 0) return '计划复核日期在未来，请核对';
    return '计划复核 ' + value + (age > 180 ? ' · 已 ' + age + ' 天未复核，建议检查' : ' · ' + age + ' 天前');
  }
  function planChecks(stock, quote, primary, eligible) {
    var checks = [], raw = quote && Number(quote.time), ts = raw > 0 ? new Date(raw < 1000000000000 ? raw * 1000 : raw).getTime() : NaN;
    var quoteFresh = Number.isFinite(ts) && Date.now() - ts <= 5 * 86400000 && Date.now() - ts >= -5 * 60000;
    checks.push((quoteFresh ? '✓' : '！') + ' 行情时间' + (quoteFresh ? '有效' : '待核对'));
    var date = String(stock && stock.updDate || '');
    var age = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Math.floor((Date.now() - new Date(date + 'T00:00:00Z').getTime()) / 86400000) : null;
    var planFresh = age !== null && age >= 0 && age <= 180;
    checks.push((planFresh ? '✓' : '！') + ' 计划复核' + (planFresh ? '未过期' : '需复核'));
    var disciplineOk = !!(eligible && eligible.eligible === true) && primary && primary.kind !== 'risk' && primary.kind !== 'data';
    checks.push((disciplineOk ? '✓' : '！') + ' 纪律门槛' + (disciplineOk ? '未拦截' : '未通过/数据不足'));
    checks.push('! 本规则不设止损，靠仓位控制风险；重仓价不是止损价');
    checks.push('! 下单前人工确认：商品周期、公司逻辑与仓位风险');
    return checks;
  }
  function codeOf(code) { return String(code || '').trim().toLowerCase(); }
  function quoteFor(code) { return state.prices[code] || state.prices[codeOf(code)] || null; }
  function statusClass(kind) {
    return ({
      'add-ready': 'combat-good', 'add-watch': 'combat-warn', 'risk': 'combat-risk',
      'data': 'combat-data', 'watch': 'combat-neutral',
      'exit': 'combat-exit', 'exit-armed': 'combat-armed', 'exit-idle': 'combat-neutral',
      'exit-closed': 'combat-neutral'
    })[kind] || 'combat-neutral';
  }
  // 默认排序：可执行的操作放前面（止盈触发 → 买入观察 → 止盈跟踪 → 观望/未启动 → 风险拦截 → 数据不足）
  function priorityOf(r) {
    var kind = r && r.primary && r.primary.kind;
    if (kind === 'exit') return 0;
    if (kind === 'add-ready') return 1;
    if (kind === 'add-watch') return 2;
    if (kind === 'exit-armed') return 3;
    if (kind === 'risk') return 5;
    if (kind === 'data') return 6;
    return 4;
  }
  function buyScoreOf(r) {
    var add = r && r.add;
    return add && add.dataReady && add.inZone ? (add.score || 0) : -1;
  }
  function buyGapOf(r) {
    var add = r && r.add;
    return add && Number.isFinite(Number(add.gapPct)) ? Number(add.gapPct) : null;
  }
  // 同一优先级内按状态归块，避免「观望 / 已离场」交替出现
  function statusTextOf(r) {
    return String((r && r.primary && r.primary.status) || '');
  }
  function statusRankOf(r) {
    var st = statusTextOf(r);
    if (st.indexOf('观望') === 0) return 0;
    if (st.indexOf('高于入场价') === 0) return 1;
    if (st.indexOf('离场冷却') === 0) return 2;
    if (st.indexOf('未配置入场价') === 0) return 3;
    return 4;
  }
  function sortByPriority(rows) {
    return rows.slice().sort(function (a, b) {
      var d = priorityOf(a) - priorityOf(b);
      if (d) return d;
      var k = statusRankOf(a) - statusRankOf(b);
      if (k) return k;
      var t = statusTextOf(a).localeCompare(statusTextOf(b), 'zh-CN');
      if (t) return t;
      var s = buyScoreOf(b) - buyScoreOf(a);
      if (s) return s;
      var ga = buyGapOf(a), gb = buyGapOf(b);
      if (ga !== null && gb !== null && ga !== gb) return ga - gb;
      return String((a.stock && a.stock.name) || '').localeCompare(String((b.stock && b.stock.name) || ''), 'zh-CN');
    });
  }
  // 表头排序：未选列时回到默认优先级排序，空值恒排最后
  var SORT_COLUMNS = ['name', 'price', 'status', 'score', 'entry', 'heavy', 'exitState', 'exitLine', 'bars'];
  function sortValueOf(r, col) {
    var s = (r && r.stock) || {}, add = r && r.add, exit = r && r.exit;
    var price = r && r.quote && Number(r.quote.price) > 0 ? Number(r.quote.price) : null;
    switch (col) {
      case 'name':      return String(s.name || '');
      case 'price':     return price;
      case 'status':    return priorityOf(r) * 10 + statusRankOf(r);
      case 'score':     return add && add.dataReady && add.inZone ? (add.score || 0) : null;
      case 'entry':     return Number(s.entry) > 0 ? Number(s.entry) : null;
      case 'heavy':     return Number(s.heavy) > 0 ? Number(s.heavy) : null;
      case 'exitState': return exit && exit.state ? exit.state : '';
      case 'exitLine':  return exit ? Number(exit.armed ? exit.exitLine : exit.armLine) : null;
      case 'bars':      return r && r.indicators && r.indicators.bars ? r.indicators.bars : null;
      default:          return null;
    }
  }
  function sortedRows(rows) {
    var col = state.sort.col;
    if (!col) return sortByPriority(rows);
    return rows.slice().sort(function (a, b) {
      var av = sortValueOf(a, col), bv = sortValueOf(b, col);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv, 'zh-CN') * state.sort.dir;
      return (av - bv) * state.sort.dir;
    });
  }
  function applySortUI() {
    if (!root.document || typeof root.document.getElementById !== 'function') return;
    SORT_COLUMNS.forEach(function (col) {
      var th = $('cth-' + col);
      if (!th) return;
      var active = state.sort.col === col;
      th.classList.toggle('sort-asc', active && state.sort.dir === 1);
      th.classList.toggle('sort-desc', active && state.sort.dir === -1);
      th.setAttribute('aria-sort', !active ? 'none' : state.sort.dir === 1 ? 'ascending' : 'descending');
    });
  }
  function sortBy(col) {
    if (SORT_COLUMNS.indexOf(col) < 0) return;
    if (state.sort.col === col) {
      if (state.sort.dir === 1) state.sort.dir = -1;
      else { state.sort.col = null; state.sort.dir = 1; }
    } else {
      state.sort.col = col;
      state.sort.dir = 1;
    }
    render();
  }
  function mergeUniverse() {
    var map = new Map();
    state.stocks.filter(function (s) { return s && s.pool !== false && s.code; }).forEach(function (s) { map.set(codeOf(s.code), Object.assign({}, s, { inPool: true })); });
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
  function updateProgress() {
    var panel = $('combat-loading');
    var fill = $('combat-loading-fill');
    var label = $('combat-loading-label');
    var detail = $('combat-loading-detail');
    if (!panel || !fill || !label || !detail) return;
    panel.hidden = !state.loading;
    if (!state.loading) return;
    var total = state.progressTotal || 0;
    var done = state.progressDone || 0;
    var percent = total ? Math.min(100, Math.round(done / total * 100)) : 0;
    fill.style.width = percent + '%';
    var percentLabel = $('combat-loading-percent');
    var progressBar = panel.querySelector('[role="progressbar"]');
    if (percentLabel) percentLabel.textContent = total ? percent + '%' : '处理中';
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(percent));
    label.textContent = total ? '正在分析作战数据 · ' + done + '/' + total : '正在准备作战数据…';
    var elapsed = state.progressStartedAt ? Math.max(0, Math.floor((Date.now() - state.progressStartedAt) / 1000)) : 0;
    detail.textContent = '读取股票日K缓存并计算交易纪律与技术指标 · 已用时 ' + elapsed + ' 秒';
  }
  function render() {
    var summary = $('combat-summary'), list = $('combat-list'), meta = $('combat-meta');
    if (!summary || !list || !meta) return;
    var rows = state.rows;
    var counts = { add: 0, exit: 0, watch: 0, risk: 0, data: 0, tracking: 0, cooling: 0 };
    rows.forEach(function (r) {
      var kind = r.primary && r.primary.kind;
      if (kind === 'add-ready' || kind === 'add-watch') counts.add++;
      else if (kind === 'exit') counts.exit++;
      else if (kind === 'risk') counts.risk++;
      else if (kind === 'data') counts.data++;
      else counts.watch++;
      if (r.exit && r.exit.state === '跟踪中') counts.tracking++;
      if (r.exit && r.exit.cooldownDays > 0) counts.cooling++;
    });
    summary.innerHTML = [
      ['买入观察', counts.add, '低于计划入场价，评分满足条件', 'combat-good'],
      ['触发止盈', counts.exit, '收盘确认，次日复核', 'combat-exit'],
      ['止盈跟踪中', counts.tracking, '已启动，尚未触及离场线', 'combat-armed']
    ].map(function (x) {
      return '<div class="col-6 col-lg-4 col-xl-2"><div class="insight-card h-100"><div class="mini-label">' + x[0]
        + '</div><div class="combat-metric ' + x[3] + '-text">' + x[1] + '</div><div class="mini-label">' + x[2] + '</div></div></div>';
    }).join('');
    meta.textContent = (state.loading ? '正在计算 · ' : state.error ? '读取失败：' + state.error + ' · ' : '') + '覆盖 ' + rows.length + ' 只股票池标的 · 买入观察 ' + counts.add
      + ' · 触发止盈 ' + counts.exit + ' · 跟踪中 ' + counts.tracking + ' · 冷却 ' + counts.cooling
      + ' · ' + (state.lastRun ? '计算于 ' + new Date(state.lastRun).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '等待计算');
    updateProgress();
    var ordered = sortedRows(rows);
    applySortUI();
    if (!ordered.length) {
      list.innerHTML = '<tr><td colspan="' + COLUMN_COUNT + '"><div class="empty-state">' + (state.loading ? '正在分析…' : state.error ? '作战数据读取失败：' + esc(state.error) : '暂无可展示的标的。') + '</div></td></tr>';
      return;
    }
    list.innerHTML = ordered.map(function (r) {
      var s = r.stock, p = r.quote && Number(r.quote.price) > 0 ? Number(r.quote.price) : null;
      var add = r.add, exit = r.exit;
      var cooling = !!(exit && exit.cooldownDays > 0);
      var code = codeOf(s.code);
      var open = !!state.expanded[code];
      var chg = r.quote && Number.isFinite(Number(r.quote.todayChange)) ? Number(r.quote.todayChange) : null;
      var scoreReady = !!(add && add.dataReady && add.inZone && !cooling);
      var score = scoreReady ? (add.score || 0) : null;
      var scoreText = score === null ? '—' : score + '/' + (add.scoreMax || 4);
      var scoreClass = score === null ? 'combat-data-text' : score >= 3 ? 'combat-good-text' : score === 2 ? 'combat-warn-text' : 'combat-risk-text';
      var scoreSub = score !== null ? '' : cooling ? '冷却期' : !add || !add.dataReady ? '日K不足' : !add.inZone ? '未到入场' : '';
      var entryVal = Number(s.entry) > 0 ? Number(s.entry) : null;
      var entryGap = p !== null && entryVal ? (p / entryVal - 1) * 100 : null;
      var badges = '<span class="combat-badge ' + statusClass(r.primary.kind) + '">' + esc(r.primary.status) + '</span>';
      if (scoreReady) badges += '<span class="combat-badge ' + statusClass(add.kind) + '">买入评分 ' + scoreText + '</span>';
      if (exit && exit.state === '已触发') {
        badges += '<span class="combat-badge combat-exit">止盈 · 已触发</span>';
      } else if (exit && exit.state === '跟踪中') {
        badges += '<span class="combat-badge combat-armed">止盈 · 跟踪中</span>';
      } else if (cooling) {
        badges += '<span class="combat-badge combat-neutral">离场冷却 ' + exit.cooldownDays + ' 日</span>';
      }
      var plan = [Number(s.entry) > 0 ? '入场 ' + money(s.entry) : null, Number(s.heavy) > 0 ? '重仓 ' + money(s.heavy) : null, Number(s.tp1) > 0 ? '止盈1 ' + money(s.tp1) : null, Number(s.tp2) > 0 && Number(s.tp2) !== Number(s.tp1) ? '止盈2 ' + money(s.tp2) : null].filter(Boolean).join(' · ');

      var buySection;
      if (cooling) {
        buySection = '<section class="combat-buy-conditions"><div class="combat-section-title">买入检查 · 冷却期</div><div class="combat-reasons mt-2">'
          + '<span class="combat-reason-chip">止盈已触发 ' + exit.barsSinceTrigger + ' 个交易日前</span>'
          + '<span class="combat-reason-chip">冷却剩余 ' + exit.cooldownDays + ' 个交易日，不生成买入信号</span></div></section>';
      } else if (!r.inZone) {
        buySection = '<section class="combat-buy-conditions"><div class="combat-section-title">买入检查 · 未到买入区</div><div class="combat-reasons mt-2">'
          + '<span class="combat-reason-chip">' + esc((r.primary.reasons && r.primary.reasons[0]) || '现价不低于入场价') + '</span>'
          + '<span class="combat-reason-chip">规则要求现价低于入场价，不追高</span></div></section>';
      } else if (!add || !add.dataReady) {
        buySection = '<section class="combat-buy-conditions"><div class="combat-section-title">买入检查</div><div class="combat-reasons mt-2"><span class="combat-reason-chip">' + esc((add && add.reasons && add.reasons[0]) || '日K不足，无法计算') + '</span></div></section>';
      } else if (!add.inZone) {
        buySection = '<section class="combat-buy-conditions"><div class="combat-section-title">买入检查 · 未到买入区</div><div class="combat-reasons mt-2">'
          + '<span class="combat-reason-chip">现价 ' + money(p) + ' ≥ 入场价 ' + money(add.entry) + '（' + pct(add.gapPct) + '）</span>'
          + '<span class="combat-reason-chip">规则要求现价低于入场价，不追高</span></div></section>';
      } else {
        var reasons = add.reasons.slice();
        buySection = '<section class="combat-buy-conditions"><div class="combat-section-title">买入检查 · ' + (add.score || 0) + '/4 · ' + esc(add.regimeLabel || '') + '</div>'
          + '<div class="combat-reasons mt-2">' + reasons.map(function (x) { return '<span class="combat-reason-chip">' + esc(x) + '</span>'; }).join('') + '</div>'
          + '<details class="combat-review-details mt-2"><summary class="combat-section-title">核对清单 · 行情 / 计划 / 纪律</summary>'
          + '<div class="combat-reasons mt-2">' + planChecks(s, r.quote, r.primary, r.eligible).map(function (x) { return '<span class="combat-reason-chip">' + esc(x) + '</span>'; }).join('') + '</div></details></section>';
      }

      var exitSection = '';
      if (exit) {
        var exitLines = [];
        var compactExit = !exit.armed || (exit.state === '已离场' && exit.cooldownDays === 0);
        if (compactExit) {
          exitLines.push(exit.armed
            ? '本轮已结束：触发日 ' + (exit.triggerDate || '—') + '，离场线 ' + money(exit.exitLine)
            : '未启动：启动线 ' + money(exit.armLine) + '（近60日最低收盘 ' + money(exit.low60) + ' × 1.2）');
        } else {
          exitLines.push('启动线 ' + money(exit.armLine) + '（近60日最低收盘 ' + money(exit.low60) + ' × 1.2）');
          exitLines.push('离场线 ' + money(exit.exitLine) + '（启动后最高收盘 ' + money(exit.peak) + ' × 0.95）');
          exitLines.push('当前回撤 ' + (exit.drawdown === null ? '—' : exit.drawdown.toFixed(1) + '%') + '，距离场线 ' + pct(exit.distanceToExit));
          if (exit.triggerDate) exitLines.push('触发日 ' + exit.triggerDate);
        }
        exitSection = '<section class="combat-exit-panel"><div class="combat-section-title">止盈跟踪 · ' + esc(exit.state)
          + (cooling ? '（冷却 ' + exit.cooldownDays + ' 日）' : '') + '</div>'
          + '<div class="combat-reasons mt-2">' + exitLines.map(function (x) { return '<span class="combat-reason-chip">' + esc(x) + '</span>'; }).join('') + '</div>'
          + (exit.state === '已触发' ? '<details class="combat-review-details mt-2"><summary class="combat-section-title">触发说明</summary><ul class="mb-0 mt-2 ps-3">'
            + '<li>规则：近 60 日最低收盘 ×1.2 启动，启动后最高收盘回撤 5% 离场（不需要成本价）。</li>'
            + '<li>回测：367 段拉升中位 +24.1%（死拿 +9.7%），距峰值中位 −6.9%，73% 跑赢死拿。</li>'
            + '<li>执行：收盘确认，次日出；卖出后 60 个交易日内不给买回提示。</li></ul></details>' : '')
          + '</section>';
      }

      var ind = r.indicators || {};
      var macd = ind.macd;
      var indicatorPanel = '<details class="combat-indicator-details"><summary class="combat-section-title">技术指标 · RSI / MACD / MFI / 均线 / OBV</summary><div class="combat-indicator-grid mt-2">' +
        '<div class="combat-indicator"><div class="mini-label">RSI(14) · 相对强弱</div><strong>' + (ind.rsi == null ? '—' : Number(ind.rsi).toFixed(1)) + '</strong><span>' + esc(ind.rsiState || '数据不足') + ' · ' + esc(ind.rsiTrend || '—') + '</span><small>比较近期平均涨幅与平均跌幅；下跌趋势需 ≤30，回调需 25–35，上涨需 ≤45。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">MACD(12,26,9) · 趋势动能</div><strong>' + (macd ? 'DIF ' + Number(macd.dif).toFixed(3) : '—') + '</strong><span>' + esc(ind.macdState || '数据不足') + ' · ' + esc(ind.macdCross || '—') + '</span><small>柱体改善即算动能项通过；未改善则看 OBV 是否创新低。</small><small>' + (macd ? 'DEA ' + Number(macd.dea).toFixed(3) + ' · 柱 ' + Number(macd.histogram).toFixed(3) : '历史K线不足，无法计算') + '</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">MFI(14) · 资金流量</div><strong>' + (ind.mfi == null ? '—' : Number(ind.mfi).toFixed(1)) + '</strong><span>' + (ind.mfi == null ? '数据不足' : ind.mfi < 20 ? '低位（下跌趋势中否决）' : ind.mfi > 80 ? '高位' : '中间区间') + '</span><small>下跌趋势要求 ≥30（资金未持续流出）；回调/上涨要求 &lt;25。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">MA20 · 20日均线</div><strong>' + (ind.ma20 == null ? '—' : money(ind.ma20)) + '</strong><span>' + (ind.ma20 == null || p === null ? '数据不足' : p > ind.ma20 ? '现价在均线上方' : '现价在均线下方') + '</span><small>决定状态：现价≥MA20 为上涨；MA20≥MA60 为回调；否则为下跌趋势。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">OBV · 能量潮</div><strong>' + (ind.obv == null ? '—' : Math.round(ind.obv).toLocaleString('zh-CN')) + '</strong><span>' + (ind.obv == null ? '数据不足' : '累计量价方向指标') + '</span><small>上涨日加量、下跌日减量；用于动能项的第二判据。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">数据口径</div><strong>' + (ind.bars || 0) + ' 根日K</strong><span>' + (ind.bars >= 60 ? '可计算全部信号' : '历史长度不足') + '</span><small>RSI 用 14 期 Wilder 平滑；MACD 用 12/26/9；均线用前复权日 K。</small></div>' +
        '</div><div class="mini-label mt-2">读法：四项评分只决定「是否进入买入观察」，不代表可以重仓；卖出侧只有一条回撤止盈规则，不设止损。</div></details>';

      var invalidation = '<details class="combat-invalidation mt-2"><summary class="combat-section-title">计划失效 / 退出复核</summary><ul class="mb-0 mt-2 ps-3"><li>行情过期、计划长期未复核或纪律拦截时，暂停新增操作并先核验数据。</li><li>商品供需/周期转向、公司经营假设被证伪时，重新评估持有逻辑与估值。</li><li>止盈触发后按规则次日卖出；卖出后 60 个交易日内不再买回。</li><li>本规则不设止损，亏损由仓位控制承担。</li></ul></details>';

      var quoteLabel = quoteTime(r.quote);
      var reviewed = planReviewLabel(s);
      var detailId = 'combat-detail-' + code;
      var decisionReason = (r.primary && r.primary.reasons && r.primary.reasons[0])
        || (add && add.reasons && add.reasons[0])
        || (r.dataNote || '暂无明确原因，请核对行情与计划数据');
      var exitIsUrgent = !!(exit && exit.state === '已触发');
      var exitBlock = exitSection
        ? (exitIsUrgent ? exitSection
          : '<details class="combat-review-details"><summary class="combat-section-title">止盈规则与跟踪详情 · ' + esc(exit.state || '待确认') + '</summary>' + exitSection + '</details>')
        : '';
      var detail = '<div class="combat-detail" id="' + detailId + '">'
        + '<div class="combat-decision-summary"><div><span class="mini-label">当前结论</span><div class="combat-decision-status ' + statusClass(r.primary.kind) + '-text">' + esc(r.primary.status) + '</div></div>'
        + '<div><span class="mini-label">判断依据</span><div class="combat-decision-reason">' + esc(decisionReason) + '</div></div>'
        + '<div><span class="mini-label">买入评分</span><div class="combat-decision-score">' + scoreText + '</div></div></div>'
        + '<div class="combat-detail-meta"><span>' + esc(plan || '未配置计划价') + '</span>'
        + '<span>' + esc(quoteLabel) + '</span><span>' + esc(reviewed) + '</span></div>'
        + '<details class="combat-review-details"><summary class="combat-section-title">买入依据与纪律核对</summary>' + buySection + '</details>'
        + exitBlock + indicatorPanel + invalidation
        + '<div class="mini-label">' + esc(r.dataNote || '辅助参考，不构成投资建议') + ' · 计划价需结合最新基本面与商品周期复核</div>'
        + '</div>';
      var name = esc(s.name || s.code);
      return '<tr class="combat-row' + (open ? ' is-open' : '') + '" data-code="' + esc(code) + '">'
        + '<td><button type="button" class="combat-toggle" data-combat-toggle="' + esc(code) + '" data-name="' + name + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + detailId + '" aria-label="' + (open ? '收起' : '展开') + name + '详情"><span class="combat-caret" aria-hidden="true">▸</span></button>'
        + '<a class="combat-name" href="stock.html?code=' + encodeURIComponent(s.code) + '">' + name + '</a></td>'
        + '<td class="price-cell">' + (p === null ? '—' : money(p)) + (chg === null ? '' : '<span class="combat-cell-sub ' + (chg > 0 ? 'text-up' : chg < 0 ? 'text-down' : '') + '">' + pct(chg) + '</span>') + '</td>'
        + '<td><span class="combat-signal ' + statusClass(r.primary.kind) + '-text">' + esc(r.primary.status) + '</span></td>'
        + '<td><span class="' + scoreClass + '">' + scoreText + '</span>' + (scoreSub ? '<span class="combat-cell-sub">' + scoreSub + '</span>' : '') + '</td>'
        + '<td>' + money(entryVal) + (entryGap === null ? '' : '<span class="combat-cell-sub ' + (entryGap > 0 ? 'text-up' : entryGap < 0 ? 'text-down' : '') + '">' + pct(entryGap) + '</span>') + '</td>'
        + '<td>' + (Number(s.heavy) > 0 ? money(s.heavy) : '—') + '</td>'
        + '<td>' + esc(exit && exit.state ? exit.state : '—') + '</td>'
        + '<td>' + (exit ? money(exit.armed ? exit.exitLine : exit.armLine) : '—') + '</td>'
        + '<td>' + (r.indicators && r.indicators.bars ? r.indicators.bars + ' 根' : '—') + '</td>'
        + '</tr>'
        + '<tr class="combat-detail-row"' + (open ? '' : ' hidden') + '><td colspan="' + COLUMN_COUNT + '">' + detail + '</td></tr>';
    }).join('');
    applyExpanded();
    sizeDetailCells();
  }
  // 展开区随可视宽度自适应，横向滚动时仍完整可读
  function sizeDetailCells() {
    if (!root.document || typeof root.document.querySelector !== 'function') return;
    var scroll = root.document.querySelector('.combat-table-scroll');
    var list = $('combat-list');
    if (!scroll || !list || !list.querySelectorAll) return;
    var width = scroll.clientWidth || 0;
    if (!width) return;
    Array.prototype.forEach.call(list.querySelectorAll('.combat-detail'), function (el) {
      el.style.width = width + 'px';
    });
  }
  function toggleRow(code) {
    if (!code) return;
    if (state.expanded[code]) delete state.expanded[code];
    else state.expanded[code] = true;
    applyExpanded();
  }
  function applyExpanded() {
    var list = $('combat-list');
    if (!list || !list.querySelectorAll) return;
    Array.prototype.forEach.call(list.querySelectorAll('.combat-row'), function (row) {
      var on = !!state.expanded[row.getAttribute('data-code')];
      row.classList.toggle('is-open', on);
      var btn = row.querySelector('[data-combat-toggle]');
      if (btn) {
        btn.setAttribute('aria-expanded', on ? 'true' : 'false');
        btn.setAttribute('aria-label', (on ? '收起' : '展开') + (btn.getAttribute('data-name') || '') + '详情');
      }
      var detail = row.nextElementSibling;
      if (detail && detail.className && String(detail.className).indexOf('combat-detail-row') >= 0) detail.hidden = !on;
    });
  }
  async function calculateOne(stock, combatSnapshot) {
    var code = codeOf(stock.code), quote = quoteFor(code), price = quote && Number(quote.price) > 0 ? Number(quote.price) : null;
    var eligible = gate(stock, quote), add = null, exit = null, dataNote = '', day = null, indicators = null;
    var entry = Number(stock && stock.entry);
    var inZone = entry > 0 && price < entry;
    if (price === null) {
      var missing = { status: '数据不足', kind: 'data', reasons: ['当前行情无有效价格，不使用过期空值推断'], dataReady: false };
      return { stock: stock, quote: quote, primary: missing, add: null, exit: null, eligible: eligible, dataNote: '行情缺失' };
    }
    var bars = [];
    if (combatSnapshot) {
      var stockSnapshot = combatSnapshot.stocks && combatSnapshot.stocks[code];
      bars = stockSnapshot && Array.isArray(stockSnapshot.bars) ? stockSnapshot.bars : [];
    } else {
      // Compatibility path for tests/older clients; production static client uses one bulk snapshot.
      try { day = await state.client.fetchKline(code, { period: 'day', count: 120, adjust: 'qfq' }); } catch (_) {}
      bars = day && Array.isArray(day.bars) ? day.bars : [];
    }
    if (root.TechInd && bars.length) {
      var rsiRes = root.TechInd.rsi ? root.TechInd.rsi(bars, 14) : null;
      var macdRes = root.TechInd.macd ? root.TechInd.macd(bars, 12, 26, 9) : null;
      var mfiRes = root.TechInd.mfi ? root.TechInd.mfi(bars, 14) : null;
      var maRes = root.TechInd.ma ? root.TechInd.ma(bars, 20) : null;
      var obvRes = root.TechInd.obv ? root.TechInd.obv(bars) : null;
      var rsiValue = rsiRes ? rsiRes.latest : null;
      var rsiPrev = rsiRes && rsiRes.series.length > 1 ? rsiRes.series[rsiRes.series.length - 2] : null;
      var macdValue = macdRes ? macdRes.latest : null;
      var macdPrev = macdRes && macdRes.histogram.length > 1 ? macdRes.histogram[macdRes.histogram.length - 2] : null;
      indicators = {
        bars: bars.length,
        rsi: rsiValue,
        rsiTrend: rsiValue === null || rsiPrev === null ? '数据不足' : rsiValue > rsiPrev ? '回升' : rsiValue < rsiPrev ? '回落' : '持平',
        rsiState: rsiValue === null ? '数据不足' : rsiValue < 30 ? '超卖区' : rsiValue < 45 ? '偏弱' : rsiValue <= 55 ? '中性' : rsiValue < 70 ? '偏强' : '超买区',
        macd: macdValue,
        macdState: macdValue === null ? '数据不足' : macdValue.dif > macdValue.dea ? (macdValue.histogram >= 0 ? '多头动能' : '偏多改善') : (macdPrev !== null && macdValue.histogram > macdPrev ? '空头动能减弱' : '偏空'),
        macdCross: macdValue && macdRes.dif.length > 1 && macdRes.dea.length > 1 && macdRes.dif[macdRes.dif.length - 2] !== null && macdRes.dea[macdRes.dea.length - 2] !== null ? (macdValue.dif > macdValue.dea && macdRes.dif[macdRes.dif.length - 2] <= macdRes.dea[macdRes.dea.length - 2] ? '金叉' : macdValue.dif < macdValue.dea && macdRes.dif[macdRes.dif.length - 2] >= macdRes.dea[macdRes.dea.length - 2] ? '死叉' : '未新交叉') : '数据不足',
        mfi: mfiRes ? mfiRes.latest : null,
        ma20: maRes ? maRes.latest : null,
        obv: obvRes ? obvRes.latest : null
      };
    }
    if (root.StockTradeSignals) {
      // 买入信号只在现价低于计划入场价时计算，避免在高位生成买入建议。
      if (inZone) add = root.StockTradeSignals.evaluateAdd(price, Object.assign({}, stock), bars);
      exit = root.StockTradeSignals.evaluateExit(price, Object.assign({}, stock), bars);
    }
    var primary;
    if (exit && exit.state === '已触发') {
      primary = { status: '触发止盈', kind: 'exit', reasons: exit.reasons.slice(0, 2) };
    } else if (exit && exit.cooldownDays > 0) {
      primary = { status: '离场冷却中', kind: 'watch', reasons: ['止盈已触发 ' + exit.barsSinceTrigger + ' 个交易日前，冷却剩余 ' + exit.cooldownDays + ' 个交易日', '冷却期内不生成买入信号'] };
    } else if (!inZone) {
      primary = {
        status: entry > 0 ? '高于入场价' : '未配置入场价', kind: 'watch',
        reasons: [entry > 0
          ? '现价 ' + price.toFixed(2) + ' ≥ 入场价 ' + entry.toFixed(2) + '（' + ((price / entry - 1) * 100).toFixed(1) + '%），不追高'
          : '计划未配置入场价，不生成买入信号']
      };
    } else if (add && !eligible.eligible) {
      primary = { status: '风险拦截', kind: 'risk', reasons: [eligible.reason || '未通过买入纪律门槛', '价格到计划区不代表允许买入'] };
    } else if (add && add.kind === 'add-ready') {
      primary = { status: add.status, kind: 'add-ready', reasons: add.reasons.slice(0, 3) };
    } else if (add && add.kind === 'add-watch') {
      primary = { status: add.status, kind: 'add-watch', reasons: add.reasons.slice(0, 3) };
    } else if (add && add.kind === 'data') {
      primary = { status: '数据不足', kind: 'data', reasons: add.reasons };
    } else {
      primary = { status: add ? add.status : '观望', kind: 'watch', reasons: add ? add.reasons.slice(0, 2) : ['暂无信号'] };
    }
    dataNote = '日K ' + (bars.length ? bars.length + ' 根' : '不可用') + (exit && exit.state !== '数据不足' ? ' · 止盈' + exit.state : '');
    return { stock: stock, quote: quote, primary: primary, add: add, exit: exit, eligible: eligible, indicators: indicators, inZone: inZone, entry: entry, dataNote: dataNote };
  }
  async function run() {
    if (state.loading) return;
    if (!state.client || !Array.isArray(state.stocks)) return;
    state.loading = true; state.error = ''; state.progressDone = 0; state.progressTotal = 0; state.progressStartedAt = Date.now(); updateProgress(); if (state.progressTimer) root.clearInterval(state.progressTimer); state.progressTimer = root.setInterval(updateProgress, 1000); render();
    try {
      var universe = mergeUniverse();
      state.progressTotal = universe.length; state.progressDone = 0; updateProgress();
      state.rows = universe.map(function (stock) { return { stock: stock, quote: quoteFor(stock.code), primary: { status: '计算中', kind: 'data', reasons: [] }, add: null, exit: null }; });
      render();
      var combatSnapshot = null;
      if (typeof state.client.fetchCombatKlines === 'function') {
        try {
          // One same-origin request for the whole universe replaces 60+ full cache downloads.
          combatSnapshot = await state.client.fetchCombatKlines();
        } catch (snapshotError) {
          state.error = '作战日 K 快照读取失败：' + (snapshotError && snapshotError.message || '数据不可用');
          combatSnapshot = { stocks: {} };
        }
      }
      var results = [];
      await limitedMap(universe, 8, async function (stock) {
        try {
          results.push(await calculateOne(stock, combatSnapshot));
        } catch (e) {
          // Preserve coverage when one symbol fails; never silently drop it from the combat universe.
          results.push({ stock: stock, quote: quoteFor(stock.code), primary: { status: '数据不足', kind: 'data', reasons: ['单股计算失败：' + (e && e.message || '未知错误'), '本次不生成交易信号，请刷新复核'] }, add: null, exit: null, dataNote: '计算异常，未生成交易信号' });
        } finally {
          state.progressDone++;
          updateProgress();
        }
      });
      state.rows = results.sort(function (a, b) {
        // 卖出信号优先于买入信号；风险与数据不足排在后面。
        var rank = function (r) {
          if (r.primary.kind === 'exit') return 0;
          if (r.primary.kind === 'add-ready') return 1;
          if (r.primary.kind === 'add-watch') return 2;
          if (r.primary.kind === 'risk') return 3;
          if (r.primary.kind === 'watch') return 4;
          if (r.primary.kind === 'data') return 5;
          return 4;
        };
        var diff = rank(a) - rank(b);
        if (diff) return diff;
        var signalScore = function (r) {
          var score = 0;
          if (r.primary.kind === 'add-ready') score += 25 + (Number(r.add && r.add.score) || 0);
          if (r.primary.kind === 'add-watch') score += 10 + (Number(r.add && r.add.score) || 0);
          if (r.primary.kind === 'exit') score += 30 + (r.exit && r.exit.drawdown ? Math.abs(r.exit.drawdown) : 0);
          return score;
        };
        return signalScore(b) - signalScore(a) || String(a.stock.name || '').localeCompare(String(b.stock.name || ''), 'zh');
      });
      state.lastRun = Date.now();
    } catch (e) { state.error = e && e.message || '读取作战数据失败'; }
    state.loading = false;
    if (state.progressTimer) { root.clearInterval(state.progressTimer); state.progressTimer = null; }
    updateProgress();
    render();
  }
  function ensureUi() {
    var list = $('combat-list');
    var table = $('combat-table');
    if (table && !table.dataset.combatSortBound) {
      table.dataset.combatSortBound = '1';
      table.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var btn = target.closest('[data-combat-sort]');
        if (!btn) return;
        sortBy(btn.getAttribute('data-combat-sort'));
      });
      applySortUI();
    }
    if (list && !list.dataset.combatExpandBound) {
      list.dataset.combatExpandBound = '1';
      list.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.closest) return;
        if (target.closest('a, summary')) return;
        var toggle = target.closest('[data-combat-toggle]');
        var row = toggle ? toggle.closest('tr') : target.closest('tr.combat-row');
        if (!row || !row.getAttribute) return;
        toggleRow(row.getAttribute('data-code'));
      });
    }
    if (root.addEventListener && !state.resizeBound) {
      state.resizeBound = true;
      root.addEventListener('resize', sizeDetailCells);
    }
  }
  function init(stocks, prices, client) {

    state.stocks = Array.isArray(stocks) ? stocks : [];
    state.prices = prices || {};
    state.client = client || null;
    state.initialized = true;
    ensureUi();
  }
  function onTab(target) {
    if (target === 'combat' && state.initialized && (!state.lastRun || Date.now() - state.lastRun > 180000)) return run();
  }
  root.StockCombat = { init: init, onTab: onTab };
  if (root.document) root.document.addEventListener('DOMContentLoaded', ensureUi);
})(typeof window !== 'undefined' ? window : globalThis);
