'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Risk = require('../risk-center.js');

const holding = { code: 'sz000731', quantity: 100, cost: 6 };
const quote = { price: 8, time: '2026-10-29 10:00' };
const plan = { name: '四川美丰', tp1: 10, tp2: 12 };

test('calculates market value, P&L, stop risk and target scenarios', () => {
  const row = Risk.calculateHolding(holding, quote, plan, { stopLoss: 7 });
  assert.equal(row.marketValue, 800);
  assert.equal(row.costValue, 600);
  assert.equal(row.pnl, 200);
  assert.ok(Math.abs(row.pnlPct - 100 / 3) < 1e-10);
  assert.equal(row.stopRisk, 100);
  assert.equal(row.stopState, 'valid');
  assert.equal(row.target1Gain, 200);
  assert.equal(row.target2Gain, 400);
  assert.equal(row.doublePrice, 12);
  assert.equal(row.doubleReached, false);
});

test('missing stop is unknown risk, not zero; plan targets remain fallback', () => {
  const row = Risk.calculateHolding(holding, quote, plan, {});
  assert.equal(row.stopRisk, null);
  assert.equal(row.stopState, 'unset');
  assert.equal(row.target1, 10);
});

test('rejects stop at or above current price', () => {
  const row = Risk.calculateHolding(holding, quote, plan, { stopLoss: 8 });
  assert.equal(row.stopRisk, null);
  assert.equal(row.stopState, 'invalid');
});

test('missing quote makes risk unverified', () => {
  const row = Risk.calculateHolding(holding, {}, plan, { stopLoss: 7 });
  assert.equal(row.marketValue, null);
  assert.equal(row.stopRisk, null);
  assert.equal(row.stopState, 'unverified');
});

test('summarizes exposure and detects budget exceedance without hiding incomplete data', () => {
  const rows = [
    Risk.calculateHolding({ code: 'a', quantity: 100, cost: 6 }, { price: 8 }, {}, { stopLoss: 7 }),
    Risk.calculateHolding({ code: 'b', quantity: 50, cost: 10 }, { price: 12 }, {}, { stopLoss: 10 })
  ];
  const summary = Risk.summarize(rows, 2000, 150);
  assert.equal(summary.totalMarketValue, 1400);
  assert.equal(summary.accountExposurePct, 70);
  assert.equal(summary.totalCostValue, 1100);
  assert.ok(Math.abs(summary.portfolioPnlPct - (300 / 1100 * 100)) < 1e-10);
  assert.equal(summary.largestHoldingName, 'a');
  assert.ok(Math.abs(summary.largestHoldingWeight - (800 / 1400 * 100)) < 1e-10);
  assert.ok(Math.abs(summary.topThreeWeight - 100) < 1e-10);
  assert.equal(summary.knownRisk, 200);
  assert.equal(summary.riskComplete, true);
  assert.equal(summary.budgetExceeded, true);
  assert.ok(Math.abs(rows[0].weightOfStocks + rows[1].weightOfStocks - 100) < 1e-10);

  const incomplete = Risk.summarize([
    rows[0],
    Risk.calculateHolding({ code: 'c', quantity: 1, cost: 1 }, {}, {}, {})
  ], 2000, 150);
  assert.equal(incomplete.totalMarketValue, null);
  assert.equal(incomplete.riskComplete, false);
  assert.equal(incomplete.accountExposurePct, null);
});


test('portfolio concentration and return stay unknown when quote or cost data is incomplete', () => {
  const rows = [
    Risk.calculateHolding({ code: 'a', quantity: 100, cost: 6 }, { price: 8 }, { name: 'A' }, {}),
    Risk.calculateHolding({ code: 'b', quantity: 50, cost: 10 }, {}, { name: 'B' }, {})
  ];
  const summary = Risk.summarize(rows, 2000, 150);
  assert.equal(summary.totalMarketValue, null);
  assert.equal(summary.portfolioPnlPct, null);
  assert.equal(summary.largestHoldingWeight, null);
  assert.equal(summary.topThreeWeight, null);
});
