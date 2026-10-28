'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Holdings = require('../holdings-data.js');
const source = require('../holdings.json');

test('validates the public holdings source and normalizes its fields', () => {
  const data = Holdings.validatePayload(source);
  assert.equal(data.holdings.length, 4);
  assert.equal(data.holdings.find(h => h.code === 'sz300034').quantity, 6600);
  assert.equal(data.holdings.find(h => h.code === 'sh601618').cost, 3.058);
  assert.equal(data.portfolio.totalAssets, null);
  assert.equal(data.portfolio.riskBudget, null);
  assert.ok(data.holdings.every(h => h.quantity > 0 && h.cost > 0));
});

test('rejects invalid holding codes, quantities, costs and duplicate codes', () => {
  const base = { schemaVersion: 1, portfolio: {}, holdings: [
    { code: 'sz000731', quantity: 100, cost: 6 }
  ] };
  assert.throws(() => Holdings.validatePayload({ ...base, holdings: [{ ...base.holdings[0], code: '000731' }] }), /invalid code/);
  assert.throws(() => Holdings.validatePayload({ ...base, holdings: [{ ...base.holdings[0], quantity: 0 }] }), /quantity/);
  assert.throws(() => Holdings.validatePayload({ ...base, holdings: [{ ...base.holdings[0], cost: -1 }] }), /cost/);
  assert.throws(() => Holdings.validatePayload({ ...base, holdings: [base.holdings[0], base.holdings[0]] }), /duplicate/);
});

test('requires a holdings array and rejects invalid risk references', () => {
  assert.throws(() => Holdings.validatePayload({ portfolio: {} }), /must be an array/);
  assert.throws(() => Holdings.validatePayload({
    portfolio: {}, holdings: [{ code: 'sz000731', quantity: 100, cost: 6, riskExitPrice: -2 }]
  }), /riskExitPrice/);
});
