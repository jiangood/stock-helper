#!/usr/bin/env node
/**
 * 用「资料/个股研报」里带评分卡明细的研报，校准 research-score.js 的阈值。
 *
 * 覆盖研报 10 项中可复算的 7 项：
 *   1 国资背景 / 4 扣非净利增长 / 5 主营集中 / 7 市值 / 8 盘整 / 9 月线位置 / 10 放量
 * 百分制写法的研报按「完成度% × 10」折算到 10 分制。
 *
 * 时间敏感项（盘整 / 月线 / 放量）一律把 K 线截断到研报发布日再复算；
 * 扣非同比也按发布日截断；实控人与主营构成只保留最新快照（变化很慢）。
 *
 * 运行：node scripts/calibrate_research_score.js
 * 只读本地 data/stock-cache 与 data/fundamentals.json，不联网、不改数据。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Research = require('../research-score.js');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'stock-cache');
const FUNDAMENTALS_FILE = path.join(ROOT, 'data', 'fundamentals.json');

// 研报样本：第 1/4/5/7/8/9/10 项作者打分（10 分制）
const SAMPLES = [
  { code: 'sh600301', name: '华锡有色', date: '2024-10-14', report: '20241014 华锡有色 研究报告.pdf', total: 77.10, owner: 9.5, profit: 8.0, focus: 7.0, cap: 7.0, consolidation: 5.0, bottom: 6.0, volume: 6.0 },
  { code: 'sh600486', name: '扬农化工', date: '2025-03-03', report: '20250303 扬农化工研究报告.pdf', total: 66.05, owner: 10.0, profit: 5.0, focus: 8.0, cap: 4.0, consolidation: 6.0, bottom: 7.5, volume: 5.0 },
  { code: 'sz002430', name: '杭氧股份', date: '2025-03-24', report: '20250324 杭氧股份 研究报告.pdf', total: 66.10, owner: 7.0, profit: 6.0, focus: 9.0, cap: 5.0, consolidation: 5.0, bottom: 5.0, volume: 5.0 },
  { code: 'sh600727', name: '鲁北化工', date: '2025-03-30', report: '鲁北化工研究报告.pdf', total: 70.50, owner: 6.0, profit: 8.5, focus: 8.0, cap: 9.0, consolidation: 5.0, bottom: 5.0, volume: 8.0 },
  { code: 'sz000960', name: '锡业股份', date: '2025-06-16', report: '20250616 锡业股份跟踪报告.pdf', total: 78.75, owner: 10.0, profit: 8.0, focus: 9.5, cap: 5.0, consolidation: 7.0, bottom: 6.0, volume: 4.0 },
  { code: 'sz301058', name: '中粮科工', date: '2025-06-30', report: '20250630 中粮科工 研究报告.pdf', total: 73.35, owner: 10.0, profit: 6.5, focus: 8.0, cap: 10.0, consolidation: 5.0, bottom: 5.0, volume: 4.0 },
  { code: 'sh600426', name: '华鲁恒升', date: '2025-07-21', report: '华鲁恒升研究报告.pdf', total: 62.90, owner: 9.0, profit: 6.5, focus: 7.0, cap: 4.0, consolidation: 5.0, bottom: 5.0, volume: 6.0 },
  { code: 'sh600230', name: '沧州大化', date: '2025-08-04', report: '沧州大化研究报告.pdf', total: 67.10, owner: 10.0, profit: 3.0, focus: 7.5, cap: 10.0, consolidation: 6.0, bottom: 5.0, volume: 7.0 },
  { code: 'sh601568', name: '北元集团', date: '2025-09-22', report: '北元集团研究报告.pdf', total: 70.20, owner: 9.0, profit: 4.0, focus: 9.5, cap: 9.5, consolidation: 9.5, bottom: 9.0, volume: 5.0 },
  { code: 'sz002556', name: '辉隆股份', date: '2025-11-03', report: '辉隆股份研究报告.pdf', total: 73.20, owner: 7.5, profit: 7.0, focus: 8.0, cap: 10.0, consolidation: 8.0, bottom: 8.0, volume: 8.0 },
  { code: 'sh603970', name: '中农立华', date: '2025-11-17', report: '20251117 中农立华研究报告.pdf', total: 67.40, owner: 10.0, profit: 6.0, focus: 10.0, cap: 9.5, consolidation: 6.0, bottom: 5.0, volume: 4.0 },
  { code: 'sz300470', name: '中密控股', date: '2025-12-01', report: '中密控股研究报告.pdf', total: 80.05, owner: 8.5, profit: 7.5, focus: 9.0, cap: 10.0, consolidation: 7.5, bottom: 7.0, volume: 6.0 },
  { code: 'sh600819', name: '耀皮玻璃', date: '2025-12-08', report: '20251208 耀皮玻璃研究报告.pdf', total: 63.40, owner: 8.0, profit: 6.0, focus: 10.0, cap: 9.0, consolidation: 3.0, bottom: 3.0, volume: 5.0 },
  { code: 'sh688295', name: '中复神鹰', date: '2025-12-15', report: '中复神鹰研究报告.pdf', total: 64.80, owner: 10.0, profit: 4.0, focus: 10.0, cap: 6.0, consolidation: 4.0, bottom: 5.0, volume: 4.0 },
  { code: 'sh600348', name: '华阳股份', date: '2026-01-20', report: '华阳股份研究报告.pdf', total: 66.00, owner: 9.0, profit: 4.0, focus: 9.5, cap: 5.0, consolidation: 7.5, bottom: 6.0, volume: 4.0 },
  { code: 'sh601618', name: '中国中冶', date: '2026-03-09', report: '中国中冶研究报告20260302.pdf', total: 61.00, owner: 10.0, profit: 3.0, focus: 10.0, cap: 4.0, consolidation: 6.0, bottom: 6.0, volume: 6.0 },
  { code: 'sh601618', name: '中国中冶', date: '2026-03-15', report: '中国中冶研究报告（自制）.docx', total: 83.00, owner: 10.0, profit: 5.0, focus: 9.0, cap: 8.0, consolidation: 9.0, bottom: 9.0, volume: 7.0 },
  { code: 'sz300034', name: '钢研高纳', date: '2024-03-17', report: '钢研高纳研究报告.pdf', total: 70.80, owner: 10.0, profit: 7.0, focus: 9.0, cap: 9.0, consolidation: 5.0, bottom: 5.0, volume: 3.0 }
];

const ITEMS = [
  { key: 'owner', label: '国资' },
  { key: 'profit', label: '扣非' },
  { key: 'focus', label: '主营' },
  { key: 'cap', label: '市值' },
  { key: 'consolidation', label: '盘整' },
  { key: 'bottom', label: '月线' },
  { key: 'volume', label: '放量' }
];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function barsOf(cache, key) {
  const value = cache && cache[key];
  return value && Array.isArray(value.bars) ? value.bars : [];
}

function upto(bars, date) {
  return bars.filter(bar => String(bar && bar.time || '') <= date);
}

function lastClose(bars) {
  for (let i = bars.length - 1; i >= 0; i--) {
    const close = Number(bars[i].close);
    if (isFinite(close) && close > 0) return close;
  }
  return null;
}

/** 截断到研报日期，复算出「当时」的机器评分 */
function evaluateSample(sample, fundamentals) {
  const cache = readJson(path.join(CACHE_DIR, sample.code + '.json'));
  if (!cache) return { sample, error: '无本地缓存' };

  const weekly = upto(barsOf(cache, 'weeklyAdjusted'), sample.date);
  const monthly = upto(barsOf(cache, 'monthlyAdjusted'), sample.date);
  const daily = upto(barsOf(cache, 'dailyAdjusted'), sample.date);
  if (weekly.length < 30 && monthly.length < 12) return { sample, error: 'K 线不足' };

  const detail = cache.detail || {};
  const price = lastClose(weekly) || lastClose(monthly);
  if (!price) return { sample, error: '缺少收盘价' };

  const window52 = weekly.slice(-52);
  const highs = window52.map(b => Number(b.high)).filter(v => isFinite(v) && v > 0);
  const lows = window52.map(b => Number(b.low)).filter(v => isFinite(v) && v > 0);
  const nowPrice = Number(detail.price);
  const nowCap = Number(detail.totalCap);
  const cap = nowCap > 0 && nowPrice > 0 ? nowCap * price / nowPrice : nowCap;

  const fund = (fundamentals && fundamentals.stocks && fundamentals.stocks[sample.code]) || {};
  const result = Research.compute({
    cap,
    monthly,
    weekly,
    daily,
    price,
    high52: highs.length ? Math.max.apply(null, highs) : null,
    low52: lows.length ? Math.min.apply(null, lows) : null,
    ownerType: fund.ownerType,
    mainRatio: fund.mainRatio,
    annual: fund.annual,
    asOf: sample.date
  });
  return { sample, result, fund };
}

function rank(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  order.forEach(([, i], position) => { ranks[i] = position + 1; });
  return ranks;
}

function spearman(pairs) {
  if (pairs.length < 3) return null;
  const a = rank(pairs.map(p => p[0]));
  const b = rank(pairs.map(p => p[1]));
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - meanA) * (b[i] - meanB);
    da += (a[i] - meanA) ** 2;
    db += (b[i] - meanB) ** 2;
  }
  return da && db ? cov / Math.sqrt(da * db) : null;
}

function main() {
  const fundamentals = readJson(FUNDAMENTALS_FILE, {});
  const rows = SAMPLES.map(sample => evaluateSample(sample, fundamentals));
  const usable = rows.filter(row => row.result);
  const missing = rows.filter(row => row.error);

  const pad = (text, width) => String(text).padEnd(width, ' ');
  const fmt = (v, digits = 1) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(digits));
  const authored7Percent = sample => ITEMS.reduce((sum, item) => sum + Research.CONFIG.weights[item.key] * sample[item.key] / 10, 0)
    / Object.values(Research.CONFIG.weights).reduce((a, b) => a + b, 0) * 100;

  console.log('研报评分校准：机器 7 项 vs 研报打分（百分制，K 线与扣非按发布日截断）\n');
  console.log(pad('股票', 9) + pad('日期', 12) + pad('机器分', 9) + pad('研报7项', 10) + pad('研报总分', 10) + '明细（机器←作者）');
  console.log('-'.repeat(140));

  const errors = {};
  ITEMS.forEach(item => { errors[item.key] = []; });
  const machinePercents = [];
  const authoredPercents = [];
  const authoredTotals = [];

  usable.forEach(({ sample, result }) => {
    machinePercents.push(result.percent);
    authoredPercents.push(authored7Percent(sample));
    authoredTotals.push(sample.total);

    const cells = ITEMS.map(item => {
      const authored = sample[item.key];
      const machine = result.items[item.key];
      const diff = machine === null ? null : machine - authored;
      if (diff !== null) errors[item.key].push(diff);
      return `${fmt(authored)}→${fmt(machine)} `;
    }).join('');

    console.log(pad(sample.name, 9) + pad(sample.date, 12)
      + pad(fmt(result.percent, 1), 9) + pad(fmt(authoredPercents[authoredPercents.length - 1], 1), 10)
      + pad(fmt(sample.total, 1), 10) + cells);
  });

  console.log('\n误差统计（机器 − 作者，10 分制）：');
  let maeSum = 0;
  let maeCount = 0;
  ITEMS.forEach(item => {
    const list = errors[item.key];
    if (!list.length) return;
    const mae = list.reduce((s, v) => s + Math.abs(v), 0) / list.length;
    const bias = list.reduce((s, v) => s + v, 0) / list.length;
    const pairs = usable.map(({ sample, result }) => [sample[item.key], result.items[item.key]]).filter(pair => pair[1] !== null);
    maeSum += mae;
    maeCount++;
    console.log(`  ${item.label}：MAE ${mae.toFixed(2)} · 偏差 ${bias >= 0 ? '+' : ''}${bias.toFixed(2)} · 秩相关 ${fmt(spearman(pairs), 2)} （n=${list.length}）`);
  });
  console.log(`  七项平均 MAE ${(maeSum / Math.max(maeCount, 1)).toFixed(2)}`);

  const mean = list => list.reduce((s, v) => s + v, 0) / Math.max(list.length, 1);
  const mae = (a, b) => mean(a.map((v, i) => Math.abs(v - b[i])));
  const diff = (a, b) => mean(a.map((v, i) => v - b[i]));

  console.log('\n百分制对比（n=' + usable.length + '）：');
  console.log(`  机器分 vs 研报前 7 项折算分：平均 ${fmt(mean(machinePercents))} 分 vs ${fmt(mean(authoredPercents))} 分`
    + ` · 平均差 ${fmt(diff(machinePercents, authoredPercents), 1)} · MAE ${fmt(mae(machinePercents, authoredPercents), 1)}`
    + ` · 秩相关 ${fmt(spearman(machinePercents.map((v, i) => [authoredPercents[i], v])), 2)}`);
  console.log(`  机器分 vs 研报总分：        平均 ${fmt(mean(machinePercents))} 分 vs ${fmt(mean(authoredTotals))} 分`
    + ` · 平均差 ${fmt(diff(machinePercents, authoredTotals), 1)} · MAE ${fmt(mae(machinePercents, authoredTotals), 1)}`
    + ` · 秩相关 ${fmt(spearman(machinePercents.map((v, i) => [authoredTotals[i], v])), 2)}`);
  console.log('  说明：机器覆盖 7 项（权重 65），研报总分还含「独一无二 / 产品涨价 / 盈利模式」35 分权重。');

  if (missing.length) {
    console.log('\n未参与校准：');
    missing.forEach(({ sample, error }) => console.log(`  ${sample.name}（${sample.report}）：${error}`));
  }
}

main();
