'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
global.TechInd = require('../indicators.js');
require('../trade-signals.js');
const Signals = global.StockTradeSignals;

function bars(series) {
  return series.map((close, i) => ({ time: '2026-01-' + String(i + 1).padStart(2, '0'), open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 + i }));
}

test('买入评分固定为四项，且现价高于入场价时不算分', () => {
  const list = bars(Array.from({ length: 120 }, (_, i) => 20 + i * 0.02));
  const price = list[list.length - 1].close;
  const above = Signals.evaluateAdd(price, { entry: price - 1 }, list);
  assert.equal(above.scoreMax, 4);
  assert.equal(above.inZone, false);
  assert.equal(above.status, '高于入场价');
  assert.match(above.reasons[0], /不追高/);

  const inside = Signals.evaluateAdd(price, { entry: price + 1 }, list);
  assert.equal(inside.inZone, true);
  assert.ok(inside.score >= 0 && inside.score <= 4);
  assert.ok(inside.reasons.some(r => r.includes('RSI(14)')));
  assert.ok(inside.reasons.some(r => r.includes('MFI(14)')));
  assert.ok(inside.reasons.some(r => r.includes('动能')));
  assert.ok(inside.reasons.some(r => r.includes('超跌深度')));
});

test('未配置入场价时不生成买入信号', () => {
  const list = bars(Array.from({ length: 120 }, (_, i) => 10 + Math.sin(i / 4)));
  const res = Signals.evaluateAdd(list[list.length - 1].close, { entry: 0 }, list);
  assert.equal(res.inZone, false);
  assert.equal(res.status, '未配置入场价');
  assert.match(res.reasons[0], /未配置/);
});

test('下跌趋势且 MFI 低于 20 时一票否决', () => {
  // 持续阴跌：现价在 MA20 与 MA60 下方，且资金持续流出
  const series = Array.from({ length: 120 }, (_, i) => 30 - i * 0.12);
  const list = bars(series);
  const res = Signals.evaluateAdd(list[list.length - 1].close, { entry: 40 }, list);
  assert.equal(res.regime, 'down');
  assert.equal(res.veto, true);
  assert.equal(res.status, '观望 · 资金流出');
  assert.ok(res.reasons.some(r => r.includes('一票否决')));
});

test('止盈：近 60 日最低收盘 ×1.2 启动，最高收盘回撤 5% 触发', () => {
  const flat = Array.from({ length: 60 }, () => 10);
  const up = [10.5, 11, 11.5, 12, 12.5, 13];
  const down = [12.8, 12.3];
  const list = bars(flat.concat(up, down));
  const price = list[list.length - 1].close;
  const res = Signals.evaluateExit(price, {}, list);
  assert.equal(res.armed, true);
  assert.equal(res.peak, 13);
  assert.ok(Math.abs(res.exitLine - 12.35) < 1e-9);
  assert.equal(res.state, '已触发');
  assert.equal(res.triggerDate, list[list.length - 1].time);
  assert.equal(res.cooldownDays, 60);
});

test('止盈：未达启动线时为未启动', () => {
  const list = bars(Array.from({ length: 80 }, (_, i) => 10 + (i % 5) * 0.1));
  const res = Signals.evaluateExit(list[list.length - 1].close, {}, list);
  assert.equal(res.armed, false);
  assert.equal(res.state, '未启动');
  assert.equal(res.exitLine, null);
  assert.equal(res.cooldownDays, 0);
});

test('止盈：触发数日后进入已离场并计算冷却天数', () => {
  const flat = Array.from({ length: 60 }, () => 10);
  const up = [10.5, 11, 11.5, 12, 12.5, 13];
  const down = [12.8, 12.3, 12.2, 12.1, 12.0, 11.9];
  const list = bars(flat.concat(up, down));
  const res = Signals.evaluateExit(list[list.length - 1].close, {}, list);
  assert.equal(res.state, '已离场');
  assert.equal(res.barsSinceTrigger, 4);
  assert.equal(res.cooldownDays, 56);
});

test('止盈：创新高后重新开始跟踪', () => {
  const flat = Array.from({ length: 60 }, () => 10);
  const up = [10.5, 11, 11.5, 12, 12.5, 13];
  const down = [12.8, 12.4];
  const again = [13.2, 13.6];
  const list = bars(flat.concat(up, down, again));
  const res = Signals.evaluateExit(list[list.length - 1].close, {}, list);
  assert.equal(res.peak, 13.6);
  assert.equal(res.state, '跟踪中');
  assert.equal(res.triggerDate, '');
});
