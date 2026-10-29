/* Home trading combat center: manual decision support only, never submits orders. */
(function (root) {
  'use strict';
  var state = { stocks: [], prices: {}, client: null, rows: [], initialized: false, loading: false, lastRun: 0, filter: 'all', error: '' };
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
  function render() {
    var summary = $('combat-summary'), list = $('combat-list'), meta = $('combat-meta');
    if (!summary || !list || !meta) return;
    var rows = state.rows;
    // 概览数字与筛选器含义保持一致，避免同一状态两种叫法。
    var matches = function (r, filter) {
      if (filter === 'add') return r.primary.kind === 'add-ready' || r.primary.kind === 'add-watch';
      if (filter === 'exit') return r.primary.kind === 'exit';
      if (filter === 'watch') return r.primary.kind === 'watch';
      if (filter === 'risk') return r.primary.kind === 'risk';
      if (filter === 'data') return r.primary.kind === 'data';
      return true;
    };
    var counts = { add: 0, exit: 0, watch: 0, risk: 0, data: 0, tracking: 0, cooling: 0 };
    rows.forEach(function (r) {
      ['add', 'exit', 'watch', 'risk', 'data'].forEach(function (key) { if (matches(r, key)) counts[key]++; });
      if (r.exit && r.exit.state === '跟踪中') counts.tracking++;
      if (r.exit && r.exit.cooldownDays > 0) counts.cooling++;
    });
    summary.innerHTML = [
      ['买入观察', counts.add, '现价低于入场价且评分≥2', 'combat-good'],
      ['触发止盈', counts.exit, '近 3 日触发，次日确认', 'combat-exit'],
      ['止盈跟踪中', counts.tracking, '已启动，未到离场线', 'combat-armed'],
      ['离场冷却', counts.cooling, '60 个交易日内不买回', 'combat-neutral'],
      ['风险拦截', counts.risk, '纪律门槛优先', 'combat-risk'],
      ['数据不足', counts.data, '不生成确定信号', 'combat-data']
    ].map(function (x) {
      return '<div class="col-6 col-lg-4 col-xl-2"><div class="insight-card h-100"><div class="mini-label">' + x[0]
        + '</div><div class="combat-metric ' + x[3] + '-text">' + x[1] + '</div><div class="mini-label">' + x[2] + '</div></div></div>';
    }).join('');
    meta.textContent = (state.error ? '读取失败：' + state.error + ' · ' : '') + '覆盖 ' + rows.length + ' 只股票池标的 · 买入观察 ' + counts.add
      + ' · 触发止盈 ' + counts.exit + ' · 跟踪中 ' + counts.tracking + ' · 冷却 ' + counts.cooling
      + ' · ' + (state.lastRun ? '计算于 ' + new Date(state.lastRun).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '等待计算');
    var filtered = rows.filter(function (r) { return matches(r, state.filter); });
    if (!filtered.length) {
      list.innerHTML = '<div class="empty-state">' + (state.loading ? '正在分析…' : state.error ? '作战数据读取失败：' + esc(state.error) : '当前筛选下没有标的。可切换筛选或刷新。') + '</div>';
      return;
    }
    list.innerHTML = filtered.map(function (r) {
      var s = r.stock, p = r.quote && Number(r.quote.price) > 0 ? Number(r.quote.price) : null;
      var add = r.add, exit = r.exit;
      var cooling = !!(exit && exit.cooldownDays > 0);
      var badges = '<span class="combat-badge ' + statusClass(r.primary.kind) + '">' + esc(r.primary.status) + '</span>';
      if (add && add.dataReady && add.inZone && !cooling) {
        badges += '<span class="combat-badge ' + statusClass(add.kind) + '">买入评分 ' + (add.score || 0) + '/' + (add.scoreMax || 4) + '</span>';
      }
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
          + '<div class="combat-reasons mt-2">' + planChecks(s, r.quote, r.primary, r.eligible).map(function (x) { return '<span class="combat-reason-chip">' + esc(x) + '</span>'; }).join('') + '</div></section>';
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
          + (exit.state === '已触发' ? '<div class="combat-invalidation mt-2"><div class="combat-section-title">触发说明</div><ul class="mb-0 mt-1 ps-3">'
            + '<li>规则：近 60 日最低收盘 ×1.2 启动，启动后最高收盘回撤 5% 离场（不需要成本价）。</li>'
            + '<li>回测：367 段拉升中位 +24.1%（死拿 +9.7%），距峰值中位 −6.9%，73% 跑赢死拿。</li>'
            + '<li>执行：收盘确认，次日出；卖出后 60 个交易日内不给买回提示。</li></ul></div>' : '')
          + '</section>';
      }

      var ind = r.indicators || {};
      var macd = ind.macd;
      var indicatorPanel = '<details class="combat-indicator-details"><summary class="combat-section-title">技术指标详情（点击展开）</summary><div class="combat-indicator-grid mt-2">' +
        '<div class="combat-indicator"><div class="mini-label">RSI(14) · 相对强弱</div><strong>' + (ind.rsi == null ? '—' : Number(ind.rsi).toFixed(1)) + '</strong><span>' + esc(ind.rsiState || '数据不足') + ' · ' + esc(ind.rsiTrend || '—') + '</span><small>比较近期平均涨幅与平均跌幅；下跌趋势需 ≤30，回调需 25–35，上涨需 ≤45。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">MACD(12,26,9) · 趋势动能</div><strong>' + (macd ? 'DIF ' + Number(macd.dif).toFixed(3) : '—') + '</strong><span>' + esc(ind.macdState || '数据不足') + ' · ' + esc(ind.macdCross || '—') + '</span><small>柱体改善即算动能项通过；未改善则看 OBV 是否创新低。</small><small>' + (macd ? 'DEA ' + Number(macd.dea).toFixed(3) + ' · 柱 ' + Number(macd.histogram).toFixed(3) : '历史K线不足，无法计算') + '</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">MFI(14) · 资金流量</div><strong>' + (ind.mfi == null ? '—' : Number(ind.mfi).toFixed(1)) + '</strong><span>' + (ind.mfi == null ? '数据不足' : ind.mfi < 20 ? '低位（下跌趋势中否决）' : ind.mfi > 80 ? '高位' : '中间区间') + '</span><small>下跌趋势要求 ≥30（资金未持续流出）；回调/上涨要求 &lt;25。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">MA20 · 20日均线</div><strong>' + (ind.ma20 == null ? '—' : money(ind.ma20)) + '</strong><span>' + (ind.ma20 == null || p === null ? '数据不足' : p > ind.ma20 ? '现价在均线上方' : '现价在均线下方') + '</span><small>决定状态：现价≥MA20 为上涨；MA20≥MA60 为回调；否则为下跌趋势。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">OBV · 能量潮</div><strong>' + (ind.obv == null ? '—' : Math.round(ind.obv).toLocaleString('zh-CN')) + '</strong><span>' + (ind.obv == null ? '数据不足' : '累计量价方向指标') + '</span><small>上涨日加量、下跌日减量；用于动能项的第二判据。</small></div>' +
        '<div class="combat-indicator"><div class="mini-label">数据口径</div><strong>' + (ind.bars || 0) + ' 根日K</strong><span>' + (ind.bars >= 60 ? '可计算全部信号' : '历史长度不足') + '</span><small>RSI 用 14 期 Wilder 平滑；MACD 用 12/26/9；均线用前复权日 K。</small></div>' +
        '</div><div class="mini-label mt-2">读法：四项评分只决定「是否进入买入观察」，不代表可以重仓；卖出侧只有一条回撤止盈规则，不设止损。</div></details>';

      var invalidation = '<div class="combat-invalidation mt-2"><div class="combat-section-title">计划失效 / 退出复核</div><ul class="mb-0 mt-1 ps-3"><li>行情过期、计划长期未复核或纪律拦截时，暂停新增操作并先核验数据。</li><li>商品供需/周期转向、公司经营假设被证伪时，重新评估持有逻辑与估值。</li><li>止盈触发后按规则次日卖出；卖出后 60 个交易日内不再买回。</li><li>本规则不设止损，亏损由仓位控制承担。</li></ul></div>';

      var quoteLabel = quoteTime(r.quote);
      var reviewed = planReviewLabel(s);
      return '<article class="insight-card combat-card"><div class="d-flex justify-content-between align-items-start gap-2"><div class="min-w-0"><a class="combat-name" href="stock.html?code=' + encodeURIComponent(s.code) + '">' + esc(s.name || s.code) + '</a><div class="mini-label">' + esc(s.code) + ' · 股票池 / 自选</div><div class="mini-label">' + esc(quoteLabel) + '</div></div><div class="text-end flex-shrink-0"><div class="combat-price">' + (p === null ? '—' : money(p)) + '</div><div class="mini-label ' + (r.quote && Number(r.quote.todayChange) > 0 ? 'text-up' : r.quote && Number(r.quote.todayChange) < 0 ? 'text-down' : '') + '">' + (r.quote ? pct(r.quote.todayChange) : '行情缺失') + '</div></div></div><div class="d-flex flex-wrap gap-1 mt-2">' + badges + '</div><div class="combat-plan mt-2">' + esc(plan || '未配置计划价') + '<div class="mini-label mt-1">' + esc(reviewed) + ' · 计划价需结合最新基本面与周期复核</div></div>' + buySection + exitSection + indicatorPanel + invalidation + '<div class="d-flex justify-content-between align-items-center gap-2 mt-3"><span class="mini-label">' + esc(r.dataNote || '辅助参考，不构成投资建议') + '</span></div></article>';
    }).join('');
  }
  async function calculateOne(stock) {
    var code = codeOf(stock.code), quote = quoteFor(code), price = quote && Number(quote.price) > 0 ? Number(quote.price) : null;
    var eligible = gate(stock, quote), add = null, exit = null, dataNote = '', day = null, indicators = null;
    var entry = Number(stock && stock.entry);
    var inZone = entry > 0 && price < entry;
    if (price === null) {
      var missing = { status: '数据不足', kind: 'data', reasons: ['当前行情无有效价格，不使用过期空值推断'], dataReady: false };
      return { stock: stock, quote: quote, primary: missing, add: null, exit: null, eligible: eligible, dataNote: '行情缺失' };
    }
    try { day = await state.client.fetchKline(code, { period: 'day', count: 120, adjust: 'qfq' }); } catch (_) {}
    var bars = day && Array.isArray(day.bars) ? day.bars : [];
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
    state.loading = true; state.error = ''; render();
    try {
      var universe = mergeUniverse();
      state.rows = universe.map(function (stock) { return { stock: stock, quote: quoteFor(stock.code), primary: { status: '计算中', kind: 'data', reasons: [] }, add: null, exit: null }; });
      render();
      var results = [];
      await limitedMap(universe, 4, async function (stock) {
        try {
          results.push(await calculateOne(stock));
        } catch (e) {
          // Preserve coverage when one symbol fails; never silently drop it from the combat universe.
          results.push({ stock: stock, quote: quoteFor(stock.code), primary: { status: '数据不足', kind: 'data', reasons: ['单股计算失败：' + (e && e.message || '未知错误'), '本次不生成交易信号，请刷新复核'] }, add: null, exit: null, dataNote: '计算异常，未生成交易信号' });
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
    render();
  }
  function ensureUi() {
    ['combat-filter-all','combat-filter-add','combat-filter-exit','combat-filter-watch','combat-filter-risk','combat-filter-data'].forEach(function (id) {
      var el = $(id); if (!el || el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('click', function () {
        state.filter = id === 'combat-filter-all' ? 'all' : id.replace('combat-filter-', '');
        root.document.querySelectorAll('[data-combat-filter]').forEach(function (b) {
          var active = b.id === id;
          b.classList.toggle('active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        render();
      });
    });
    // 初始按下状态与 state.filter 对齐
    if (!root.document.querySelectorAll) return;
    var activeId = state.filter === 'all' ? 'combat-filter-all' : 'combat-filter-' + state.filter;
    root.document.querySelectorAll('[data-combat-filter]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.id === activeId));
    });
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
