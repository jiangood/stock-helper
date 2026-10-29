const test = require('node:test');
const assert = require('node:assert/strict');
const Research = require('../research-score.js');

/** 造一段月 K：closes 按时间递增，每月一根 */
function monthlyBars(closes, volumes) {
  return closes.map((close, i) => ({
    time: `${2020 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`,
    open: close,
    high: close * 1.05,
    low: close * 0.95,
    close,
    volume: volumes ? volumes[i] : 1000
  }));
}

test('国资背景：央企 > 省级 > 地市 > 其他，未知返回 null', () => {
  assert.equal(Research.scoreOwner('central'), 10);
  assert.equal(Research.scoreOwner('province'), 9.5);
  assert.equal(Research.scoreOwner('city'), 7.5);
  assert.equal(Research.scoreOwner('other'), 5.5);
  assert.equal(Research.scoreOwner(null), null);
  assert.equal(Research.scoreOwner('unknown-type'), null);
});

test('主营集中度：按占比线性给分、加偏移并夹在 2-10', () => {
  assert.equal(Research.scoreFocus(1), 10);
  assert.equal(Research.scoreFocus(0.75), 9);
  assert.equal(Research.scoreFocus(0.3), 4.5);
  assert.equal(Research.scoreFocus(0.05), 2);
  assert.equal(Research.scoreFocus(null), null);
  assert.equal(Research.scoreFocus(1.4), null);
});

test('扣非净利：连续高增长满分，亏损或大幅下滑低分，并按 asOf 截断', () => {
  const annual = [
    { date: '2025-12-31', yoy: 120, value: 5e8 },
    { date: '2024-12-31', yoy: 150, value: 3e8 },
    { date: '2023-12-31', yoy: 10, value: 2e8 }
  ];
  assert.equal(Research.scoreProfit(annual).score, 10);
  assert.equal(Research.scoreProfit(annual, '2025-06-30').score, 8.5, '只看到 2024 年报时应按单年 >100% 给分');
  assert.equal(Research.scoreProfit(annual, '2024-06-30').score, 5.5, '只看到 2023 年报时按个位数增长给分');

  assert.equal(Research.scoreProfit([{ date: '2025-12-31', yoy: -80, value: -1e8 }]).score, 2, '扣非为负直接低分');
  assert.equal(Research.scoreProfit([{ date: '2025-12-31', yoy: 80, value: 1e8 }]).score, 7.5);
  assert.equal(Research.scoreProfit([{ date: '2025-12-31', yoy: 30, value: 1e8 }]).score, 6);
  assert.equal(Research.scoreProfit([{ date: '2025-12-31', yoy: 5, value: 1e8 }]).score, 5.5);
  assert.equal(Research.scoreProfit([{ date: '2025-12-31', yoy: -10, value: 1e8 }]).score, 4.5);
  assert.equal(Research.scoreProfit([{ date: '2025-12-31', yoy: -60, value: 1e8 }]).score, 3);
  assert.equal(Research.scoreProfit([]).score, null);
});

test('市值分档：100 亿以内满分，200 亿以内 6.5 分，之后按对数衰减且不低于 3 分', () => {  assert.equal(Research.scoreCap(50e8), 10);
  assert.equal(Research.scoreCap(100e8), 10);
  assert.equal(Research.scoreCap(150e8), 6.5);
  assert.equal(Research.scoreCap(200e8), 6.5);
  assert.ok(Research.scoreCap(600e8) < 6.5);
  assert.ok(Research.scoreCap(600e8) > 4);
  assert.ok(Research.scoreCap(20000e8) >= 3);
  assert.equal(Research.scoreCap(null), null);
});

test('盘整项：窄幅长期横盘得分高于单边上涨', () => {
  const flat = monthlyBars(Array.from({ length: 36 }, (_, i) => 10 + Math.sin(i) * 0.3));
  const trend = monthlyBars(Array.from({ length: 36 }, (_, i) => 5 + i * 0.6));
  const flatScore = Research.scoreConsolidation(flat).score;
  const trendScore = Research.scoreConsolidation(trend).score;
  assert.ok(flatScore > trendScore, `横盘 ${flatScore} 应高于上涨 ${trendScore}`);
  assert.ok(flatScore <= 9 && flatScore >= 4);
});

test('月线底部项：贴着历史低位得分高于历史高位', () => {
  const closes = Array.from({ length: 120 }, (_, i) => 10 + i * 0.5);
  const low = Research.scoreBottom(monthlyBars(closes), 10, 12, 9);
  const high = Research.scoreBottom(monthlyBars(closes), 69, 70, 60);
  assert.ok(low.score > high.score, `低位 ${low.score} 应高于高位 ${high.score}`);
  assert.ok(low.position < high.position);
});

test('底部放量项：量比越高分越高，未走完的当月不计入均量', () => {
  const volumes = Array.from({ length: 42 }, (_, i) => (i >= 36 ? 3000 : 1000));
  const bars = monthlyBars(Array.from({ length: 42 }, (_, i) => 10 + i * 0.01), volumes);
  // 追加一根当月未走完的月 K，成交量很小，应被剔除
  bars.push({ time: '2026-10-01', open: 10, high: 10, low: 10, close: 10, volume: 10 });
  const result = Research.scoreVolume(bars, null, '2026-10-29');
  assert.ok(result.score > 7, `放量应得高分，实际 ${result.score}`);
  assert.ok(result.metrics.volRatio > 2.5);
});

test('compute 输出 7 项合计与分档，缺数据时只统计已知项', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 8 + Math.sin(i / 3));
  const monthly = monthlyBars(closes, Array.from({ length: 60 }, () => 1000));
  const annual = [
    { date: '2025-12-31', yoy: 120, value: 5e8 },
    { date: '2024-12-31', yoy: 150, value: 3e8 }
  ];
  const full = Research.compute({
    cap: 60e8,
    monthly,
    price: 8,
    high52: 12,
    low52: 7,
    ownerType: 'central',
    mainRatio: 0.9,
    annual
  });
  assert.equal(full.totalMax, 65);
  assert.equal(full.max, 65);
  assert.equal(full.complete, true);
  assert.ok(full.points > 0 && full.points <= 65);
  assert.ok(full.percent > 0 && full.percent <= 100);
  assert.equal(full.percent, Math.round(full.points / 65 * 1000) / 10);
  assert.ok(full.band && ['good', 'mid', 'high'].includes(full.band.key));
  assert.equal(Research.bandOf(80).key, 'good');
  assert.equal(Research.bandOf(60).key, 'mid');
  assert.equal(Research.bandOf(40).key, 'high');

  const partial = Research.compute({ cap: 60e8 });
  assert.equal(partial.items.cap, 10);
  assert.equal(partial.items.owner, null);
  assert.equal(partial.items.consolidation, null);
  assert.equal(partial.max, 8);
  assert.equal(partial.complete, false);
  assert.equal(partial.percent, null, '缺项时不折算百分制');
  assert.equal(partial.band, null);

  const empty = Research.compute({});
  assert.equal(empty.points, null);
  assert.equal(empty.percent, null);
});

test('周 K 可以合成月 K，缺失月 K 时自动兜底', () => {
  const weekly = [];
  for (let i = 0; i < 60; i++) {
    weekly.push({
      time: `${2019 + Math.floor(i / 52)}-${String(Math.floor((i % 52) / 4.34) + 1).padStart(2, '0')}-15`,
      open: 10, high: 11, low: 9, close: 10 + i * 0.1, volume: 100
    });
  }
  const months = Research.deriveMonthly(weekly);
  assert.ok(months.length >= 12);
  assert.ok(months.length < weekly.length);
  const result = Research.compute({ cap: 60e8, weekly, price: 15, high52: 16, low52: 9 });
  assert.ok(result.items.consolidation !== null, '缺月 K 时应由周 K 合成');
});
