#!/usr/bin/env node
/**
 * 用「资料/个股研报」里带评分卡样本的研报，校准 research-score.js 的阈值。
 *
 * 样本取研报评分卡第 7-10 项（10 分制）：
 *   7 总市值<200亿 / 8 股价盘整2-3年 / 9 月线底部区域 / 10 底部成交量放大
 * 百分制写法的研报按「完成度% × 10」折算到 10 分制。
 *
 * 关键点：第 8/9/10 项描述的是「研报发布当时」的价格位置，因此一律把 K 线截断到
 * 研报日期再复算，否则会拿今天的走势去对几年前的打分。
 *
 * 运行：node scripts/calibrate_research_score.js
 * 只读本地 data/stock-cache，不联网、不改任何数据文件。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Research = require('../research-score.js');

const ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'stock-cache');

// 研报样本：code / 名称 / 报告日期 / 来源 / 第 7-10 项作者打分（10 分制）
const SAMPLES = [
  { code: 'sh600301', name: '华锡有色', date: '2024-10-14', report: '20241014 华锡有色 研究报告.pdf', cap: 7.0, consolidation: 5.0, bottom: 6.0, volume: 6.0 },
  { code: 'sh600486', name: '扬农化工', date: '2025-03-03', report: '20250303 扬农化工研究报告.pdf', cap: 4.0, consolidation: 6.0, bottom: 7.5, volume: 5.0 },
  { code: 'sz002430', name: '杭氧股份', date: '2025-03-24', report: '20250324 杭氧股份 研究报告.pdf', cap: 5.0, consolidation: 5.0, bottom: 5.0, volume: 5.0 },
  { code: 'sh600727', name: '鲁北化工', date: '2025-03-30', report: '鲁北化工研究报告.pdf', cap: 9.0, consolidation: 5.0, bottom: 5.0, volume: 8.0 },
  { code: 'sz000960', name: '锡业股份', date: '2025-06-16', report: '20250616 锡业股份跟踪报告.pdf', cap: 5.0, consolidation: 7.0, bottom: 6.0, volume: 4.0 },
  { code: 'sz301058', name: '中粮科工', date: '2025-06-30', report: '20250630 中粮科工 研究报告.pdf', cap: 10.0, consolidation: 5.0, bottom: 5.0, volume: 4.0 },
  { code: 'sh600426', name: '华鲁恒升', date: '2025-07-21', report: '华鲁恒升研究报告.pdf', cap: 4.0, consolidation: 5.0, bottom: 5.0, volume: 6.0 },
  { code: 'sh600230', name: '沧州大化', date: '2025-08-04', report: '沧州大化研究报告.pdf', cap: 10.0, consolidation: 6.0, bottom: 5.0, volume: 7.0 },
  { code: 'sh601568', name: '北元集团', date: '2025-09-22', report: '北元集团研究报告.pdf', cap: 9.5, consolidation: 9.5, bottom: 9.0, volume: 5.0 },
  { code: 'sz002556', name: '辉隆股份', date: '2025-11-03', report: '辉隆股份研究报告.pdf', cap: 10.0, consolidation: 8.0, bottom: 8.0, volume: 8.0 },
  { code: 'sh603970', name: '中农立华', date: '2025-11-17', report: '20251117 中农立华研究报告.pdf', cap: 9.5, consolidation: 6.0, bottom: 5.0, volume: 4.0 },
  { code: 'sz300470', name: '中密控股', date: '2025-12-01', report: '中密控股研究报告.pdf', cap: 10.0, consolidation: 7.5, bottom: 7.0, volume: 6.0 },
  { code: 'sh600819', name: '耀皮玻璃', date: '2025-12-08', report: '20251208 耀皮玻璃研究报告.pdf', cap: 9.0, consolidation: 3.0, bottom: 3.0, volume: 5.0 },
  { code: 'sh688295', name: '中复神鹰', date: '2025-12-15', report: '中复神鹰研究报告.pdf', cap: 6.0, consolidation: 4.0, bottom: 5.0, volume: 4.0 },
  { code: 'sh600348', name: '华阳股份', date: '2026-01-20', report: '华阳股份研究报告.pdf', cap: 5.0, consolidation: 7.5, bottom: 6.0, volume: 4.0 },
  { code: 'sh601618', name: '中国中冶', date: '2026-03-09', report: '中国中冶研究报告20260302.pdf', cap: 4.0, consolidation: 6.0, bottom: 6.0, volume: 6.0 },
  { code: 'sh601618', name: '中国中冶', date: '2026-03-15', report: '中国中冶研究报告（自制）.docx', cap: 8.0, consolidation: 9.0, bottom: 9.0, volume: 7.0 },
  { code: 'sz300034', name: '钢研高纳', date: '2024-03-17', report: '钢研高纳研究报告.pdf', cap: 9.0, consolidation: 5.0, bottom: 5.0, volume: 3.0 }
];

const ITEMS = [
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
function evaluateSample(sample) {
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

  const result = Research.compute({
    cap,
    monthly,
    weekly,
    daily,
    price,
    high52: highs.length ? Math.max.apply(null, highs) : null,
    low52: lows.length ? Math.min.apply(null, lows) : null
  });
  return { sample, result, price };
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
  const rows = SAMPLES.map(evaluateSample);
  const usable = rows.filter(row => row.result);
  const missing = rows.filter(row => row.error);

  const pad = (text, width) => String(text).padEnd(width, ' ');
  const fmt = (v, digits = 1) => (v === null || v === undefined || !isFinite(v) ? '—' : v.toFixed(digits));

  console.log('研报评分校准：作者打分 vs 机器复算（10 分制，第 7-10 项，K 线截断到研报日期）\n');
  console.log(pad('股票', 9) + pad('日期', 12) + '  ' + ITEMS.map(i => pad(i.label, 14)).join('') + '证据');
  console.log('-'.repeat(118));

  const errors = {};
  ITEMS.forEach(item => { errors[item.key] = []; });

  usable.forEach(({ sample, result }) => {
    const cells = ITEMS.map(item => {
      const authored = sample[item.key];
      const machine = result.items[item.key];
      const diff = machine === null ? null : machine - authored;
      if (diff !== null) errors[item.key].push(diff);
      return pad(`${fmt(authored)} → ${fmt(machine)} (${diff === null ? '—' : (diff > 0 ? '+' : '') + diff.toFixed(1)})`, 14);
    });
    const m = result.metrics;
    const note = `箱体${m.boxHeight === null ? '—' : (m.boxHeight * 100).toFixed(0) + '%'} 高点${m.months === null ? '—' : m.months + '月'}`
      + ` 位置${m.position === null ? '—' : (m.position * 100).toFixed(0) + '%'} 量比${fmt(m.volRatio, 2)}`;
    console.log(pad(sample.name, 9) + pad(sample.date, 12) + '  ' + cells.join('') + note);
  });

  console.log('\n误差统计（机器 − 作者）：');
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
  console.log(`  四项平均 MAE ${(maeSum / Math.max(maeCount, 1)).toFixed(2)}`);

  const machineTotal = usable.map(({ result }) => result.points);
  const authoredTotal = usable.map(({ sample }) => ITEMS.reduce((sum, item) => sum + Research.CONFIG.weights[item.key] * sample[item.key] / 10, 0));
  const totalMae = machineTotal.map((v, i) => Math.abs(v - authoredTotal[i])).reduce((s, v) => s + v, 0) / Math.max(machineTotal.length, 1);
  console.log(`  合计 32 分：MAE ${totalMae.toFixed(2)} · 秩相关 ${fmt(spearman(machineTotal.map((v, i) => [authoredTotal[i], v])), 2)} （n=${machineTotal.length}）`);

  if (missing.length) {
    console.log('\n未参与校准：');
    missing.forEach(({ sample, error }) => console.log(`  ${sample.name}（${sample.report}）：${error}`));
  }
}

main();
