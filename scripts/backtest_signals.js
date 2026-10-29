#!/usr/bin/env node
/*
 * 作战台规则的离线回测（买入评分 + 止盈跟踪）
 * ---------------------------------------------------------------------------
 * 用法：node scripts/backtest_signals.js
 *
 * 数据：data/stock-cache/<code>.json 里的前复权日 K；data/stocks.json 里的计划入场价。
 * 口径：只用收盘价，不含手续费与滑点；样本为最近约一年，属于单一行情，结论需定期复核。
 *
 * 三组检验：
 *   A. 买入评分分层：不同评分下 10 / 20 / 40 日的远期收益
 *   B. 止盈规则：与「死拿」对比的收益、距峰值、跑赢比例
 *   C. 组合系统：按买入信号进场、按止盈规则离场，统计单笔结果
 */
'use strict';

const fs = require('fs');
const path = require('path');

global.TechInd = require('../indicators.js');
require('../trade-signals.js');
const Signals = global.TechInd ? global.StockTradeSignals : global.StockTradeSignals;

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'stock-cache');
const FWD = 40;
const HORIZON_120 = 120;

function loadStocks() {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'stocks.json'), 'utf8'));
  const map = {};
  list.forEach(s => { map[String(s.code).toLowerCase()] = s; });
  return { list, map };
}

function loadBars() {
  const out = [];
  fs.readdirSync(CACHE).filter(f => f.endsWith('.json')).forEach(f => {
    let json;
    try { json = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch (_) { return; }
    const bars = json.dailyAdjusted && json.dailyAdjusted.bars;
    if (!Array.isArray(bars) || bars.length < 150) return;
    out.push({ code: f.replace('.json', ''), bars });
  });
  return out;
}

const median = a => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const ratio = (a, fn) => (a.length ? a.filter(fn).length / a.length : null);
const pct = (v, d) => (v === null ? '—' : (v * 100).toFixed(d === undefined ? 1 : d) + '%');
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

/** 止盈规则（与 trade-signals.js 的 evaluateExit 同口径，这里为逐根计算做展开） */
function exitIndex(bars, from, to) {
  let armed = false, peak = null, trigger = -1;
  for (let i = from; i <= to; i++) {
    let lo = Infinity;
    for (let k = Math.max(0, i - 59); k <= i; k++) if (bars[k].close < lo) lo = bars[k].close;
    if (!armed) {
      if (bars[i].close >= lo * 1.2) { armed = true; peak = bars[i].close; }
    } else {
      if (bars[i].close > peak) { peak = bars[i].close; trigger = -1; }
      else if (trigger < 0 && bars[i].close <= peak * 0.95) trigger = i;
    }
  }
  return { armed, peak, trigger };
}

/* ---------- A. 买入评分分层 ---------- */
function studyBuy(universe, stockMap) {
  const groups = new Map();
  let bars = 0;
  universe.forEach(({ code, bars: b }) => {
    const stock = stockMap[code];
    if (!stock || !(Number(stock.entry) > 0)) return;
    for (let i = 60; i < b.length - FWD - 1; i++) {
      const price = b[i].close;
      const win = b.slice(Math.max(0, i - 119), i + 1);
      const res = Signals.evaluateAdd(price, stock, win);
      if (!res.dataReady) continue;
      bars++;
      const key = (res.inZone ? '低于入场价' : '高于入场价')
        + ' · ' + (res.veto ? '否决' : res.score >= 3 ? '评分≥3' : res.score === 2 ? '评分2' : '评分≤1');
      if (!groups.has(key)) groups.set(key, { f10: [], f20: [], f40: [] });
      const g = groups.get(key);
      g.f10.push(b[i + 10].close / price - 1);
      g.f20.push(b[i + 20].close / price - 1);
      g.f40.push(b[i + 40].close / price - 1);
    }
  });
  return { groups, bars };
}

/* ---------- B. 止盈规则 ---------- */
function studyExit(universe) {
  const events = [];
  universe.forEach(({ bars: b }) => {
    const highs = b.map(x => x.high);
    const pivots = Signals && global.TechInd ? global.TechInd.pivotHighs(highs, 5) : [];
    pivots.forEach(p => {
      if (p < 45 || p > b.length - FWD - 6) return;
      let e = p - 30, low = Infinity;
      for (let k = p - 30; k <= p - 5; k++) if (b[k].close < low) { low = b[k].close; e = k; }
      if (b[p].high / low - 1 < 0.15) return;
      let peak = -1, pi = p;
      for (let k = Math.max(0, p - 3); k <= Math.min(b.length - 1, p + 3); k++) if (b[k].close > peak) { peak = b[k].close; pi = k; }
      const end = Math.min(b.length - 1, pi + FWD);
      const { trigger } = exitIndex(b, e, end);
      const exitIdx = trigger >= 0 ? trigger : end;
      // 峰值取整段行情的最高收盘，避免用局部枢轴高点算出「卖在峰值之上」
      let top = -Infinity;
      for (let k = e; k <= end; k++) if (b[k].close > top) top = b[k].close;
      events.push({
        entry: b[e].close,
        peak: top,
        endRet: b[end].close / b[e].close - 1,
        ruleRet: b[exitIdx].close / b[e].close - 1,
        capture: b[exitIdx].close / top - 1
      });
    });
  });
  const coasters = events.filter(x => (x.peak / x.entry - 1) >= 0.15 && (x.peak / x.entry - 1) <= 0.6 && x.endRet <= 0.05);
  return { events, coasters };
}

function studyHorizon(universe) {
  const rows = [];
  universe.forEach(({ bars: b }) => {
    for (let e = 60; e < b.length - HORIZON_120 - 1; e += 5) {
      const end = e + HORIZON_120;
      const { trigger } = exitIndex(b, e, end);
      const exitIdx = trigger >= 0 ? trigger : end;
      rows.push({ hold: b[end].close / b[e].close - 1, rule: b[exitIdx].close / b[e].close - 1 });
    }
  });
  return rows;
}

/* ---------- C. 组合系统 ---------- */
function studySystem(universe, stockMap) {
  const trades = [];
  universe.forEach(({ code, bars: b }) => {
    const stock = stockMap[code];
    if (!stock || !(Number(stock.entry) > 0)) return;
    let i = 60, lastExit = -999;
    while (i < b.length - 1) {
      const win = b.slice(Math.max(0, i - 119), i + 1);
      const res = Signals.evaluateAdd(b[i].close, stock, win);
      const ok = res.dataReady && res.inZone && !res.veto && res.score >= 3 && i - lastExit > 60;
      if (!ok) { i++; continue; }
      const { trigger } = exitIndex(b, i, b.length - 1);
      const exitIdx = trigger >= 0 ? trigger : b.length - 1;
      trades.push({ name: stock.name, ret: b[exitIdx].close / b[i].close - 1, days: exitIdx - i, open: trigger < 0 });
      i = exitIdx + 61;
      lastExit = exitIdx;
    }
  });
  return trades;
}

function main() {
  const { map } = loadStocks();
  const universe = loadBars();

  console.log('样本：' + universe.length + ' 只股票池标的（前复权日 K，最近约一年）\n');

  const buy = studyBuy(universe, map);
  console.log('A. 买入评分分层（' + buy.bars + ' 根 K 线，含重叠窗口）');
  console.log(pad('分组', 30) + padL('次数', 7) + padL('10日中位', 10) + padL('20日中位', 10) + padL('20日均值', 10) + padL('20日胜率', 10) + padL('40日中位', 10));
  [...buy.groups.entries()]
    .sort((a, b) => b[1].f20.length - a[1].f20.length)
    .forEach(([key, g]) => {
      console.log(pad(key, 30)
        + padL(g.f20.length, 7)
        + padL(pct(median(g.f10)), 10)
        + padL(pct(median(g.f20)), 10)
        + padL(pct(mean(g.f20)), 10)
        + padL(pct(ratio(g.f20, x => x > 0), 0), 10)
        + padL(pct(median(g.f40)), 10));
    });

  const exit = studyExit(universe);
  console.log('\nB. 止盈规则（近 60 日最低收盘 ×1.2 启动，最高收盘 ×0.95 离场）');
  const report = (label, set) => {
    console.log(pad(label, 22)
      + padL(set.length + ' 次', 8)
      + padL('规则 ' + pct(median(set.map(x => x.ruleRet))), 16)
      + padL('死拿 ' + pct(median(set.map(x => x.endRet))), 16)
      + padL('距峰值 ' + pct(median(set.map(x => x.capture))), 16)
      + padL('跑赢 ' + pct(ratio(set, x => x.ruleRet > x.endRet), 0), 14));
  };
  report('全部拉升段', exit.events);
  report('过山车段', exit.coasters);

  const horizon = studyHorizon(universe);
  console.log(pad('120 日周期', 22)
    + padL(horizon.length + ' 次', 8)
    + padL('规则 ' + pct(median(horizon.map(x => x.rule))), 16)
    + padL('死拿 ' + pct(median(horizon.map(x => x.hold))), 16)
    + padL('跑赢 ' + pct(ratio(horizon, x => x.rule > x.hold), 0), 14));

  const trades = studySystem(universe, map);
  const rets = trades.map(t => t.ret);
  console.log('\nC. 组合系统（买入：现价<入场价 且 评分≥3 且非否决；卖出：止盈规则；卖后 60 日冷却）');
  console.log('  交易 ' + trades.length + ' 笔 / ' + new Set(trades.map(t => t.name)).size + ' 只标的');
  console.log('  单笔中位 ' + pct(median(rets)) + ' · 均值 ' + pct(mean(rets)) + ' · 胜率 ' + pct(ratio(rets, x => x > 0), 0)
    + ' · 持有中位 ' + median(trades.map(t => t.days)) + ' 日');
  console.log('  最好 ' + pct(Math.max.apply(null, rets)) + ' · 最差 ' + pct(Math.min.apply(null, rets))
    + ' · 未平仓 ' + trades.filter(t => t.open).length + ' 笔');

  console.log('\n口径提醒：不含手续费与滑点；样本仅一年且为普跌行情，均值回归占优，趋势市可能失效。');
}

main();
