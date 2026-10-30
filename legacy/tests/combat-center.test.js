'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function runCombat(price) {
  let addCalls = 0;
  const context = {
    console,
    Map,
    Intl,
    Date,
    Number,
    String,
    Array,
    Object,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {}
  };
  context.window = context;
  context.StockHoldings = { load: async () => ({ holdings: [{ code: 'sz000001', quantity: 100, cost: 9 }] }) };
  context.Croc = { buyEligibility: () => ({ eligible: true }) };
  context.StockTradeSignals = {
    evaluateAdd: () => {
      addCalls++;
      return { status: '建议补仓', kind: 'add-ready', score: 3, reasons: [] };
    }
  };
  context.document = { getElementById: () => null, addEventListener: () => {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../combat-center.js'), 'utf8'), context);
  const client = {
    fetchKline: async () => ({ bars: Array(30).fill({ close: 10, high: 11, low: 9, volume: 100 }) })
  };
  context.StockCombat.init(
    [{ code: 'sz000001', name: '测试标的', entry: 10, heavy: 8, pool: true }],
    { 'sz000001': { price, todayChange: 0 } },
    client
  );
  await context.StockCombat.onTab('combat');
  return addCalls;
}

test('entry-zone guard suppresses add recommendation above entry price', async () => {
  assert.equal(await runCombat(10.5), 0);
});

test('entry-zone guard still evaluates add recommendation at or below entry price', async () => {
  assert.equal(await runCombat(9.5), 1);
});

test('render does not reference removed risk-budget or review panels', () => {
  const source = fs.readFileSync(require.resolve('../combat-center.js'), 'utf8');
  assert.equal(source.includes('riskPanel'), false);
  assert.equal(source.includes('reviewPanel'), false);
});

test('combat page reads the full universe K-lines with one request and skips per-stock fetches', async () => {
  let snapshotCalls = 0;
  let fallbackCalls = 0;
  let addCalls = 0;
  const context = {
    console, Map, Intl, Date, Number, String, Array, Object, Math, Promise,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {}
  };
  context.window = context;
  context.StockHoldings = { load: async () => ({ holdings: [] }) };
  context.Croc = { buyEligibility: () => ({ eligible: true }) };
  context.StockTradeSignals = {
    evaluateAdd: () => { addCalls += 1; return { status: '观察', kind: 'add-watch', score: 2, reasons: [] }; }
  };
  context.document = { getElementById: () => null, addEventListener: () => {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../combat-center.js'), 'utf8'), context);
  const bars = Array.from({ length: 30 }, () => ({ open: 10, close: 10, high: 11, low: 9, volume: 100 }));
  const client = {
    fetchCombatKlines: async () => {
      snapshotCalls += 1;
      return { schemaVersion: 1, stocks: { sz000001: { bars } } };
    },
    fetchKline: async () => { fallbackCalls += 1; throw new Error('should not fetch each stock'); }
  };
  context.StockCombat.init(
    [{ code: 'sz000001', name: '测试标的', entry: 10, heavy: 8, pool: true }],
    { 'sz000001': { price: 9.5, todayChange: 0 } },
    client
  );
  await context.StockCombat.onTab('combat');
  assert.equal(snapshotCalls, 1);
  assert.equal(fallbackCalls, 0);
  assert.equal(addCalls, 1);
});
