#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { preferLongerHistory, monthlyLast } = require('./build_product_comparison');

const monthlyCache = Array.from({ length: 32 }, (_, index) => ({ month: '2024-' + String(index + 1).padStart(2, '0'), value: index + 1 }));
const weeklyFallback = Array.from({ length: 47 }, (_, index) => ({ month: '2022-' + String(index + 1).padStart(2, '0'), value: index + 1 }));
assert.equal(preferLongerHistory(monthlyCache, weeklyFallback), weeklyFallback,
  'a longer weekly-derived monthly history should replace a short monthly cache');
assert.equal(preferLongerHistory(weeklyFallback, monthlyCache), weeklyFallback,
  'a longer native monthly history should remain preferred');
assert.deepEqual(preferLongerHistory([], weeklyFallback), weeklyFallback,
  'weekly history should be used when native monthly history is empty');

const points = monthlyLast([
  { date: '2024-01-05', value: 10 },
  { date: '2024-01-31', value: 12 },
  { date: '2024-02-29', value: 13 }
]);
assert.deepEqual(points.map(point => point.month), ['2024-01', '2024-02']);
assert.equal(points[0].value, 12, 'monthly aggregation should keep the last real observation');
console.log('Product monthly history tests passed.');
