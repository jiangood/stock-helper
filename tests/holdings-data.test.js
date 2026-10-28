'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Holdings = require('../holdings-data.js');
const source = require('../data/holdings.json');

test('validates the minimal public holdings source and normalizes only required fields', () => {
  const data = Holdings.validatePayload(source);
  assert.equal(data.holdings.length, 5);
  assert.equal(data.holdings.find(h => h.code === 'sz300034').quantity, 6600);
  assert.equal(data.holdings.find(h => h.code === 'sh601618').cost, 3.058);
  assert.ok(data.holdings.every(h => h.quantity > 0 && h.cost > 0));
  assert.deepEqual(Object.keys(source).sort(), ['holdings', 'schemaVersion'].sort());
  assert.deepEqual(Object.keys(source.holdings[0]).sort(), ['code', 'cost', 'quantity'].sort());
  assert.equal(data.portfolio, undefined);
  assert.equal(data.updatedAt, undefined);
  assert.equal(data.holdings[0].riskExitPrice, undefined);
});

test('rejects invalid holding codes, quantities, costs and duplicate codes', () => {
  const base = { schemaVersion: 1, holdings: [{ code: 'sz000731', quantity: 100, cost: 6 }] };
  assert.throws(() => Holdings.validatePayload({ ...base, holdings: [{ ...base.holdings[0], code: '000731' }] }), /invalid code/);
  assert.throws(() => Holdings.validatePayload({ ...base, holdings: [{ ...base.holdings[0], quantity: 0 }] }), /quantity/);
  assert.throws(() => Holdings.validatePayload({ ...base, holdings: [{ ...base.holdings[0], cost: -1 }] }), /cost/);
  assert.throws(() => Holdings.validatePayload({ ...base, holdings: [base.holdings[0], base.holdings[0]] }), /duplicate/);
});

test('requires a holdings array and ignores obsolete manual risk fields', () => {
  assert.throws(() => Holdings.validatePayload({ schemaVersion: 1 }), /must be an array/);
  const data = Holdings.validatePayload({
    portfolio: { totalAssets: 9999, riskBudget: 200 },
    holdings: [{ code: 'sz000731', quantity: 100, cost: 6, riskExitPrice: 4 }]
  });
  assert.deepEqual(data.holdings[0], { code: 'sz000731', quantity: 100, cost: 6 });
  assert.equal(data.portfolio, undefined);
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
