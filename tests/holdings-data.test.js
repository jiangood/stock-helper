'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Holdings = require('../holdings-data.js');
const source = require('../data/holdings.json');

test('validates the public holdings source and normalizes its fields', () => {
  const data = Holdings.validatePayload(source);
  assert.equal(data.holdings.length, 5);
  assert.equal(data.holdings.find(h => h.code === 'sz300034').quantity, 6600);
  assert.equal(data.holdings.find(h => h.code === 'sh601618').cost, 3.058);
  assert.equal(data.portfolio.totalAssets, 242452.26);
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

test('portfolio holdings are not persisted in frontend storage', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const business = read('business.js');
  const riskCenter = read('risk-center.js');
  const stockDetail = read('stock.js');
  const home = read('index.html');
  assert.doesNotMatch(business, /localStorage/);
  assert.doesNotMatch(riskCenter, /localStorage/);
  assert.doesNotMatch(stockDetail, /croc-cost:/);
  assert.doesNotMatch(stockDetail, /saveCost|clearCost/);
  assert.doesNotMatch(home, /holdings-form|stock-helper-local-holdings-v1/);
  assert.match(home, /holdings-data\.js/);
});
