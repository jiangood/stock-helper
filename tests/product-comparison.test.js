'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { monthlyLast, normalizedComparison, productMonthly } = require('../scripts/build_product_comparison');

test('monthlyLast keeps the last valid observation in each month', () => {
  const result = monthlyLast([
    { date: '2026-01-02', value: 10 },
    { date: '2026-01-29', value: 12 },
    { date: '2026-02-01', value: 0 },
    { date: '2026-02-28', value: 15 }
  ]);
  assert.deepEqual(result.map((point) => [point.month, point.value]), [['2026-01', 12], ['2026-02', 15]]);
});

test('monthlyLast accepts month-only dates used by cached monthly K-lines', () => {
  const result = monthlyLast([
    { date: '2026-09', value: 8.8 },
    { date: '2026-10', value: 8.7 }
  ]);
  assert.deepEqual(result.map((point) => [point.month, point.value]), [['2026-09', 8.8], ['2026-10', 8.7]]);
});

test('normalizedComparison aligns common months and uses a common base of 100', () => {
  const result = normalizedComparison(
    [{ month: '2026-01', value: 100 }, { month: '2026-02', value: 110 }],
    [{ month: '2025-12', value: 20 }, { month: '2026-01', value: 5 }, { month: '2026-02', value: 4 }]
  );
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.series.map((point) => [point.productIndex, point.stockIndex]), [[100, 100], [110, 80]]);
});

test('comparison refuses to draw with fewer than two common months', () => {
  const result = normalizedComparison([{ month: '2026-01', value: 1 }], [{ month: '2026-01', value: 2 }]);
  assert.equal(result.status, 'insufficient-history');
  assert.deepEqual(result.series, []);
});

test('productMonthly uses spot first and futures only as fallback', () => {
  const result = productMonthly({ series: [
    { date: '2026-01-10', spot: 100, futures: 90 },
    { date: '2026-01-31', spot: 110, futures: 95 }
  ] });
  assert.equal(result[0].value, 110);
});

test('every stock has a main product label or an explicit manual mapping', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const stocks = JSON.parse(fs.readFileSync(path.join(root, 'data/stocks.json'), 'utf8'));
  const fundamentals = JSON.parse(fs.readFileSync(path.join(root, 'data/fundamentals.json'), 'utf8')).stocks;
  const mappings = JSON.parse(fs.readFileSync(path.join(root, 'data/stock-products.json'), 'utf8')).byCode;
  const missing = stocks.filter((stock) => !(mappings[stock.code] && mappings[stock.code].productName) && !(fundamentals[stock.code] && fundamentals[stock.code].mainItem)).map((stock) => stock.code);
  assert.deepEqual(missing, []);
});

test('productMonthly prefers long-range native monthly K-line closes over short daily snapshots', () => {
  const result = productMonthly({
    series: [
      { date: '2026-09-29', spot: 100 },
      { date: '2026-10-30', spot: 110 }
    ],
    monthlyKlines: {
      series: [
        { date: '2025-01', open: 80, high: 90, low: 75, close: 85 },
        { date: '2025-02', open: 85, high: 95, low: 82, close: 92 },
        { date: '2025-03', open: 92, high: 98, low: 88, close: 96 }
      ]
    }
  });
  assert.deepEqual(result.map((point) => [point.month, point.value]), [
    ['2025-01', 85], ['2025-02', 92], ['2025-03', 96]
  ]);
});

test('productMonthly falls back to actual daily spot/futures when monthly K-lines are absent', () => {
  const result = productMonthly({ series: [
    { date: '2026-01-02', spot: 100 },
    { date: '2026-01-30', spot: 105 },
    { date: '2026-02-27', futures: 110 }
  ] });
  assert.deepEqual(result.map((point) => [point.month, point.value]), [
    ['2026-01', 105], ['2026-02', 110]
  ]);
});
