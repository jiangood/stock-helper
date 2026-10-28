/*!
 * 鳄鱼纪律 Croc v1.0.0
 * ---------------------------------------------------------------------------
 * 把「周期为王：寒武纪鳄鱼的低位价值投资法」里可量化的纪律，做成页面共用的小工具：
 *   · 净资产八折（PB ≤ 0.8）
 *   · 市值 200 亿以内
 *   · PE 30 倍高低锚
 *   · 不买 ST / 亏损股
 *   · 入场区 / 重仓区判断
 *   · 连续涨停（卖其疯狂）识别
 *   · 月 K 历史分位
 *   · 股票池筛选（ST / 亏损 / PE / 市值 / 破净）与「纪律全过」判定
 *   · 股票池数据体检、每日简报
 *
 * 浏览器：window.Croc；Node：module.exports
 * ---------------------------------------------------------------------------
 */
(function (global, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    global.Croc = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const VERSION = '1.1.0';
  const SMALL_CAP = 2e10;      // 200 亿（元）
  const PB_GOLDEN = 0.8;       // 净资产八折
  const PE_HIGH = 30;          // 30 倍估值算高

  const isNum = v => typeof v === 'number' && isFinite(v);

  const num = v => {
    if (v === null || v === undefined || v === '' || v === '-') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  /** 名称是否带 ST / *ST / SST 风险警示 */
  function isST(name) {
    return /^(S\*?)?\*?ST/i.test(String(name || '').trim());
  }

  /** 买入区间：heavy（重仓区） < entry（入场区） < above（偏高） */
  function zoneOf(stock, price) {
    const p = num(price);
    if (p === null || p <= 0 || !stock) return 'unknown';
    const heavy = num(stock.heavy);
    const entry = num(stock.entry);
    // 重仓价高于入场价属于数据异常，按入场价判断，避免把中间价位误判为重仓区
    if (heavy !== null && entry !== null && heavy > entry) {
      if (p <= entry) return 'entry';
      return 'above';
    }
    if (heavy !== null && p <= heavy) return 'heavy';
    if (entry !== null && p <= entry) return 'entry';
    if (entry !== null) return 'above';
    return 'unknown';
  }

  /**
   * 把一只股票的计划 + 行情，压成一份可展示的纪律状态
   * @param {object} stock stocks.json 中的一项
   * @param {object|null} quote 行情（fetch / fetchDetail）
   */
  function evaluate(stock, quote) {
    const s = stock || {};
    const q = quote || {};
    const price = num(q.price);
    const pb = num(q.pb);
    const pe = num(q.pe != null ? q.pe : q.peTtm);
    const cap = num(q.totalCap);
    const nav = num(q.navPerShare);
    const entry = num(s.entry);
    const heavy = num(s.heavy);

    return {
      code: s.code || null,
      name: q.name || s.name || '',
      price,
      pb,
      pe,
      cap,
      nav,
      zone: zoneOf(s, price),
      st: isST(s.name) || isST(q.name),
      loss: pe !== null && pe < 0,
      pbUnder1: pb !== null && pb > 0 && pb < 1,
      pbGolden: pb !== null && pb > 0 && pb <= PB_GOLDEN,
      smallCap: cap !== null && cap > 0 && cap <= SMALL_CAP,
      navGolden: nav !== null && nav > 0 ? nav * PB_GOLDEN : null,
      toEntry: price !== null && entry !== null && entry > 0 ? (price / entry - 1) * 100 : null,
      toHeavy: price !== null && heavy !== null && heavy > 0 ? (price / heavy - 1) * 100 : null
    };
  }

  /**
   * 可量化的选股纪律清单（对应资料里的铁律与估值锚）
   *   非 ST、非亏损、PE≤30、市值≤200 亿、PB<1（破净）
   * @param {object} stock
   * @param {object|null} quote
   * @returns {{checks:Array, passed:number, total:number, known:number,
   *            complete:boolean, allPass:boolean, failed:Array, pending:Array}}
   */
  function screen(stock, quote) {
    const q = quote || {};
    const e = evaluate(stock, q);
    const checks = [
      { key: 'st',   label: 'ST',   ok: !e.st, known: true },
      { key: 'loss', label: '亏损', ok: e.pe !== null && e.pe > 0, known: e.pe !== null },
      { key: 'pe',   label: 'PE30', ok: e.pe !== null && e.pe > 0 && e.pe <= PE_HIGH, known: e.pe !== null },
      { key: 'cap',  label: '市值', ok: e.cap !== null && e.cap > 0 && e.cap <= SMALL_CAP, known: e.cap !== null },
      { key: 'pb',   label: '破净', ok: e.pb !== null && e.pb > 0 && e.pb < 1, known: e.pb !== null }
    ];
    const failed = checks.filter(c => c.known && !c.ok);
    const pending = checks.filter(c => !c.known);
    const known = checks.length - pending.length;
    return {
      checks,
      passed: checks.filter(c => c.ok).length,
      total: checks.length,
      known,
      complete: pending.length === 0,
      allPass: pending.length === 0 && failed.length === 0,
      failed,
      pending,
      e
    };
  }

  /** 首页状态筛选 */
  function matchStatus(stock, quote, key) {
    if (!key) return true;
    const e = evaluate(stock, quote);
    const s = stock || {};
    const heavy = num(s.heavy);
    const entry = num(s.entry);
    const heavyUsable = heavy !== null && (entry === null || heavy <= entry);
    switch (key) {
      case 'heavy':   return e.zone === 'heavy';
      case 'near':    return heavyUsable && e.price !== null && e.price > heavy && e.price <= heavy * 1.03;
      case 'entry':   return e.zone === 'heavy' || e.zone === 'entry';
      case 'pb':      return e.pbUnder1;
      case 'pb80':    return e.pbGolden;
      case 'small':   return e.smallCap;
      case 'risk':    return e.st || e.loss;
      case 'above':   return e.zone === 'above';
      case 'screen':  return screen(stock, quote).allPass;
      case 'screenbuy': {
        const sc = screen(stock, quote);
        return sc.allPass && (e.zone === 'heavy' || e.zone === 'entry');
      }
      default:        return true;
    }
  }

  /** 涨跌停幅度（%）：创业板/科创板 20，北交所 30，ST 5，其余 10 */
  function limitUpPct(code, name) {
    const c = String(code || '');
    const six = c.slice(-6);
    if (/^(300|301|688|689)/.test(six)) return 20;
    if (/^(8|4|92)/.test(six)) return 30;
    if (isST(name)) return 5;
    return 10;
  }

  /**
   * 最近连续涨停 / 涨停打开
   * @param {Array<{time:string, close:number, high:number}>} bars 日 K（前复权）
   * @returns {{count:number, pct:number, opened:boolean, lastDate:string, limitPrice:number}|null}
   */
  function limitUpInfo(bars, code, name) {
    if (!Array.isArray(bars) || bars.length < 2) return null;
    const pct = limitUpPct(code, name);
    const thr = pct - 0.2;

    let count = 0;
    for (let i = bars.length - 1; i > 0; i--) {
      const prev = num(bars[i - 1].close);
      const cur = num(bars[i].close);
      if (prev === null || cur === null || prev <= 0) break;
      if ((cur / prev - 1) * 100 >= thr) count++;
      else break;
    }

    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const prevClose = num(prev.close);
    const limitPrice = prevClose ? Math.round(prevClose * (1 + pct / 100) * 100) / 100 : null;
    const opened = !!(limitPrice && num(last.high) !== null && last.high >= limitPrice - 0.005
      && num(last.close) < limitPrice - 0.005);

    return { count, pct, opened, lastDate: last.time || '', limitPrice };
  }

  /** 当前值在一组数值中的分位（0-100） */
  function percentile(values, current) {
    const list = (values || []).map(num).filter(v => v !== null);
    const cur = num(current);
    if (!list.length || cur === null) return null;
    let below = 0;
    for (const v of list) if (v <= cur) below++;
    return below / list.length * 100;
  }

  const yi = v => isNum(v) ? v / 1e8 : null;

  /**
   * 股票池数据体检
   * @param {Array} stocks
   * @param {Object<string, object>} [quotes]
   * @returns {{issues:Array, errors:number, warnings:number, risks:number}}
   */
  function health(stocks, quotes) {
    const list = Array.isArray(stocks) ? stocks : [];
    const map = quotes || {};
    const issues = [];
    const seen = new Set();

    const push = (level, stock, text) => issues.push({
      level,
      name: (stock && stock.name) || '未命名',
      code: (stock && stock.code) || '',
      text
    });

    for (const s of list) {
      if (!s || !s.name) { push('error', s, '缺少名称'); continue; }
      const code = String(s.code || '').toLowerCase();
      if (!/^(sh|sz)\d{6}$/.test(code)) {
        push('error', s, '代码格式应为 sh/sz + 6 位数字');
      } else if (seen.has(code)) {
        push('error', s, '代码重复');
      } else {
        seen.add(code);
      }

      if (num(s.entry) === null && num(s.heavy) === null) {
        push('warn', s, '入场价与重仓价都未设置');
      }
      if (num(s.entry) !== null && num(s.heavy) !== null && s.heavy > s.entry) {
        push('warn', s, `重仓价 ${s.heavy} 高于入场价 ${s.entry}，区间可能写反`);
      }

      // updDate 代表计划价格最近一次人工复核日期，不是行情时间戳。
      const updDate = String(s.updDate || '').trim();
      if (!updDate) {
        push('warn', s, '缺少计划更新时间，入场/重仓/止盈价需人工复核');
      } else if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(updDate)) {
        push('warn', s, `计划更新时间格式无效：${updDate}`);
      } else {
        const parts = updDate.split('-').map(Number);
        const reviewedAt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        const validDate = reviewedAt.getUTCFullYear() === parts[0]
          && reviewedAt.getUTCMonth() === parts[1] - 1
          && reviewedAt.getUTCDate() === parts[2];
        if (!validDate) {
          push('warn', s, `计划更新时间不是有效日期：${updDate}`);
        } else {
          const ageDays = Math.floor((Date.now() - reviewedAt.getTime()) / 86400000);
          if (ageDays < 0) {
            push('warn', s, `计划更新时间在未来：${updDate}`);
          } else if (ageDays > 180) {
            push('warn', s, `计划价格已 ${ageDays} 天未复核（最近：${updDate}）`);
          }
        }
      }
      if (num(s.entry) !== null && num(s.tp1) !== null && s.tp1 <= s.entry) {
        push('warn', s, `止盈1 ${s.tp1} 不高于入场价 ${s.entry}`);
      }
      if (num(s.tp1) !== null && num(s.tp2) !== null && s.tp2 < s.tp1) {
        push('warn', s, `止盈2 ${s.tp2} 低于止盈1 ${s.tp1}`);
      }

      const e = evaluate(s, map[code]);
      if (e.st) push('risk', s, 'ST 风险警示股（铁律：不买 ST）');
      if (e.loss) push('risk', s, 'TTM 亏损（铁律：不买亏损股）');
    }

    return {
      issues,
      errors: issues.filter(x => x.level === 'error').length,
      warnings: issues.filter(x => x.level === 'warn').length,
      risks: issues.filter(x => x.level === 'risk').length
    };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function today(now) {
    const d = now instanceof Date ? now : new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * 生成每日简报（类似资料里的「扣子每日定时推送」）
   * @param {Array} stocks
   * @param {Object<string, object>} quotes
   * @param {Date} [now]
   */
  function brief(stocks, quotes, now) {
    const list = Array.isArray(stocks) ? stocks : [];
    const map = quotes || {};
    const rows = list.map(s => ({ s, q: map[String(s.code || '').toLowerCase()], e: evaluate(s, map[String(s.code || '').toLowerCase()]) }));
    const live = rows.filter(r => r.e.price !== null);
    const heavy = rows.filter(r => r.e.zone === 'heavy');
    const near = rows.filter(r => {
      const h = num(r.s.heavy);
      const en = num(r.s.entry);
      return h !== null && (en === null || h <= en)
        && r.e.price !== null && r.e.price > h && r.e.price <= h * 1.03;
    });
    const entry = rows.filter(r => r.e.zone === 'entry' || r.e.zone === 'heavy');
    const pb = rows.filter(r => r.e.pbUnder1);
    const pb80 = rows.filter(r => r.e.pbGolden);
    const risk = rows.filter(r => r.e.st || r.e.loss);
    const screened = rows.map(r => ({ ...r, sc: screen(r.s, r.q) }));
    const passAll = screened.filter(r => r.sc.allPass);
    const passBuy = passAll.filter(r => r.e.zone === 'heavy' || r.e.zone === 'entry');
    const passNear = screened.filter(r => r.sc.complete && !r.sc.allPass && r.sc.passed === r.sc.total - 1);
    const movers = live.filter(r => isNum(num(r.q.todayChange)) && Math.abs(r.q.todayChange) >= 5)
      .sort((a, b) => Math.abs(b.q.todayChange) - Math.abs(a.q.todayChange));

    const avg = live.length
      ? live.reduce((sum, r) => sum + (isNum(num(r.q.todayChange)) ? r.q.todayChange : 0), 0) / live.length
      : null;

    const fmt = v => isNum(v) ? v.toFixed(2) : '—';
    const fmtPct = v => isNum(v) ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '—';
    const names = (arr, max) => {
      const out = arr.slice(0, max).map(r => `${r.s.name} ${fmt(r.e.price)}`).join('、');
      return arr.length > max ? out + ` 等 ${arr.length} 只` : out;
    };

    const lines = [];
    lines.push(`📊 股票池简报 ${today(now)}`);
    lines.push(`共 ${list.length} 只（有行情 ${live.length}）· 平均涨跌 ${fmtPct(avg)}`);
    lines.push(`🟢 到重仓 ${heavy.length}${heavy.length ? '：' + names(heavy, 8) : ''}`);
    if (near.length) lines.push(`🟡 接近重仓 ${near.length}：${names(near, 8)}`);
    lines.push(`🔵 到入场 ${entry.length}${entry.length ? '：' + names(entry, 8) : ''}`);
    lines.push(`🟩 破净 ${pb.length}（八折 ${pb80.length}）${pb80.length ? '：' + names(pb80, 8) : ''}`);
    lines.push(`✅ 纪律全过 ${passAll.length}${passAll.length ? '：' + names(passAll, 8) : ''}`);
    if (passBuy.length) lines.push(`🎯 全过且到买点 ${passBuy.length}：${names(passBuy, 6)}`);
    if (passNear.length) {
      const nearText = passNear.slice(0, 8)
        .map(r => `${r.s.name}（${r.sc.failed.map(f => f.label).join('/')}）`).join('、');
      lines.push(`🟨 差一项 ${passNear.length}：${nearText}${passNear.length > 8 ? ` 等 ${passNear.length} 只` : ''}`);
    }
    if (risk.length) {
      const riskNames = risk.slice(0, 8).map(r => `${r.s.name}（${r.e.st ? 'ST' : '亏损'}）`).join('、');
      lines.push(`🔴 风险 ${risk.length}：${riskNames}${risk.length > 8 ? ` 等 ${risk.length} 只` : ''}`);
    }
    if (movers.length) lines.push(`⚡ 异动 ≥5% ${movers.length}：${movers.slice(0, 6).map(r => `${r.s.name} ${fmtPct(r.q.todayChange)}`).join('、')}`);
    lines.push('— 仅供个人记录，不构成投资建议');
    return lines.join('\n');
  }

  return {
    VERSION,
    SMALL_CAP,
    PB_GOLDEN,
    PE_HIGH,
    isNum,
    num,
    isST,
    zoneOf,
    evaluate,
    screen,
    matchStatus,
    limitUpPct,
    limitUpInfo,
    percentile,
    yi,
    health,
    brief
  };
});
