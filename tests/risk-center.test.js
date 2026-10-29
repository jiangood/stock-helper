'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Risk = require('../risk-center.js');

const holding = { code: 'sz000731', quantity: 100, cost: 6 };
const quote = { price: 8, time: '2026-10-29 10:00' };
const plan = { name: '四川美丰', tp1: 10, tp2: 12 };

test('calculates market value, P&L, portfolio weight and target scenarios', () => {
  const row = Risk.calculateHolding(holding, quote, plan);
  assert.equal(row.marketValue, 800);
  assert.equal(row.costValue, 600);
  assert.equal(row.pnl, 200);
  assert.ok(Math.abs(row.pnlPct - 100 / 3) < 1e-10);
  assert.equal(row.target1Gain, 200);
  assert.equal(row.target2Gain, 400);
  assert.equal(row.doublePrice, undefined);
  assert.equal(row.doubleReached, undefined);
});

test('stock-pool targets are used automatically and missing targets remain unknown', () => {
  const row = Risk.calculateHolding(holding, quote, plan);
  assert.equal(row.target1, 10);
  assert.equal(row.target2, 12);
  const missing = Risk.calculateHolding(holding, quote, { name: '四川美丰' });
  assert.equal(missing.target1, null);
  assert.equal(missing.target2, null);
  assert.equal(missing.target1Gain, null);
});

test('missing quote makes market value and P&L unknown', () => {
  const row = Risk.calculateHolding(holding, {}, plan);
  assert.equal(row.marketValue, null);
  assert.equal(row.pnl, null);
  assert.equal(row.weightOfStocks, null);
});

test('summarizes concentration and return without account-level manual inputs', () => {
  const rows = [
    Risk.calculateHolding({ code: 'a', quantity: 100, cost: 6 }, { price: 8 }, { name: 'A' }),
    Risk.calculateHolding({ code: 'b', quantity: 50, cost: 10 }, { price: 12 }, { name: 'B' })
  ];
  const summary = Risk.summarize(rows);
  assert.equal(summary.totalMarketValue, 1400);
  assert.equal(summary.totalCostValue, 1100);
  assert.ok(Math.abs(summary.portfolioPnlPct - (300 / 1100 * 100)) < 1e-10);
  assert.equal(summary.largestHoldingName, 'A');
  assert.ok(Math.abs(summary.largestHoldingWeight - (800 / 1400 * 100)) < 1e-10);
  assert.ok(Math.abs(summary.topThreeWeight - 100) < 1e-10);
  assert.ok(Math.abs(rows[0].weightOfStocks + rows[1].weightOfStocks - 100) < 1e-10);
  assert.equal(summary.accountExposurePct, undefined);
  assert.equal(summary.riskBudget, undefined);
});

test('portfolio concentration and return stay unknown when quote or cost data is incomplete', () => {
  const rows = [
    Risk.calculateHolding({ code: 'a', quantity: 100, cost: 6 }, { price: 8 }, { name: 'A' }),
    Risk.calculateHolding({ code: 'b', quantity: 50, cost: 10 }, {}, { name: 'B' })
  ];
  const summary = Risk.summarize(rows);
  assert.equal(summary.totalMarketValue, null);
  assert.equal(summary.portfolioPnlPct, null);
  assert.equal(summary.largestHoldingWeight, null);
  assert.equal(summary.topThreeWeight, null);
});
