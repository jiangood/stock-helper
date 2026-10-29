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


function riskBudget(params) {
  const context = {
    console, Map, Intl, Date, Number, String, Array, Object, Math, Promise,
    document: { getElementById: () => null, addEventListener: () => {} }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(require.resolve('../combat-center.js'), 'utf8'), context);
  return context.StockCombat.calculateRiskBudget(params);
}

test('risk budget sizes a trade using risk, cash, portfolio and single-stock caps', () => {
  const result = riskBudget({
    equity: 100000, cash: 20000, tradePct: 1, portfolioPct: 50, singlePct: 20,
    entry: 10, stop: 9, totalExposure: 20000, positionValue: 0
  });
  assert.equal(result.ready, true);
  assert.equal(result.shares, 1000);
  assert.equal(result.cost, 10000);
  assert.equal(result.lossAtStop, 1000);
  assert.equal(result.cap, '单笔风险预算');
});

test('risk budget respects available cash and existing portfolio exposure', () => {
  const cashLimited = riskBudget({
    equity: 100000, cash: 1500, tradePct: 10, portfolioPct: 80, singlePct: 50,
    entry: 10, stop: 9, totalExposure: 10000, positionValue: 0
  });
  assert.equal(cashLimited.shares, 100);
  assert.equal(cashLimited.cap, '可用现金');
  const portfolioLimited = riskBudget({
    equity: 100000, cash: 20000, tradePct: 10, portfolioPct: 50, singlePct: 50,
    entry: 10, stop: 9, totalExposure: 49950, positionValue: 0
  });
  assert.equal(portfolioLimited.shares, 0);
  assert.equal(portfolioLimited.cap, '组合持仓上限');
});

test('review metrics only count explicit actual P&L and stop-discipline outcomes', () => {
  const context = { console, Map, Intl, Date, Number, String, Array, Object, Math, Promise, setTimeout, clearTimeout };
  context.window = context;
  context.document = { getElementById: () => null, addEventListener: () => {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../combat-center.js'), 'utf8'), context);
  const result = context.StockCombat.summarizeReviews({
    a: { savedAt: '2026-10-29T00:00:00Z', action: '买入/补仓', actualPnl: '120.5', stopAdherence: '遵守' },
    b: { savedAt: '2026-10-29T00:00:00Z', action: '卖出', actualPnl: '-20.5', stopAdherence: '未遵守' },
    c: { savedAt: '2026-10-29T00:00:00Z', action: '未交易', actualPnl: '999', stopAdherence: '遵守' },
    d: { savedAt: '2026-10-29T00:00:00Z', action: '减仓', actualPnl: '', stopAdherence: '不适用' }
  });
  assert.equal(result.records, 4);
  assert.equal(result.trades, 3);
  assert.equal(result.pnlCount, 2);
  assert.equal(result.pnlTotal, 100);
  assert.equal(result.pnlAverage, 50);
  assert.equal(result.adherenceCount, 2);
  assert.equal(result.adherenceRate, 50);
});

test('risk budget rejects invalid stop prices and respects single-stock concentration', () => {
  const invalid = riskBudget({
    equity: 100000, cash: 20000, tradePct: 1, portfolioPct: 80, singlePct: 20,
    entry: 10, stop: 10, totalExposure: 10000, positionValue: 0
  });
  assert.equal(invalid.ready, false);
  const concentrated = riskBudget({
    equity: 100000, cash: 20000, tradePct: 10, portfolioPct: 80, singlePct: 20,
    entry: 10, stop: 9, totalExposure: 10000, positionValue: 19950
  });
  assert.equal(concentrated.shares, 0);
  assert.equal(concentrated.cap, '单股持仓上限');
});
