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
  await context.StockCombat.refresh();
  return addCalls;
}

test('entry-zone guard suppresses add recommendation above entry price', async () => {
  assert.equal(await runCombat(10.5), 0);
});

test('entry-zone guard still evaluates add recommendation at or below entry price', async () => {
  assert.equal(await runCombat(9.5), 1);
});


test('trade review saves locally per symbol without a network dependency', () => {
  const handlers = {};
  const stored = {};
  const status = { textContent: '' };
  const fields = [
    { getAttribute: () => 'action', value: '买入/补仓' },
    { getAttribute: () => 'date', value: '2026-10-29' },
    { getAttribute: () => 'thesis', value: '周期低位，估值有安全边际' },
    { getAttribute: () => 'execution', value: '按计划分批' },
    { getAttribute: () => 'lesson', value: '等待基本面验证' }
  ];
  const panel = {
    querySelectorAll: () => fields,
    querySelector: () => status
  };
  const button = {
    getAttribute: () => 'sz000001',
    closest: (selector) => selector === '[data-review-code]' ? panel : null
  };
  const list = {
    dataset: {},
    addEventListener: (name, fn) => { handlers[name] = fn; }
  };
  const context = {
    console, Map, Intl, Date, Number, String, Array, Object, Math, Promise,
    localStorage: {
      getItem: (key) => stored[key] || null,
      setItem: (key, value) => { stored[key] = value; }
    },
    document: {
      getElementById: (id) => id === 'combat-list' ? list : null,
      addEventListener: () => {}
    }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../combat-center.js'), 'utf8'), context);
  context.StockCombat.init([], {}, {});
  handlers.click({ target: { closest: (selector) => selector === '[data-review-save]' ? button : null } });
  const saved = JSON.parse(stored['stock-helper-combat-reviews-v1']);
  assert.equal(saved['sz000001'].action, '买入/补仓');
  assert.equal(saved['sz000001'].thesis, '周期低位，估值有安全边际');
  assert.ok(saved['sz000001'].savedAt);
  assert.match(status.textContent, /已保存/);
});
