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
    clearTimeout
  };
  context.window = context;
  context.StockHoldings = { load: async () => ({ holdings: [{ code: 'sz000001', quantity: 100, cost: 9 }] }) };
  context.Croc = { buyEligibility: () => ({ eligible: true }) };
  context.StockTradeSignals = {
    evaluateT: () => ({ status: '观望', kind: 'watch', reasons: [], dataReady: true }),
    evaluateAdd: () => {
      addCalls++;
      return { status: '建议补仓', kind: 'add-ready', score: 3, reasons: [] };
    }
  };
  context.document = { getElementById: () => null, addEventListener: () => {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../combat-center.js'), 'utf8'), context);
  const client = {
    fetchMinuteKline: async () => ({ bars: [] }),
    fetchTrends: async () => ({ points: [] }),
    fetchKline: async () => ({ bars: Array(30).fill({ close: 10, high: 11, low: 9, volume: 100 }) })
  };
  context.StockCombat.init(
    [{ code: 'sz000001', name: '测试标的', entry: 10, heavy: 8, pool: true }],
    { 'sz000001': { price, todayChange: 0 } },
    client
  );
  await context.StockCombat.refresh();
  return addCalls;
}

test('entry-zone guard suppresses add recommendation above entry price', async () => {
  assert.equal(await runCombat(10.5), 0);
});

test('entry-zone guard still evaluates add recommendation at or below entry price', async () => {
  assert.equal(await runCombat(9.5), 1);
});
