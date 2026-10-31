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
