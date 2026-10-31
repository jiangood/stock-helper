'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateDailyToMonthly } = require('../scripts/monthly_kline.js');

test('aggregates adjusted daily OHLCV by calendar month', () => {
  const bars = [
    { time: '2026-01-05', open: 10, high: 11, low: 9, close: 10.5, volume: 100, amount: 1000 },
    { time: '2026-01-06', open: 10.5, high: 12, low: 10, close: 11.5, volume: 200, amount: 2200 },
    { time: '2026-02-02', open: 11.5, high: 13, low: 11, close: 12.5, volume: 300, amount: 3600 }
  ];
  assert.deepEqual(aggregateDailyToMonthly(bars), [
    { time: '2026-01', open: 10, high: 12, low: 9, close: 11.5, volume: 300, amount: 3200 },
    { time: '2026-02', open: 11.5, high: 13, low: 11, close: 12.5, volume: 300, amount: 3600 }
  ]);
});

test('sorts input, drops malformed bars, and limits the newest months', () => {
  const bars = [
    { time: '2026-03-02', open: 3, high: 4, low: 2, close: 3, volume: 1 },
    { time: '2026-01-02', open: 1, high: 2, low: 1, close: 2, volume: 1 },
    { time: 'bad', open: 9, high: 9, low: 9, close: 9, volume: 1 },
    { time: '2026-02-02', open: 2, high: 3, low: 2, close: 2.5, volume: 1 }
  ];
  assert.deepEqual(aggregateDailyToMonthly(bars, 2).map(bar => bar.time), ['2026-02', '2026-03']);
});

test('returns an empty array when no usable daily bars exist', () => {
  assert.deepEqual(aggregateDailyToMonthly([{ time: '2026-01-01', open: 0, high: 1, low: 1, close: 1 }]), []);
});
